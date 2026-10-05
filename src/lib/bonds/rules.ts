/**
 * Interest rules of the retail government securities (spec 2026-09-28 §5;
 * checked against every ÁKK series on 2026-09-28, §11). Pure. Percentages are
 * percent of the nominal value; days are Budapest calendar days.
 *
 *  - MÁP Plusz, FixMÁP, PMÁP: Tényleges/Tényleges over technical periods that
 *    step back from maturity (FixMÁP 3 months, the others 12). A regular
 *    period is exactly the annual rate / payments a year, 29 February or not.
 *  - BMÁP: Tényleges/360.
 *  - A period's interest is rounded to 0.01% (4 decimals per 1 Ft), times the
 *    nominal, to whole forints: "a kerekítés általános szabályai", half up.
 */
import { addDays, D, type Day, daysBetween, type Dec, isWeekday } from "@/lib/finance/money";

export type BondKind = "mapp" | "fixmap" | "pmap" | "bmap";

/** ÁKK `securityType` → rule set; null for types the rules do not cover (KTV and others). */
export function bondKind(securityType: string): BondKind | null {
  switch (securityType) {
    case "MÁP Plusz":
    case "MÁPP_T":
      return "mapp";
    case "FixMÁP":
      return "fixmap";
    case "PMÁP":
      return "pmap";
    case "BMÁP":
      return "bmap";
    default:
      return null;
  }
}

const HALF_UP = D.ROUND_HALF_UP;
const stepOf = (kind: BondKind) => (kind === "fixmap" ? 3 : 12);
const pad = (n: number) => String(n).padStart(2, "0");

/** The same day `months` later (or earlier); the month's last day when it has no such day. */
export function addMonths(day: Day, months: number): Day {
  const [y, m, d] = day.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}

/** Interest is due on `end` for [start, end). */
export type Period = { start: Day; end: Day };

/**
 * FixMÁP and MÁP Plusz periods (spec §5.2): maturity − k·step for every k
 * after the issue day; the first period starts on the issue day, and a stub
 * shorter than half a technical period joins the next one.
 */
export function steppedPeriods(issue: Day, maturity: Day, kind: "mapp" | "fixmap"): Period[] {
  const step = stepOf(kind);
  const ends: Day[] = [];
  for (let k = 0; ; k++) {
    const d = addMonths(maturity, -step * k);
    if (d <= issue) break;
    ends.unshift(d);
  }
  if (ends.length > 1) {
    const stub = daysBetween(issue, ends[0]);
    const technical = daysBetween(addMonths(maturity, -step * ends.length), ends[0]);
    if (stub * 2 < technical) ends.shift();
  }
  return ends.map((end, i) => ({ start: i === 0 ? issue : ends[i - 1], end }));
}

/** One row of the ÁKK interest history: [start, end) at `rate` % a year. */
export type RateRow = { start: Day; end: Day; rate: Dec };

/** BMÁP and PMÁP periods from the history, oldest first; none starts before the issue day. */
export function historyPeriods(issue: Day, rows: RateRow[]): (Period & { rate: Dec })[] {
  return rows
    .filter((r) => r.end > issue)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((r) => ({ start: r.start < issue ? issue : r.start, end: r.end, rate: r.rate }));
}

/** Interest accrued on [start, day) in percent, unrounded. */
export function accruedPercent(kind: BondKind, annual: Dec, start: Day, day: Day, maturity: Day): Dec {
  if (day <= start) return new D(0);
  if (kind === "bmap") return annual.times(daysBetween(start, day)).div(360);
  const step = stepOf(kind);
  let share = new D(0);
  for (let k = 0; ; k++) {
    const b = addMonths(maturity, -step * k);
    if (b <= start) break;
    const a = addMonths(maturity, -step * (k + 1));
    const lo = a > start ? a : start;
    const hi = b < day ? b : day;
    if (hi > lo) share = share.plus(new D(daysBetween(lo, hi)).div(daysBetween(a, b)));
  }
  return annual.times(step).div(12).times(share);
}

/** A period's interest in percent, to 0.01% as the offering documents state it. */
export function periodPercent(kind: BondKind, annual: Dec, p: Period, maturity: Day): Dec {
  return accruedPercent(kind, annual, p.start, p.end, maturity).toDecimalPlaces(2, HALF_UP);
}

/** Forints due on `nominal`: 4 decimals per 1 Ft, times the nominal, whole forints. */
export function interestAmount(percent: Dec, nominal: Dec): Dec {
  return percent.toDecimalPlaces(2, HALF_UP).div(100).times(nominal).toDecimalPlaces(0, HALF_UP);
}

/** The period `day` falls in (start ≤ day < end). */
export function periodOn<T extends Period>(periods: T[], day: Day): T | null {
  return periods.find((p) => p.start <= day && day < p.end) ?? null;
}

/** Self-check (spec §5.4): our accrued interest on the ÁKK's settle day, to 4 decimals, equals theirs. */
export function accruedMatches(kind: BondKind, annual: Dec, start: Day, settle: Day, maturity: Day, akkAccrued: Dec): boolean {
  return accruedPercent(kind, annual, start, settle, maturity).toDecimalPlaces(4, HALF_UP).eq(akkAccrued);
}

export const ENTITLEMENT_WINDOW_DAYS = 14;

/**
 * Nominal entitled on interest day `due` (spec §5.1). The terms say: held at
 * the close of the second business day before. Without a holiday calendar:
 * unchanged over the 14 days before → the end of the day before, certain;
 * otherwise the end of the second weekday before, flagged uncertain.
 */
export function entitled(holdingAt: (day: Day) => Dec, due: Day): { nominal: Dec; uncertain: boolean } {
  const base = holdingAt(addDays(due, -ENTITLEMENT_WINDOW_DAYS - 1));
  let changed = false;
  for (let i = ENTITLEMENT_WINDOW_DAYS; i >= 1 && !changed; i--) changed = !holdingAt(addDays(due, -i)).eq(base);
  if (!changed) return { nominal: holdingAt(addDays(due, -1)), uncertain: false };
  let d = due;
  for (let weekdays = 0; weekdays < 2; ) {
    d = addDays(d, -1);
    if (isWeekday(d)) weekdays++;
  }
  return { nominal: holdingAt(d), uncertain: true };
}
