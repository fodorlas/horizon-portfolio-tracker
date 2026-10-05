/**
 * ECB reference rates through the Frankfurter API (HTTPS). Stored as the ECB
 * publishes them: 1 EUR = rate X. All currencies are requested and filtered
 * here, so one currency the ECB does not quote cannot break the others.
 */
import { D, type Day } from "@/lib/finance/money";
import { type Budget, fetchText, ProviderError, withRetry, yearChunks } from "./http";
import type { SourceRate } from "./mnb";

export const ECB_URL = "https://api.frankfurter.dev/v1";

type FrankfurterRange = { base?: string; rates?: Record<string, Record<string, number>> };

export function parseFrankfurter(json: string, currencies: string[]): SourceRate[] {
  let body: FrankfurterRange;
  try {
    body = JSON.parse(json) as FrankfurterRange;
  } catch {
    throw new ProviderError("parse");
  }
  if (body.base !== "EUR" || typeof body.rates !== "object" || body.rates === null) throw new ProviderError("parse");
  const wanted = new Set(currencies);
  const out: SourceRate[] = [];
  for (const [day, rates] of Object.entries(body.rates)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ProviderError("parse");
    for (const [ccy, value] of Object.entries(rates)) {
      if (!wanted.has(ccy)) continue;
      const rate = new D(value);
      if (!rate.isFinite() || rate.lte(0)) throw new ProviderError("parse");
      out.push({ base: "EUR", quote: ccy, rate, rawUnit: 1, rateDate: day });
    }
  }
  return out;
}

export async function fetchEcb(from: Day, to: Day, currencies: string[], budget: Budget, fetchImpl: typeof fetch = fetch): Promise<SourceRate[]> {
  const out: SourceRate[] = [];
  for (const c of yearChunks(from, to)) {
    const json = await withRetry(() => fetchText(`${ECB_URL}/${c.from}..${c.to}?base=EUR`, { method: "GET" }, budget, fetchImpl), budget);
    out.push(...parseFrankfurter(json, currencies));
  }
  return out;
}
