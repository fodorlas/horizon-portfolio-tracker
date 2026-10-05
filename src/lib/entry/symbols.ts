import "server-only";
/**
 * Searches use live providers only when a matching project reference is
 * explicitly configured; otherwise they use invented sample responses.
 */
import YahooFinance from "yahoo-finance2";
import type { Day } from "@/lib/finance/money";
import { type BetSource, betLookup, createBet, dailyBetLists } from "@/lib/providers/bet";
import { createBudget, ProviderError } from "@/lib/providers/http";
import type { SearchHit } from "@/lib/providers/symbols";
import { createYahooSearch, type YahooSearchApi } from "@/lib/providers/yahoo-search";
import { fakeBet, fakeSymbols } from "@/lib/refresh/fake";
import { realSources } from "@/lib/refresh/service";

/** A search or one lookup while typing: a few requests at most. */
export const LOOKUP_BUDGET_MS = 20_000;

/** `budgetMs`: the save looks up every new symbol, within the refresh's work budget. */
export function symbolSource(today: Day, budgetMs = LOOKUP_BUDGET_MS) {
  if (!realSources()) return fakeSymbols(today);
  const api = new YahooFinance({ suppressNotices: ["yahooSurvey"] }) as unknown as YahooSearchApi;
  return createYahooSearch(api, createBudget(budgetMs));
}

/** Where BÉT lookups go. `wanted`: codes the invented BÉT should list (fake.ts). */
export function betSource(today: Day, budgetMs = LOOKUP_BUDGET_MS, wanted: string[] = []): BetSource {
  return realSources() ? createBet(createBudget(budgetMs), today, fetch, undefined, dailyBetLists) : fakeBet(today, wanted);
}

export type MarketSearch = { hits: SearchHit[]; from: "bet" | "yahoo"; betDown: boolean };

/** Tőzsdei papír keresése: the BÉT first; Yahoo when the BÉT has nothing or cannot be reached, or when asked. */
export async function searchMarket(query: string, today: Day, where: "auto" | "yahoo"): Promise<MarketSearch> {
  let betDown = false;
  if (where === "auto") {
    try {
      const hits = await betLookup(betSource(today, LOOKUP_BUDGET_MS, [query])).search(query);
      if (hits.length > 0) return { hits, from: "bet", betDown };
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      betDown = true;
    }
  }
  return { hits: await symbolSource(today).search(query), from: "yahoo", betDown };
}
