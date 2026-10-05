import "server-only";
/**
 * The entry form uses the live ÁKK provider only when a matching project
 * reference is explicitly configured; otherwise it uses invented samples.
 */
import type { Day } from "@/lib/finance/money";
import { type AkkRow, createAkk } from "@/lib/providers/akk";
import { createBudget } from "@/lib/providers/http";
import { fakeAkk } from "@/lib/refresh/fake";
import { realSources } from "@/lib/refresh/service";
import { LOOKUP_BUDGET_MS } from "./symbols";

/** Today's list: both tabs, the retail series only. `wanted`: series the invented list should include (fake.ts). */
export async function akkRows(today: Day, budgetMs = LOOKUP_BUDGET_MS, wanted: string[] = []): Promise<AkkRow[]> {
  const source = realSources() ? createAkk(createBudget(budgetMs)) : fakeAkk(today, wanted);
  return [...(await source.prices("MAP")), ...(await source.prices("MAPP"))];
}

/** "2031/m5", "2031 M5" and "2031M5" all find 2031/M5. */
export const seriesKey = (s: string) => s.toUpperCase().replace(/[\s/]/g, "");
