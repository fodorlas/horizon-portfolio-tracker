import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accruedMatches, historyPeriods, periodOn, steppedPeriods } from "@/lib/bonds/rules";
import { D } from "@/lib/finance/money";
import { akkDay, akkNumber, type AkkRow, buyEstimate, createAkk, parsePrices, parseRates, typeLabel, unitValue } from "./akk";
import { createBudget, ProviderError } from "./http";

// Recorded on 2026-09-28 by `npm run spike -- --save --only=akk-full` (public ÁKK data).
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "__fixtures__");
const read = (file: string) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as unknown;
const map = parsePrices("MAP", read("akk-full-map.json"));
const mapp = parsePrices("MAPP", read("akk-full-mapp.json"));
const rates = parseRates(read("akk-full-rates.json"));
const row = (rows: AkkRow[], series: string) => rows.find((r) => r.series === series)!;

describe("ÁKK text formats", () => {
  it("dates and Hungarian decimals; empty, missing and banded rates are no number", () => {
    expect(akkDay("2026.09.28")).toBe("2026-09-28");
    expect(() => akkDay("2026-09-28")).toThrow(ProviderError);
    expect(akkNumber("99,0000")?.toFixed()).toBe("99");
    expect(akkNumber("5,00 %")?.toFixed()).toBe("5");
    expect(akkNumber("")).toBeNull();
    expect(akkNumber(null)).toBeNull();
    expect(akkNumber("5,00 - 6,00 %")).toBeNull();
  });
});

describe("parsePrices: the retail series of a tab", () => {
  it("MAPP: both MÁP Plusz kinds, with the owner's two series", () => {
    expect(mapp).toHaveLength(162);
    expect(row(mapp, "2031/M5")).toMatchObject({
      securityType: "MÁPP_T", kind: "mapp", tab: "MAPP", issue: "2026-07-20", maturity: "2031-08-21", settle: "2026-09-28",
    });
    expect(row(mapp, "2031/M5").coupon?.toFixed()).toBe("5");
    expect(row(mapp, "2031/M5").accrued.toFixed()).toBe("0.9589");
    expect(row(mapp, "2031/M5").bid.toFixed()).toBe("99");
    expect(row(mapp, "N2030/M9").accrued.toFixed()).toBe("0.0493");
    expect(mapp.some((r) => r.securityType === "MÁP Plusz")).toBe(true);
  });

  it("MAP: exchange bonds left out; BMÁP has no coupon and no ask", () => {
    expect(map).toHaveLength(51);
    expect(map.some((r) => r.securityType === "KTV")).toBe(false);
    expect(row(map, "2027/N")).toMatchObject({ kind: "bmap", coupon: null, ask: null });
  });

  it("one unreadable row is left out and named; the rest of the tab stays", () => {
    const json = read("akk-full-map.json") as { data: { data: Record<string, unknown>[] } };
    json.data.data = json.data.data.map((r) => (r.name === "2027/N" ? { ...r, bidPrice: "" } : r));
    const rows = parsePrices("MAP", json);
    expect(rows).toHaveLength(50);
    expect(rows.some((r) => r.series === "2027/N")).toBe(false);
    expect(rows.broken).toEqual(["2027/N"]);
    expect(map.broken).toEqual([]);
  });

  it("an unreadable coupon or ask fails its own row like the bid; empty stays none, a band is no single rate (#32)", () => {
    const edit = (file: string, series: string, patch: Record<string, unknown>) => {
      const json = read(file) as { data: { data: Record<string, unknown>[] } };
      json.data.data = json.data.data.map((r) => (r.name === series ? { ...r, ...patch } : r));
      return json;
    };
    expect(parsePrices("MAPP", edit("akk-full-mapp.json", "2031/M5", { coupon: "öt százalék" })).broken).toEqual(["2031/M5"]);
    expect(parsePrices("MAP", edit("akk-full-map.json", "2027/N", { askPrice: "n/a" })).broken).toEqual(["2027/N"]);
    const banded = parsePrices("MAPP", edit("akk-full-mapp.json", "2031/M5", { coupon: "5,00 - 6,00 %", askPrice: "" }));
    expect(banded.broken).toEqual([]);
    expect(row(banded, "2031/M5")).toMatchObject({ coupon: null, ask: null });
  });

  it("a changed format is a parse error, never a guess", () => {
    expect(() => parsePrices("MAP", {})).toThrow(ProviderError);
    expect(() => parsePrices("MAP", { data: { data: [{ name: 1 }] } })).toThrow(ProviderError);
    expect(() => parsePrices("MAP", { data: { data: [{ name: "X", securityType: "FixMÁP", issueDate: "x" }] } })).toThrow(ProviderError);
  });
});

