/**
 * Yahoo search and symbol lookup for the simple form (4c plan §2, §5): a few
 * holdable securities for a name or symbol, and for one symbol its name,
 * currency, kind and the last close on or before a day. Same request rules as
 * the refresh (http.ts): 10 s a request, a small budget, retry policy.
 */
import { addDays, type Day } from "@/lib/finance/money";
import type { AssetClass } from "@/lib/finance/valuation";
import { type Budget, ProviderError, requestSignal, withRetry } from "./http";
import type { SearchHit, SymbolInfo } from "./symbols";
import { createYahoo, type QuoteLike, type YahooApi } from "./yahoo";

export const SEARCH_RESULTS = 8;
export const MAX_QUERY = 64;
/** A close this many days before the asked day still counts (weekends, holidays). */
export const CLOSE_WINDOW_DAYS = 10;

type SearchQuoteLike = { symbol?: string; isYahooFinance?: boolean; quoteType?: string; shortname?: string; longname?: string; exchDisp?: string; exchange?: string };
type InfoQuoteLike = QuoteLike & { quoteType?: string; longName?: string; shortName?: string; fullExchangeName?: string };

/** The slice of yahoo-finance2 used here, so tests and e2e can swap it. */
export type YahooSearchApi = {
  search(query: string, opts: { quotesCount: number; newsCount: number }, module: { fetchOptions: RequestInit }): Promise<{ quotes: SearchQuoteLike[] }>;
  quote(symbols: string[], query: { return: "array" }, module: { fetchOptions: RequestInit }): Promise<InfoQuoteLike[]>;
  chart: YahooApi["chart"];
};

const CLASSES: Record<string, AssetClass> = { EQUITY: "stock", ETF: "etf", MUTUALFUND: "fund", MONEY_MARKET: "fund" };
export const assetClassOf = (quoteType: string | undefined): AssetClass | null => CLASSES[quoteType ?? ""] ?? null;

export function createYahooSearch(api: YahooSearchApi, budget: Budget, now: () => Date = () => new Date()) {
  const call = <T>(fn: (fetchOptions: RequestInit) => Promise<T>) => withRetry(() => fn({ signal: requestSignal(budget) }), budget);

  return {
    async search(query: string): Promise<SearchHit[]> {
      const q = query.trim();
      if (!q || q.length > MAX_QUERY) return [];
      const r = await call((fetchOptions) => api.search(q, { quotesCount: 10, newsCount: 0 }, { fetchOptions }));
      const hits: SearchHit[] = [];
      for (const x of r.quotes) {
        const assetClass = assetClassOf(x.quoteType);
        if (!x.isYahooFinance || !x.symbol || !assetClass) continue;
        hits.push({ symbol: x.symbol, name: x.longname ?? x.shortname ?? x.symbol, exchange: x.exchDisp ?? x.exchange ?? null, assetClass, source: "yahoo" });
      }
      return hits.slice(0, SEARCH_RESULTS);
    },

    /** `close: false`: the name and currency only, without the history request for the close (#29). */
    async info(symbol: string, day: Day, opts: { close?: boolean } = {}): Promise<SymbolInfo | null> {
      const sym = symbol.trim().toUpperCase();
      const [q] = await call((fetchOptions) => api.quote([sym], { return: "array" }, { fetchOptions }));
      if (!q?.currency) return null;
      let close: SymbolInfo["close"] = null;
      if (opts.close !== false) {
        try {
          const h = await createYahoo(api as unknown as YahooApi, budget, now).history(sym, addDays(day, -CLOSE_WINDOW_DAYS), day);
          const last = h.bars.filter((b) => b.day <= day).at(-1);
          if (last && h.currency === q.currency) close = { day: last.day, price: last.close.toFixed() };
        } catch (e) {
          if (!(e instanceof ProviderError && e.errorClass === "symbol_not_found")) throw e;
        }
      }
      return {
        symbol: sym,
        name: q.longName ?? q.shortName ?? sym,
        currency: q.currency,
        assetClass: assetClassOf(q.quoteType) ?? "other",
        exchange: q.fullExchangeName ?? null,
        close,
      };
    },
  };
}
