import { describe, expect, it, vi } from "vitest";
import { fakeSymbols } from "@/lib/refresh/fake";
import { createBudget, ProviderError } from "./http";
import { createYahooSearch, type YahooSearchApi } from "./yahoo-search";

const budget = () => createBudget(15_000, Date.now, async () => {});
const day = (d: string, hour = 17) => new Date(`${d}T${String(hour).padStart(2, "0")}:30:00Z`);

function api(over: Partial<YahooSearchApi> = {}): YahooSearchApi {
  return {
    search: async () => ({
      quotes: [
        { symbol: "VWCE.DE", isYahooFinance: true, quoteType: "ETF", longname: "Vanguard FTSE All-World UCITS ETF", exchDisp: "XETRA" },
        { symbol: "AAPL", isYahooFinance: true, quoteType: "EQUITY", shortname: "Apple Inc.", exchange: "NMS" },
        { symbol: "^GSPC", isYahooFinance: true, quoteType: "INDEX", shortname: "S&P 500" },
        { isYahooFinance: false, name: "Some startup", permalink: "x" },
        { symbol: "0P0000X", isYahooFinance: true, quoteType: "MUTUALFUND", shortname: "Egy alap" },
      ],
    }),
    quote: async (symbols) => [{ symbol: symbols[0], currency: "EUR", quoteType: "ETF", longName: "Vanguard FTSE All-World", fullExchangeName: "XETRA" }],
    chart: async () => ({
      meta: { currency: "EUR", exchangeTimezoneName: "Europe/Berlin" },
      quotes: [
        { date: day("2026-09-17"), close: 140.1 },
        { date: day("2026-09-18"), close: 141.25 },
        { date: day("2026-09-21"), close: null },
      ],
    }),
    ...over,
  };
}

describe("Yahoo search", () => {
  it("keeps holdable securities, with a name, an exchange and an asset class", async () => {
    const hits = await createYahooSearch(api(), budget()).search("vanguard");
    expect(hits).toEqual([
      { symbol: "VWCE.DE", name: "Vanguard FTSE All-World UCITS ETF", exchange: "XETRA", assetClass: "etf", source: "yahoo" },
      { symbol: "AAPL", name: "Apple Inc.", exchange: "NMS", assetClass: "stock", source: "yahoo" },
      { symbol: "0P0000X", name: "Egy alap", exchange: null, assetClass: "fund", source: "yahoo" },
    ]);
  });

  it("does not ask Yahoo for an empty or overlong query", async () => {
    let asked = 0;
    const s = createYahooSearch(api({ search: async () => (asked++, { quotes: [] }) }), budget());
    expect(await s.search("  ")).toEqual([]);
    expect(await s.search("x".repeat(65))).toEqual([]);
    expect(asked).toBe(0);
  });
});

describe("Yahoo symbol info", () => {
  it("name, currency and the last close on or before the day", async () => {
    const info = await createYahooSearch(api(), budget(), () => day("2026-09-26")).info("vwce.de", "2026-09-20");
    expect(info).toEqual({
      symbol: "VWCE.DE", name: "Vanguard FTSE All-World", currency: "EUR", assetClass: "etf", exchange: "XETRA", close: { day: "2026-09-18", price: "141.25" },
    });
  });

  it("without a close (a buy with its price): the quote only, no history request (#29)", async () => {
    const chart = vi.fn(api().chart);
    const info = await createYahooSearch(api({ chart }), budget(), () => day("2026-09-26")).info("vwce.de", "2026-09-20", { close: false });
    expect(info).toEqual({ symbol: "VWCE.DE", name: "Vanguard FTSE All-World", currency: "EUR", assetClass: "etf", exchange: "XETRA", close: null });
    expect(chart).not.toHaveBeenCalled();
  });

  it("an unknown symbol is null; no close in the window is a null close", async () => {
    expect(await createYahooSearch(api({ quote: async () => [] }), budget()).info("NOPE", "2026-09-20")).toBeNull();
    const none = await createYahooSearch(api({ chart: async () => ({ meta: { currency: "EUR", exchangeTimezoneName: "Europe/Berlin" }, quotes: [] }) }), budget(), () => day("2026-09-26")).info(
      "VWCE.DE",
      "2026-09-20",
    );
    expect(none?.close).toBeNull();
  });

  it("no data for the day's window (a listing Yahoo has only later) is no close, not an error", async () => {
    const noData = Object.assign(new Error("Data doesn't exist for startDate = 1724630400, endDate = 1725580800"), { name: "BadRequestError" });
    const later = createYahooSearch(
      api({ chart: async (_s, q) => (q.interval === "1d" ? Promise.reject(noData) : { meta: { currency: "EUR", exchangeTimezoneName: "Europe/Berlin" }, quotes: [] }) }),
      budget(),
      () => day("2026-09-26"),
    );
    expect((await later.info("VUAA.DE", "2024-09-05"))?.close).toBeNull();
  });

  it("an unknown symbol in the chart is no close; other failures are errors", async () => {
    const notFound = createYahooSearch(api({ chart: async () => Promise.reject(new ProviderError("symbol_not_found")) }), budget(), () => day("2026-09-26"));
    expect((await notFound.info("VWCE.DE", "2026-09-20"))?.close).toBeNull();
    const down = createYahooSearch(api({ quote: async () => Promise.reject(new ProviderError("http_4xx")) }), budget());
    await expect(down.info("VWCE.DE", "2026-09-20")).rejects.toMatchObject({ errorClass: "http_4xx" });
  });
});

describe("the invented Yahoo for dev, CI and e2e", () => {
  it("answers FAKE… symbols only, in EUR, with a weekday close before today", async () => {
    const f = fakeSymbols("2026-09-26");
    expect(await f.search("fakeabc")).toEqual([{ symbol: "FAKEABC", name: "FAKEABC Fake Corp", exchange: "FAKE", assetClass: "stock", source: "yahoo" }]);
    expect(await f.search("apple")).toEqual([]);
    // 2026-09-20 is a Sunday: Friday's close, 100 + 18 / 10.
    expect(await f.info("FAKEABC", "2026-09-20")).toEqual({
      symbol: "FAKEABC", name: "FAKEABC Fake Corp", currency: "EUR", assetClass: "stock", exchange: "FAKE", close: { day: "2026-09-18", price: "101.8" },
    });
    expect(await f.info("AAPL", "2026-09-20")).toBeNull();
    expect((await f.info("FAKEABC", "2026-09-20", { close: false }))?.close).toBeNull();
  });
});
