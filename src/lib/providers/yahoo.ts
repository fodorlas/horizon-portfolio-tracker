/**
 * Yahoo Finance (yahoo-finance2), shares and ETFs (phase 4 plan §3).
 *  - live: quote(), at most 20 symbols a request, as_of = regularMarketTime
 *  - history: chart(1d) per instrument in ≤ 2-year pieces, 300 ms apart;
 *    closed days only (before today in the exchange's time zone), as_of = the
 *    end of that day in Budapest; `close`, not the dividend-adjusted adjclose
 *  - Yahoo's closes are split-adjusted up to now, so the split events are
 *    always read up to now and the closes multiplied back (splits.ts)
 * Prices are Yahoo floats with ~7 significant digits: rounded to that first.
 */
import { addDays, D, type Day, type Dec } from "@/lib/finance/money";
import { endOfDayBudapest } from "@/lib/tx/parse";
import { type Budget, checkBudget, ProviderError, requestSignal, withRetry } from "./http";
import { type Split, unadjustClose } from "./splits";

export const QUOTE_BATCH = 20;
export const CHART_PIECE_DAYS = 730;
export const REQUEST_PAUSE_MS = 300;
export const PRICE_SIGNIFICANT_DIGITS = 7;

type When = Date | string | number;
export type ChartLike = {
  meta: { currency: string; exchangeTimezoneName: string };
  quotes: { date: When; close: number | null }[];
  events?: { splits?: { date: When; numerator: number; denominator: number }[] };
};
export type QuoteLike = { symbol: string; currency?: string; regularMarketPrice?: number; regularMarketTime?: When };

/** The slice of yahoo-finance2 we use, so tests and e2e can swap it. */
export type YahooApi = {
  chart(symbol: string, query: { period1: string; period2: string; interval: "1d" | "3mo"; events: "split"; return: "array" }, module: { fetchOptions: RequestInit }): Promise<ChartLike>;
  quote(symbols: string[], query: { return: "array" }, module: { fetchOptions: RequestInit }): Promise<QuoteLike[]>;
};

export type Bar = { day: Day; close: Dec };
export type LiveQuote = { symbol: string; price: Dec; currency: string; asOf: string };
/** `currency` is null when Yahoo had no data at all, so there was no chart to read it from. */
export type History = { currency: string | null; bars: Bar[]; splits: Split[] };

export function localDay(when: When, timeZone: string): Day {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(when));
}

export function toPrice(n: number): Dec {
  const d = new D(n);
  if (!d.isFinite()) throw new ProviderError("parse");
  return d.toSignificantDigits(PRICE_SIGNIFICANT_DIGITS);
}

export function chartSplits(chart: ChartLike): Split[] {
  return (chart.events?.splits ?? []).map((s) => {
    if (!(s.numerator > 0) || !(s.denominator > 0)) throw new ProviderError("parse");
    return { day: localDay(s.date, chart.meta.exchangeTimezoneName), ratio: new D(s.numerator).div(s.denominator) };
  });
}

