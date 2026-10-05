/**
 * Prices and manual valuations (plan §3.3): append-only logs with one
 * deterministic selection rule. The SQL view does the same (shared cases in
 * tests/fixtures/price-selection-cases.json).
 */
import { businessDaysBetween, D, daysBetween, type Day, type Dec, todayInBudapest } from "./money";

export type QuoteStatus = "ok" | "suspect";

export type LoggedValue = {
  id: string;
  /** Market moment the value refers to (ISO timestamp), not the fetch time. */
  asOf: string;
  enteredAt: string;
  source: string; // "manual" or a provider name
  status: QuoteStatus;
  supersedesId: string | null;
};

export type PriceQuote = LoggedValue & { instrumentId: string; price: string | number | Dec; currency: string };
export type ManualValuation = LoggedValue & {
  accountId: string;
  instrumentId: string;
  value: string | number | Dec; // total value of the holding
  currency: string;
};

const DAYS = new Map<string, Day>();
const DAYS_KEPT = 100_000;

/**
 * Budapest calendar day of a timestamp. A chart asks it for every price row
 * on every day it draws, so each timestamp is converted once (a pure
 * function of the string; the store is emptied when it grows large).
 */
export function dayOf(iso: string): Day {
  let day = DAYS.get(iso);
  if (day === undefined) {
    if (DAYS.size >= DAYS_KEPT) DAYS.clear();
    day = todayInBudapest(new Date(iso));
    DAYS.set(iso, day);
  }
  return day;
}

/**
 * The sources an instrument's price may come from (plan §3.3, extended
 * 2026-09-28): its own source and manual rows; any source for a manually
 * priced instrument. A paper switched from Yahoo to the BÉT is valued from
 * the BÉT only, even on a day the BÉT had no trade.
 */
export const priceSourceFilter = (priceSource: string) => (source: string) =>
  priceSource === "manual" || source === priceSource || source === "manual";

/**
 * Picks the value for day D: candidates are on or before D (Budapest), from an
 * allowed source, not suspect and not superseded by a valid manual row; the
 * latest market moment wins; at the same moment a manual row wins, then the
 * latest entry. A manual correction counts only where the row it corrects
 * counts (all the way down a chain of corrections): fixing an old source's
 * row never hides the current source.
 */
export function selectLogged<T extends LoggedValue>(rows: T[], day: Day, allowed: (source: string) => boolean = () => true): T | null {
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Down a chain of corrections: a correction of a correction counts only if the row they all correct does.
  const counts = (r: T): boolean => {
    if (!allowed(r.source)) return false;
    if (r.source !== "manual" || !r.supersedesId) return true;
    const target = byId.get(r.supersedesId);
    // A target outside a windowed load was already checked by the database (price_quotes_from).
    return !target || counts(target);
  };
  const eligible = rows.filter(counts);
  const superseded = new Set(
    eligible.filter((r) => r.supersedesId && r.status === "ok" && r.source === "manual").map((r) => r.supersedesId!),
  );
  let best: T | null = null;
  for (const r of eligible) {
    if (r.status !== "ok" || superseded.has(r.id) || dayOf(r.asOf) > day) continue;
    if (!best) {
      best = r;
      continue;
    }
    const t = Date.parse(r.asOf) - Date.parse(best.asOf);
    if (t > 0) best = r;
    else if (t === 0) {
      const rm = r.source === "manual" ? 1 : 0;
      const bm = best.source === "manual" ? 1 : 0;
      if (rm > bm || (rm === bm && r.enteredAt > best.enteredAt)) best = r;
    }
  }
  return best;
}

export function selectPrice(quotes: PriceQuote[], instrument: { id: string; priceSource: string }, day: Day): PriceQuote | null {
  return selectLogged(quotes.filter((q) => q.instrumentId === instrument.id), day, priceSourceFilter(instrument.priceSource));
}

export function selectValuation(vals: ManualValuation[], accountId: string, instrumentId: string, day: Day): ManualValuation | null {
  return selectLogged(vals.filter((v) => v.accountId === accountId && v.instrumentId === instrumentId), day);
}

export const SUSPECT_JUMP = new D("0.5");

/** Status for an automatically fetched quote (plan §3.3). Manual rows are always "ok". */
export function classifyQuote(
  quote: { price: string | number | Dec; currency: string },
  instrumentCurrency: string,
  previousPrice: string | number | Dec | null,
): QuoteStatus {
  const p = new D(quote.price);
  if (!p.isFinite() || p.lte(0)) return "suspect";
  if (quote.currency !== instrumentCurrency) return "suspect";
  if (previousPrice !== null) {
    const prev = new D(previousPrice);
    if (prev.gt(0) && p.minus(prev).abs().div(prev).gt(SUSPECT_JUMP)) return "suspect";
  }
  return "ok";
}

export type Staleness = { ageDays: number; stale: boolean };

/**
 * Age of a value for display. Market prices are stale after 3 business days,
 * manual valuations after 35 calendar days, unless the instrument overrides it.
 */
export function staleness(asOfDay: Day, today: Day, kind: "market" | "manual", overrideDays?: number | null): Staleness {
  const ageDays = Math.max(0, daysBetween(asOfDay, today));
  if (overrideDays) return { ageDays, stale: ageDays > overrideDays };
  if (kind === "market") return { ageDays, stale: businessDaysBetween(asOfDay, today) > 3 };
  return { ageDays, stale: ageDays > 35 };
}
