/**
 * One ÁKK instrument against today's ÁKK rows (spec 2026-09-28 §4.1, §4.3,
 * §5.4): what goes into the price log and the daily readings, and whether our
 * own rule gives the ÁKK's accrued interest. Pure; the refresh saves the result.
 */
import { type AkkRate, type AkkRow, type AkkTab, unitValue } from "@/lib/providers/akk";
import { type Day, type Dec } from "@/lib/finance/money";
import { endOfDayBudapest } from "@/lib/tx/parse";
import { accruedMatches, type BondKind, historyPeriods, type Period, periodOn, steppedPeriods } from "./rules";

export type BondTerms = { instrumentId: string; name: string; series: string; kind: BondKind; tab: AkkTab; issue: Day; maturity: Day };

export type AkkQuote = { instrumentId: string; price: string; currency: "HUF"; asOf: string; source: "akk" };
export type Observation = {
  instrumentId: string;
  day: Day;
  bid: string;
  ask: string | null;
  accrued: string;
  coupon: string | null;
  settleDate: Day;
  checkResult: "ok" | "mismatch" | "no_rate";
};
export type Observed = {
  quote: AkkQuote | null;
  observation: Observation | null;
  /** The series' check to store; null leaves the stored one as it is. */
  check: "verified" | "mismatch" | "unknown" | null;
  log: "ok" | "not_listed" | "rule_mismatch" | "matured";
};

/** The period and the annual rate our rule uses on `day`: BMÁP and PMÁP from the history, the others from the list's coupon. */
export function currentRate(t: Pick<BondTerms, "kind" | "issue" | "maturity">, row: AkkRow | null, rates: AkkRate[], day: Day): { period: Period; annual: Dec } | null {
  if (t.kind === "bmap" || t.kind === "pmap") {
    const p = periodOn(historyPeriods(t.issue, rates), day);
    return p ? { period: p, annual: p.rate } : null;
  }
  const period = periodOn(steppedPeriods(t.issue, t.maturity, t.kind), day);
  return period && row?.coupon ? { period, annual: row.coupon } : null;
}

export function observe(t: BondTerms, rows: Map<string, AkkRow>, rates: AkkRate[], today: Day): Observed {
  if (today >= t.maturity) {
    // The terms repay the nominal at 100%: not an estimate (spec §4.3).
    return {
      quote: { instrumentId: t.instrumentId, price: "1", currency: "HUF", asOf: endOfDayBudapest(t.maturity), source: "akk" },
      observation: null,
      check: null,
      log: "matured",
    };
  }
  const row = rows.get(t.series);
  if (!row) return { quote: null, observation: null, check: null, log: "not_listed" };

  const rate = currentRate(t, row, rates, row.settle);
  // On a period's first day the accrued interest is 0 whatever the rate: such a reading proves nothing.
  const decisive = rate !== null && row.settle > rate.period.start;
  const checkResult = !decisive ? "no_rate" : accruedMatches(t.kind, rate.annual, rate.period.start, row.settle, t.maturity, row.accrued) ? "ok" : "mismatch";
  return {
    quote: { instrumentId: t.instrumentId, price: unitValue(row).toFixed(), currency: "HUF", asOf: endOfDayBudapest(today), source: "akk" },
    observation: {
      instrumentId: t.instrumentId, day: today, bid: row.bid.toFixed(), ask: row.ask?.toFixed() ?? null, accrued: row.accrued.toFixed(),
      coupon: row.coupon?.toFixed() ?? null, settleDate: row.settle, checkResult,
    },
    check: checkResult === "ok" ? "verified" : checkResult === "mismatch" ? "mismatch" : rate ? null : "unknown",
    log: checkResult === "mismatch" ? "rule_mismatch" : "ok",
  };
}