describe("parseRates: BMÁP and PMÁP periods", () => {
  it("the interest day is the day after validTo; other types are left out", () => {
    const n = rates.filter((r) => r.series === "2027/N");
    expect(n.at(-1)).toEqual({ series: "2027/N", start: "2026-08-26", end: "2026-11-26", rate: new D("6.8") });
    expect(rates.find((r) => r.series === "2036/I1")).toEqual({ series: "2036/I1", start: "2026-07-17", end: "2027-02-21", rate: new D("4.5") });
    expect(rates.some((r) => r.series === "2031/Q4" || r.series === "2031/M5")).toBe(false);
  });
});

describe("value per 1 Ft nominal", () => {
  it("bid plus accrued, once", () => {
    expect(unitValue(row(mapp, "2031/M5")).toFixed()).toBe("0.999589");
  });

  it("a today's buy estimate from the ask, whole forints; none without an ask", () => {
    expect(buyEstimate(row(mapp, "2031/M5"), new D(1_000_000))?.toFixed()).toBe("1009589");
    expect(buyEstimate(row(map, "2027/N"), new D(1_000_000))).toBeNull();
  });

  it("type labels", () => {
    expect(typeLabel({ securityType: "MÁPP_T" })).toBe("MÁP Plusz");
    expect(typeLabel({ securityType: "FixMÁP" })).toBe("FixMÁP");
  });
});

describe("the 2026-09-28 check as a regression test (spec §11/3)", () => {
  it("every retail series' accrued interest follows the rules to 4 decimals", () => {
    const misses: string[] = [];
    for (const r of [...map, ...mapp]) {
      let start: string | null = null;
      let annual = r.coupon;
      if (r.kind === "bmap" || r.kind === "pmap") {
        const p = periodOn(historyPeriods(r.issue, rates.filter((x) => x.series === r.series)), r.settle);
        start = p?.start ?? null;
        annual = p?.rate ?? null;
      } else {
        start = periodOn(steppedPeriods(r.issue, r.maturity, r.kind), r.settle)?.start ?? null;
      }
      if (!start || !annual || !accruedMatches(r.kind, annual, start, r.settle, r.maturity, r.accrued)) misses.push(r.series);
    }
    expect(misses).toEqual([]);
    expect(map.length + mapp.length).toBe(213);
  });
});

describe("createAkk: one csrf session, then JSON posts", () => {
  const fixture = readFileSync(path.join(dir, "akk-full-mapp.json"), "utf8");
  function fakeFetch(status = 200) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/csrf")) {
        return new Response(JSON.stringify({ data: { headerName: "X-CSRF-TOKEN", token: "t0k" } }), { headers: { "set-cookie": "ci=abc; path=/" } });
      }
      return new Response(status === 200 ? fixture : "", { status });
    }) as unknown as typeof fetch;
    return { calls, impl };
  }

  it("sends the token and the cookie, and asks for the csrf once", async () => {
    const f = fakeFetch();
    const akk = createAkk(createBudget(), f.impl);
    expect(await akk.prices("MAPP")).toHaveLength(162);
    await akk.prices("MAPP");
    expect(f.calls.filter((c) => c.url.endsWith("/csrf"))).toHaveLength(1);
    const post = f.calls.find((c) => c.url.endsWith("/networkRate/get_prices"))!;
    expect(post.init?.method).toBe("POST");
    expect(post.init?.body).toBe(JSON.stringify({ paper: "MAPP" }));
    expect(post.init?.headers).toMatchObject({ "X-CSRF-TOKEN": "t0k", Cookie: "ci=abc" });
  });

  it("a server error is an error class, not content", async () => {
    const akk = createAkk(createBudget(1_000, Date.now, async () => {}), fakeFetch(500).impl);
    await expect(akk.prices("MAP")).rejects.toMatchObject({ errorClass: "http_5xx" });
  });
});
