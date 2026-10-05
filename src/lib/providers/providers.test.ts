import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { D } from "@/lib/finance/money";
import { parseFrankfurter } from "./ecb";
import { crossCheckMnb } from "./fx-check";
import { type Budget, classify, createBudget, fetchText, ProviderError, withRetry, yearChunks } from "./http";
import { mnbRequestBody, parseMnbResponse, type SourceRate } from "./mnb";

const fixture = (f: string) => readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "__fixtures__", f), "utf8");

/** A budget on a fake clock: sleeping only moves the clock. */
function fakeBudget(ms = 45_000): Budget & { slept: number[] } {
  let t = 0;
  const slept: number[] = [];
  return {
    ...createBudget(ms, () => t, async (d) => {
      slept.push(d);
      t += d;
    }),
    slept,
  };
}

describe("MNB", () => {
  const rows = parseMnbResponse(fixture("mnb-get-exchange-rates.xml"));

  it("parses every day and currency as 1 X = rate HUF", () => {
    const eur = rows.find((r) => r.base === "EUR" && r.rateDate === "2026-09-25")!;
    expect(eur).toMatchObject({ quote: "HUF", rawUnit: 1 });
    expect(eur.rate.toString()).toBe("364.42");
  });

  it("normalises the per-100 JPY to one unit and keeps the raw unit", () => {
    const jpy = rows.find((r) => r.base === "JPY" && r.rateDate === "2026-09-25")!;
    expect(jpy.rawUnit).toBe(100);
    expect(jpy.rate.toString()).toBe("2.023");
  });

  it("an empty result is no rows; a broken one is a parse error", () => {
    expect(parseMnbResponse("<s:Envelope><GetExchangeRatesResult /></s:Envelope>")).toEqual([]);
    expect(() => parseMnbResponse("<html>maintenance</html>")).toThrow(ProviderError);
    expect(() =>
      parseMnbResponse('<GetExchangeRatesResult>&lt;MNBExchangeRates&gt;&lt;Day date="2026-01-02"&gt;&lt;Rate unit="1" curr="EUR"&gt;0&lt;/Rate&gt;&lt;/Day&gt;&lt;/MNBExchangeRates&gt;</GetExchangeRatesResult>'),
    ).toThrow(ProviderError);
  });

  it("builds one SOAP request with all currencies", () => {
    expect(mnbRequestBody("2026-01-01", "2026-12-31", ["EUR", "USD"])).toContain("<currencyNames>EUR,USD</currencyNames>");
  });
});

describe("ECB (Frankfurter)", () => {
  it("keeps only the wanted currencies, EUR-based", () => {
    const rows = parseFrankfurter(fixture("ecb-frankfurter-range.json"), ["HUF"]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.base === "EUR" && r.quote === "HUF" && r.rawUnit === 1)).toBe(true);
  });

  it("refuses a body that is not an EUR range", () => {
    expect(() => parseFrankfurter('{"base":"USD","rates":{}}', ["HUF"])).toThrow(ProviderError);
    expect(() => parseFrankfurter("<html>", ["HUF"])).toThrow(ProviderError);
  });
});

describe("MNB ↔ ECB check", () => {
  const ecb: SourceRate[] = [
    { base: "EUR", quote: "HUF", rate: new D("400"), rawUnit: 1, rateDate: "2026-09-25" },
    { base: "EUR", quote: "USD", rate: new D("1.25"), rawUnit: 1, rateDate: "2026-09-25" },
  ];
  const mnb = (base: string, rate: string, day = "2026-09-25"): SourceRate => ({ base, quote: "HUF", rate: new D(rate), rawUnit: 1, rateDate: day });

  it("0.99% apart is fine, 1.01% is suspect (EUR direct, USD through EUR/HUF ÷ EUR/USD = 320)", () => {
    const r = crossCheckMnb([mnb("EUR", "403.96"), mnb("EUR", "404.04"), mnb("USD", "323.168"), mnb("USD", "316.768")], ecb);
    expect(r.rows.map((x) => x.status)).toEqual(["ok", "suspect", "ok", "suspect"]);
    expect(r).toMatchObject({ checked: 4, suspect: 2, unchecked: 0 });
  });

  it("no ECB rate that day: unchecked and ok", () => {
    const r = crossCheckMnb([mnb("EUR", "999", "2026-09-26"), mnb("JPY", "2.1")], ecb);
    expect(r.rows.every((x) => x.status === "ok")).toBe(true);
    expect(r).toMatchObject({ checked: 0, unchecked: 2 });
  });

  it("the recorded fixtures agree within 1%", () => {
    const m = parseMnbResponse(fixture("mnb-get-exchange-rates.xml"));
    const e = parseFrankfurter(fixture("ecb-frankfurter-range.json"), ["HUF", "USD", "JPY"]);
    const r = crossCheckMnb(m, e);
    expect(r.checked).toBeGreaterThan(0);
    expect(r.suspect).toBe(0);
  });
});

