import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Day } from "@/lib/finance/money";
import { loadPortfolio } from "./load";

/**
 * One load per request, shared by the layout and the page (RLS applies).
 * `pricesFrom`: the first day the page needs prices for (see LoadOptions).
 */
export const getPortfolio = cache(async (pricesFrom?: Day) => loadPortfolio(await createClient(), { pricesFrom }));
