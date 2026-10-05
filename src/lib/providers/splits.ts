/**
 * Splits (phase 4 plan §4). A split on day S with ratio r (new shares per old
 * share, numerator/denominator) takes effect at the open of S: prices before
 * S are r times the prices after it.
 *
 * Yahoo divides every past close by all later splits. We store the price as
 * it was actually quoted, which matches the ledger's quantities (a split event
 * multiplies them on its own day), so past closes are multiplied back.
 */
import { D, type Day, type Dec } from "@/lib/finance/money";
import { classifyQuote, type QuoteStatus } from "@/lib/finance/prices";

export type Split = { day: Day; ratio: Dec };

/** Several sources, one list: by day, the first list wins on the same day. */
export function mergeSplits(...lists: Split[][]): Split[] {
  const byDay = new Map<Day, Split>();
  for (const list of lists) for (const s of list) if (!byDay.has(s.day)) byDay.set(s.day, s);
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Π ratio of the splits in (after, upTo]. */
export function splitFactor(splits: Split[], after: Day, upTo: Day): Dec {
  let f = new D(1);
  for (const s of splits) if (s.day > after && s.day <= upTo) f = f.times(s.ratio);
  return f;
}

/** Yahoo's split-adjusted close of `day` → the close as quoted that day. */
export function unadjustClose(close: Dec, day: Day, splits: Split[]): Dec {
  return close.times(splitFactor(splits, day, "9999-12-31"));
}

export type Priced = { day: Day; price: Dec };

/**
 * Statuses for new quotes in day order (plan §3.3), measured against the last
 * accepted price with the splits in between taken out: after a 10:1 split a
 * price one tenth of the day before is not a 90% drop. A suspect quote does
 * not become the reference for the next one.
 */
export function classifySeries(
  previous: Priced | null,
  quotes: (Priced & { currency: string })[],
  splits: Split[],
  instrumentCurrency: string,
): QuoteStatus[] {
  let ref = previous;
  return quotes.map((q) => {
    const baseline = ref ? ref.price.div(splitFactor(splits, ref.day, q.day)) : null;
    const status = classifyQuote({ price: q.price, currency: q.currency }, instrumentCurrency, baseline);
    if (status === "ok") ref = { day: q.day, price: q.price };
    return status;
  });
}

/**
 * Splits the provider knows about but the ledger does not, from the first day
 * the instrument matters. A few days' slack allows recording on the record
 * date instead of the effective date.
 */
export function unrecordedSplits(provider: Split[], ledger: Split[], from: Day, slackDays = 5): Split[] {
  const near = (a: Day, b: Day) => Math.abs(Date.parse(a) - Date.parse(b)) <= slackDays * 86_400_000;
  return provider.filter((p) => p.day >= from && !ledger.some((l) => near(l.day, p.day)));
}
