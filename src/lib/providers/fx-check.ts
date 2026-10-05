/**
 * MNB ↔ ECB check (docs/spike-report.md: the MNB is only reachable over plain
 * HTTP). Each MNB rate X/HUF is compared with the ECB's EUR/HUF ÷ EUR/X of the
 * same day. More than 1% apart → the MNB row is stored as "suspect", so that
 * day falls back to the ECB (plan §3.1). No ECB row that day → "unchecked",
 * the MNB row stays "ok".
 */
import { D, type Dec } from "@/lib/finance/money";
import type { SourceRate } from "./mnb";

export const FX_CHECK_TOLERANCE = new D("0.01");

export type CheckedRate = SourceRate & { status: "ok" | "suspect" };
export type CheckResult = { rows: CheckedRate[]; checked: number; suspect: number; unchecked: number };

/** ecb: EUR→X rows (base EUR), from this run and from the database. */
export function crossCheckMnb(mnb: SourceRate[], ecb: SourceRate[]): CheckResult {
  const ecbByDay = new Map<string, Map<string, Dec>>();
  for (const r of ecb) {
    if (r.base !== "EUR") continue;
    const day = ecbByDay.get(r.rateDate) ?? new Map<string, Dec>();
    day.set(r.quote, r.rate);
    ecbByDay.set(r.rateDate, day);
  }
  let checked = 0;
  let suspect = 0;
  let unchecked = 0;
  const rows = mnb.map((r): CheckedRate => {
    const day = ecbByDay.get(r.rateDate);
    const eurHuf = day?.get("HUF");
    const eurX = r.base === "EUR" ? new D(1) : day?.get(r.base);
    if (r.quote !== "HUF" || !eurHuf || !eurX) {
      unchecked++;
      return { ...r, status: "ok" };
    }
    checked++;
    const reference = eurHuf.div(eurX);
    const off = r.rate.minus(reference).abs().div(reference);
    if (off.gt(FX_CHECK_TOLERANCE)) {
      suspect++;
      return { ...r, status: "suspect" };
    }
    return { ...r, status: "ok" };
  });
  return { rows, checked, suspect, unchecked };
}
