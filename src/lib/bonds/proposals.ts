/**
 * The Horizon's proposals for the owner's government securities (spec
 * 2026-09-28 §5, §6.2): every interest day and maturity that has passed while
 * the owner held the paper, with the amount our verified rules give – or none,
 * "Adat hiányzik", when the period's own rate is unknown or the series does
 * not check out. Pure; the refresh saves the list (sync.ts).
 */
import type { LedgerEvent } from "@/lib/finance/ledger";
import { addDays, D, type Day, daysBetween, type Dec } from "@/lib/finance/money";
import type { BondTerms } from "./observe";
import { entitled, historyPeriods, interestAmount, type Period, periodPercent, type RateRow, steppedPeriods } from "./rules";

export type ProposalKind = "interest_reinvest" | "interest" | "maturity";
export type Basis = {
  start: Day;
  end: Day;
  days: number;
  annual: string | null;
  rateSource: "history" | "observed" | null;
  method: "act_act" | "act_360";
  uncertain: boolean;
  /** Why there is no amount: the period's rate unseen; the series' check does not match; or it has not been checked yet (#30). */
  missing: "rate" | "unverified" | "unchecked" | null;
};
export type Proposal = {
  instrumentId: string;
  accountId: string;
  kind: ProposalKind;
  due: Day;
  /** The entitled nominal; for a maturity, the nominal repaid. */
  nominal: Dec;
  /** The period's interest in percent, to 0.01%. */
  percent: Dec | null;
  /** Interest in Ft; null: "Adat hiányzik". */
  amount: Dec | null;
  basis: Basis;
};
export type BondFacts = BondTerms & { check: "verified" | "mismatch" | "unknown" };
/** A daily ÁKK reading: its coupon is the rate of the period its settle day falls in. */
export type Observed = { settle: Day; coupon: Dec | null; checkResult: "ok" | "mismatch" | "no_rate" };

type RatedPeriod = Period & { rate: Dec | null };

function periodsOf(b: BondFacts, rates: RateRow[]): RatedPeriod[] {
  if (b.kind === "mapp" || b.kind === "fixmap") return steppedPeriods(b.issue, b.maturity, b.kind).map((p) => ({ ...p, rate: null }));
  const known: RatedPeriod[] = historyPeriods(b.issue, rates);
  const last = known.at(-1)?.end ?? b.issue;
  // The maturity is an interest day even before the ÁKK publishes its last period's rate.
  if (last < b.maturity) known.push({ start: last, end: b.maturity, rate: null });
  return known;
}

/** The period's own annual rate (spec §5.3): the history, or a checked reading whose settle day is in it; FixMÁP's rate is fixed for life. */
function rateOf(b: BondFacts, p: RatedPeriod, observed: Observed[]): { annual: Dec; source: "history" | "observed" } | null {
  if (b.kind === "bmap" || b.kind === "pmap") return p.rate ? { annual: p.rate, source: "history" } : null;
  const ok = observed.filter((o) => o.checkResult === "ok" && o.coupon !== null && (b.kind === "fixmap" || (o.settle >= p.start && o.settle < p.end)));
  const latest = ok.sort((x, y) => x.settle.localeCompare(y.settle)).at(-1);
  return latest ? { annual: latest.coupon!, source: "observed" } : null;
}

/** Whether the ledger already has this event (approved, or recorded by hand). */
function recorded(events: LedgerEvent[], kind: ProposalKind, accountId: string, instrumentId: string, day: Day): boolean {
  return events.some(
    (e) =>
      e.type === kind &&
      e.date === day &&
      e.lines.some((l) => l.accountId === accountId && l.instrumentId === instrumentId && (kind === "interest" ? l.role === "income" : l.kind === "position")),
  );
}

export function proposalsFor(input: {
  bonds: BondFacts[];
  events: LedgerEvent[];
  /** BMÁP/PMÁP history by series. */
  rates: Map<string, RateRow[]>;
  /** Daily readings by instrument. */
  observations: Map<string, Observed[]>;
  today: Day;
}): Proposal[] {
  const out: Proposal[] = [];
  for (const b of input.bonds) {
    const lines = input.events.flatMap((e) => e.lines.filter((l) => l.kind === "position" && l.instrumentId === b.instrumentId).map((l) => ({ day: e.date, l })));
    const accounts = [...new Set(lines.map((x) => x.l.accountId))].sort();
    const periods = periodsOf(b, input.rates.get(b.series) ?? []);
    for (const accountId of accounts) {
      const mine = lines.filter((x) => x.l.accountId === accountId);
      const holdingAt = (day: Day) => mine.filter((x) => x.day <= day).reduce((a, x) => a.plus(x.l.amount), new D(0));
      for (const p of periods) {
        if (p.end > input.today) break;
        const kind: ProposalKind = p.end === b.maturity ? "maturity" : b.kind === "mapp" ? "interest_reinvest" : "interest";
        const right = entitled(holdingAt, p.end);
        const nominal = kind === "maturity" ? holdingAt(addDays(p.end, -1)) : right.nominal;
        if (nominal.lte(0) || recorded(input.events, kind, accountId, b.instrumentId, p.end)) continue;
        const rate = rateOf(b, p, input.observations.get(b.instrumentId) ?? []);
        const verified = rate !== null && b.check === "verified";
        const percent = verified ? periodPercent(b.kind, rate.annual, p, b.maturity) : null;
        out.push({
          instrumentId: b.instrumentId,
          accountId,
          kind,
          due: p.end,
          nominal,
          percent,
          amount: percent && right.nominal.gt(0) ? interestAmount(percent, right.nominal) : null,
          basis: {
            start: p.start, end: p.end, days: daysBetween(p.start, p.end),
            annual: rate?.annual.toFixed() ?? null, rateSource: rate?.source ?? null,
            method: b.kind === "bmap" ? "act_360" : "act_act",
            uncertain: right.uncertain,
            missing: verified ? null : !rate ? "rate" : b.check === "mismatch" ? "unverified" : "unchecked",
          },
        });
      }
    }
  }
  return out.sort((x, y) => x.due.localeCompare(y.due) || x.instrumentId.localeCompare(y.instrumentId) || x.accountId.localeCompare(y.accountId));
}