describe("HTTP rules", () => {
  it("429: waits 1 s, then 3 s, then gives up with http_429", async () => {
    const b = fakeBudget();
    const fn = vi.fn().mockRejectedValue(new ProviderError("http_429"));
    await expect(withRetry(fn, b)).rejects.toMatchObject({ errorClass: "http_429" });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(b.slept).toEqual([1000, 3000]);
  });

  it("429 honours a short Retry-After, and gives up at once on a long one", async () => {
    const short = fakeBudget();
    const fn = vi.fn().mockRejectedValueOnce(new ProviderError("http_429", 2000)).mockResolvedValue("ok");
    await expect(withRetry(fn, short)).resolves.toBe("ok");
    expect(short.slept).toEqual([2000]);

    const long = fakeBudget();
    const fn2 = vi.fn().mockRejectedValue(new ProviderError("http_429", 60_000));
    await expect(withRetry(fn2, long)).rejects.toMatchObject({ errorClass: "http_429" });
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it("5xx, timeout and network: one retry; not found: none", async () => {
    for (const cls of ["http_5xx", "timeout", "network"] as const) {
      const fn = vi.fn().mockRejectedValue(new ProviderError(cls));
      await expect(withRetry(fn, fakeBudget())).rejects.toMatchObject({ errorClass: cls });
      expect(fn).toHaveBeenCalledTimes(2);
    }
    const nf = vi.fn().mockRejectedValue(new ProviderError("symbol_not_found"));
    await expect(withRetry(nf, fakeBudget())).rejects.toMatchObject({ errorClass: "symbol_not_found" });
    expect(nf).toHaveBeenCalledTimes(1);
  });

  it("no request starts once the budget is spent, and no retry is squeezed in", async () => {
    const spent = fakeBudget(0);
    const fn = vi.fn();
    await expect(withRetry(fn, spent)).rejects.toMatchObject({ errorClass: "budget" });
    expect(fn).not.toHaveBeenCalled();

    const tight = fakeBudget(500);
    const fn2 = vi.fn().mockRejectedValue(new ProviderError("http_5xx"));
    await expect(withRetry(fn2, tight)).rejects.toMatchObject({ errorClass: "http_5xx" });
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it("classifies thrown errors without keeping their text", () => {
    expect(classify(Object.assign(new Error("Too Many Requests"), { name: "HTTPError", code: 429 })).errorClass).toBe("http_429");
    expect(classify(new Error("No data found, symbol may be delisted")).errorClass).toBe("symbol_not_found");
    expect(classify(Object.assign(new Error("x"), { name: "HTTPError", code: 503 })).errorClass).toBe("http_5xx");
    expect(classify(new DOMException("t", "TimeoutError")).errorClass).toBe("timeout");
    expect(classify(new TypeError("fetch failed")).errorClass).toBe("network");
    expect(classify(Object.assign(new Error("bad"), { name: "FailedYahooValidationError" })).errorClass).toBe("parse");
    expect(classify(new Error("secret body")).message).not.toContain("secret");
  });

  it("maps HTTP statuses, with Retry-After in seconds", async () => {
    const res = (status: number, headers: Record<string, string> = {}) => vi.fn().mockResolvedValue(new Response("x", { status, headers }));
    await expect(fetchText("u", {}, fakeBudget(), res(429, { "retry-after": "2" }))).rejects.toMatchObject({ errorClass: "http_429", retryAfterMs: 2000 });
    await expect(fetchText("u", {}, fakeBudget(), res(502))).rejects.toMatchObject({ errorClass: "http_5xx" });
    await expect(fetchText("u", {}, fakeBudget(), res(404))).rejects.toMatchObject({ errorClass: "http_4xx" });
    await expect(fetchText("u", {}, fakeBudget(), res(200))).resolves.toBe("x");
  });

  it("splits ranges into calendar years", () => {
    expect(yearChunks("2024-11-20", "2026-02-03")).toEqual([
      { from: "2024-11-20", to: "2024-12-31" },
      { from: "2025-01-01", to: "2025-12-31" },
      { from: "2026-01-01", to: "2026-02-03" },
    ]);
    expect(yearChunks("2026-05-01", "2026-05-01")).toEqual([{ from: "2026-05-01", to: "2026-05-01" }]);
  });
});
