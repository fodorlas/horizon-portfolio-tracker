/**
 * Splits (phase 4 plan §4), with the recorded NVDA 10:1 split of 2024-06-10:
 * Yahoo's closes before it are one tenth of what was quoted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { D } from "@/lib/finance/money";
import { createBudget } from "./http";
import { classifySeries, mergeSplits, type Split, splitFactor, unrecordedSplits } from "./splits";
import { type ChartLike, chartSplits, closedBars, createYahoo, liveQuote, type YahooApi } from "./yahoo";

const nvda = JSON.parse(
  readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "__fixtures__", "yahoo-chart-nvda-split.json"), "utf8"),
) as ChartLike;
const AFTER = new Date("2026-09-27T12:00:00Z");
const split = (day: string, ratio: string): Split => ({ day, ratio: new D(ratio) });

describe("undoing Yahoo's split adjustment", () => {
  const splits = chartSplits(nvda);
  const bars = closedBars(nvda, splits, AFTER);
  const close = (day: string) => bars.find((b) => b.day === day)!.close.toString();

  it("reads the split on its exchange-local day", () => {
    expect(splits).toEqual([split("2024-06-10", "10")]);
  });

  it("multiplies closes before the split back, leaves the ones from the split on", () => {
    // Yahoo: 120.888 on 06-07 (adjusted) → 1208.88 as quoted; 121.79 on 06-10 unchanged.
    expect(close("2024-06-07")).toBe("1208.88");
    expect(close("2024-06-10")).toBe("121.79");
    expect(close("2024-05-28")).toBe("1139.01");
  });

  it("the series is continuous across the split: nothing turns suspect", () => {
    const statuses = classifySeries(null, bars.map((b) => ({ day: b.day, price: b.close, currency: "USD" })), splits, "USD");
    expect(statuses.every((s) => s === "ok")).toBe(true);
  });

  it("rows stored before the split still match when the range is fetched again after it", () => {
    // Stored on 2024-06-07 (no split yet): Yahoo's close was the quoted one.
    const storedThen = new D("1208.88");
    expect(close("2024-06-07")).toBe(storedThen.toString());
  });

  it("keeps closed days only", () => {
    const inProgress = closedBars(nvda, splits, new Date("2024-06-12T15:00:00Z"));
    expect(inProgress.at(-1)!.day).toBe("2024-06-11");
  });
});

describe("split-aware suspect check", () => {
  const splits = [split("2024-06-10", "10")];

  it("a live price after a split, measured against a stored pre-split price, is ok", () => {
    const s = classifySeries({ day: "2024-06-07", price: new D("1208.88") }, [{ day: "2024-06-10", price: new D("121.79"), currency: "USD" }], splits, "USD");
    expect(s).toEqual(["ok"]);
  });

  it("without the split the same move would be suspect", () => {
    const s = classifySeries({ day: "2024-06-07", price: new D("1208.88") }, [{ day: "2024-06-10", price: new D("121.79"), currency: "USD" }], [], "USD");
    expect(s).toEqual(["suspect"]);
  });

  it("a real 60% jump without a split is suspect, and does not become the reference", () => {
    const s = classifySeries(
      { day: "2026-09-01", price: new D("100") },
      [
        { day: "2026-09-02", price: new D("160"), currency: "USD" },
        { day: "2026-09-03", price: new D("101"), currency: "USD" },
      ],
      [],
      "USD",
    );
    expect(s).toEqual(["suspect", "ok"]);
  });

  it("other currency or non-positive price: suspect", () => {
    const s = classifySeries(null, [
      { day: "2026-09-02", price: new D("5000"), currency: "GBp" },
      { day: "2026-09-03", price: new D("0"), currency: "GBP" },
    ], [], "GBP");
    expect(s).toEqual(["suspect", "suspect"]);
  });
});

describe("split bookkeeping", () => {
  it("merges sources by day, ledger first", () => {
    expect(mergeSplits([split("2024-06-10", "10")], [split("2024-06-10", "9"), split("2021-07-20", "4")])).toEqual([
      split("2021-07-20", "4"),
      split("2024-06-10", "10"),
    ]);
  });

  it("the factor counts splits in (after, upTo]", () => {
    const s = [split("2021-07-20", "4"), split("2024-06-10", "10")];
    expect(splitFactor(s, "2021-07-19", "2024-06-10").toString()).toBe("40");
    expect(splitFactor(s, "2021-07-20", "2024-06-09").toString()).toBe("1");
  });

  it("warns about provider splits the ledger lacks, from the instrument's first day, with a few days' slack", () => {
    const provider = [split("2021-07-20", "4"), split("2024-06-10", "10")];
    expect(unrecordedSplits(provider, [], "2024-01-01")).toEqual([split("2024-06-10", "10")]);
    expect(unrecordedSplits(provider, [split("2024-06-07", "10")], "2024-01-01")).toEqual([]);
  });
});

describe("Yahoo client", () => {
  const budget = () => createBudget(45_000, () => 0, async () => {});

  it("reads split events up to now even when the requested range ends earlier", async () => {
    const calls: { period1: string; period2: string; interval: string }[] = [];
    const api: YahooApi = {
      chart: async (_s, q) => {
        calls.push(q);
        if (q.interval === "3mo") return { ...nvda, quotes: [] };
        return { ...nvda, events: { splits: [] } };
      },
      quote: async () => [],
    };
    const h = await createYahoo(api, budget(), () => AFTER).history("NVDA", "2024-05-28", "2024-06-07");
    expect(calls.map((c) => c.interval)).toEqual(["1d", "3mo"]);
    expect(h.splits).toEqual([split("2024-06-10", "10")]);
    expect(h.bars.find((b) => b.day === "2024-06-07")!.close.toString()).toBe("1208.88");
  });

  it("asks for history in pieces of at most two years, without gaps or overlaps", async () => {
    const calls: { period1: string; period2: string }[] = [];
    const api: YahooApi = { chart: async (_s, q) => (calls.push(q), { ...nvda, quotes: [], events: {} }), quote: async () => [] };
    await createYahoo(api, budget(), () => new Date("2026-09-27T12:00:00Z")).history("X", "2021-01-01", "2026-09-27");
    expect(calls[0].period1).toBe("2021-01-01");
    expect(calls.at(-1)!.period2).toBe("2026-09-28"); // exclusive end: to + 1 day
    for (let i = 1; i < calls.length; i++) expect(calls[i].period1).toBe(calls[i - 1].period2);
    for (const c of calls) expect((Date.parse(c.period2) - Date.parse(c.period1)) / 86_400_000).toBeLessThanOrEqual(730);
  });

  // As yahoo-finance2 throws it: Yahoo's 400 for a range the listing has no data in (VUAA.DE before 2024-12-30).
  const noData = () => Object.assign(new Error("Data doesn't exist for startDate = 1724630400, endDate = 1725580800"), { name: "BadRequestError" });

  it("a range Yahoo has no data for is no bars, not an error, and is not retried", async () => {
    const calls: string[] = [];
    const api: YahooApi = {
      chart: async (_s, q) => {
        calls.push(q.interval);
        if (q.interval === "1d") throw noData();
        return { ...nvda, quotes: [], events: {} };
      },
      quote: async () => [],
    };
    const h = await createYahoo(api, budget(), () => AFTER).history("VUAA.DE", "2024-08-26", "2024-09-05");
    expect(h).toEqual({ currency: "USD", bars: [], splits: [] });
    expect(calls).toEqual(["1d", "3mo"]);
  });

  it("no data up to today, with no later chart to read: an empty history", async () => {
    const api: YahooApi = { chart: async () => Promise.reject(noData()), quote: async () => [] };
    const h = await createYahoo(api, budget(), () => AFTER).history("VUAA.DE", "2026-09-17", "2026-09-27");
    expect(h).toEqual({ currency: null, bars: [], splits: [] });
  });

  it("a chart that came back without meta is still a parse error, not an empty history", async () => {
    const api: YahooApi = { chart: async () => ({ quotes: [], events: {} }) as unknown as ChartLike, quote: async () => [] };
    await expect(createYahoo(api, budget(), () => AFTER).history("X", "2026-09-17", "2026-09-27")).rejects.toMatchObject({ errorClass: "parse" });
  });

  it("other 400s stay errors", async () => {
    const bad = Object.assign(new Error("Invalid input - start date cannot be after end date"), { name: "BadRequestError" });
    const api: YahooApi = { chart: async () => Promise.reject(bad), quote: async () => [] };
    await expect(createYahoo(api, budget(), () => AFTER).history("X", "2026-09-17", "2026-09-27")).rejects.toMatchObject({ name: "ProviderError" });
  });

  it("batches live quotes by 20 and skips symbols without a price", async () => {
    const batches: number[] = [];
    const api: YahooApi = {
      chart: async () => nvda,
      quote: async (symbols) => {
        batches.push(symbols.length);
        return symbols.map((s) => ({ symbol: s, currency: "USD", regularMarketPrice: s === "S3" ? undefined : 10, regularMarketTime: "2026-09-25T20:00:00Z" }));
      },
    };
    const q = await createYahoo(api, budget()).quotes(Array.from({ length: 25 }, (_, i) => `S${i}`));
    expect(batches).toEqual([20, 5]);
    expect(q.has("S3")).toBe(false);
    expect(q.get("S4")).toMatchObject({ currency: "USD", asOf: "2026-09-25T20:00:00.000Z" });
  });

  it("rounds Yahoo's float noise to 7 significant digits", () => {
    expect(liveQuote({ symbol: "X", currency: "USD", regularMarketPrice: 113.9010009765625, regularMarketTime: 0 })!.price.toString()).toBe("113.901");
  });
});