/** Closed days only, split-adjustment undone with `splits` (which must reach now). */
export function closedBars(chart: ChartLike, splits: Split[], now: Date): Bar[] {
  const tz = chart.meta.exchangeTimezoneName;
  const today = localDay(now, tz);
  const byDay = new Map<Day, Bar>();
  for (const q of chart.quotes) {
    if (q.close === null || q.close === undefined) continue;
    const day = localDay(q.date, tz);
    if (day >= today) continue;
    byDay.set(day, { day, close: unadjustClose(toPrice(q.close), day, splits) });
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function liveQuote(q: QuoteLike): LiveQuote | null {
  if (typeof q.regularMarketPrice !== "number" || !q.currency || q.regularMarketTime === undefined) return null;
  return { symbol: q.symbol, price: toPrice(q.regularMarketPrice), currency: q.currency, asOf: new Date(q.regularMarketTime).toISOString() };
}

export const asOfForDay = (day: Day) => endOfDayBudapest(day);

/** Yahoo's 400 for a range a listing has no data in (e.g. VUAA.DE before its first day on Yahoo). */
export const isNoData = (e: unknown) => e instanceof Error && e.name === "BadRequestError" && e.message.startsWith("Data doesn't exist for startDate");

/** A chart request whose range has no data answers null: an empty range, not a failure (and not retried). */
const orNoData = <T>(p: Promise<T>): Promise<T | null> => p.catch((e) => (isNoData(e) ? null : Promise.reject(e)));

export function createYahoo(api: YahooApi, budget: Budget, now: () => Date = () => new Date()) {
  let requests = 0;
  const call = async <T>(fn: (fetchOptions: RequestInit) => Promise<T>): Promise<T> => {
    if (requests++ > 0) {
      checkBudget(budget);
      await budget.sleep(REQUEST_PAUSE_MS);
    }
    return withRetry(() => fn({ signal: requestSignal(budget) }), budget);
  };

  return {
    /** Daily closes for [from, to] and every split from `from` up to now. */
    async history(symbol: string, from: Day, to: Day): Promise<History> {
      const bars = new Map<Day, { date: When; close: number | null }>();
      const rawSplits: NonNullable<NonNullable<ChartLike["events"]>["splits"]> = [];
      let meta: ChartLike["meta"] | null = null;
      // Some chart came back: a missing meta is then a broken answer, not "no data".
      let answered = false;
      const today = localDay(now(), "Europe/Budapest");
      for (let start = from; start <= to; start = addDays(start, CHART_PIECE_DAYS)) {
        const end = [addDays(start, CHART_PIECE_DAYS - 1), to].sort()[0];
        // period2 is exclusive: one day more.
        const c = await call((fetchOptions) =>
          orNoData(api.chart(symbol, { period1: start, period2: addDays(end, 1), interval: "1d", events: "split", return: "array" }, { fetchOptions })),
        );
        if (!c) continue;
        answered = true;
        meta = c.meta;
        for (const q of c.quotes) bars.set(new Date(q.date).toISOString(), q);
        rawSplits.push(...(c.events?.splits ?? []));
      }
      if (to < today) {
        // Closes are adjusted for splits up to now: read the later splits too.
        const c = await call((fetchOptions) =>
          orNoData(api.chart(symbol, { period1: addDays(to, 1), period2: addDays(today, 1), interval: "3mo", events: "split", return: "array" }, { fetchOptions })),
        );
        if (c) {
          answered = true;
          meta ??= c.meta;
          rawSplits.push(...(c.events?.splits ?? []));
        }
      }
      if (!meta) {
        if (answered) throw new ProviderError("parse");
        return { currency: null, bars: [], splits: [] };
      }
      const chart: ChartLike = { meta, quotes: [...bars.values()], events: { splits: rawSplits } };
      const splits = [...new Map(chartSplits(chart).map((s) => [s.day, s])).values()].sort((a, b) => a.day.localeCompare(b.day));
      return { currency: meta.currency, bars: closedBars(chart, splits, now()), splits };
    },

    /** Split events from `from` up to now (one light request). */
    async splitsSince(symbol: string, from: Day): Promise<Split[]> {
      const today = localDay(now(), "Europe/Budapest");
      const c = await call((fetchOptions) =>
        api.chart(symbol, { period1: from, period2: addDays(today, 1), interval: "3mo", events: "split", return: "array" }, { fetchOptions }),
      );
      return chartSplits(c);
    },

    /** Live quotes; a symbol Yahoo does not know is simply missing from the map. */
    async quotes(symbols: string[]): Promise<Map<string, LiveQuote>> {
      const out = new Map<string, LiveQuote>();
      for (let i = 0; i < symbols.length; i += QUOTE_BATCH) {
        const batch = symbols.slice(i, i + QUOTE_BATCH);
        const rows = await call((fetchOptions) => api.quote(batch, { return: "array" }, { fetchOptions }));
        for (const r of rows) {
          const q = liveQuote(r);
          if (q) out.set(q.symbol, q);
        }
      }
      return out;
    },
  };
}
