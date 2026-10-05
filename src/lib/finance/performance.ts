/**
 * Period figures (plan §4).
 *
 * Convention: calendar days in Budapest; V(d) is the value at the END of day d;
 * the period [S, E] is closed, T = E − S + 1; the starting value is V(S − 1).
 * A flow dated d enters at the END of day d, so its weight is (E − d) / T:
 * a flow on S weighs (T − 1)/T, a flow on E weighs 0.
 */
import { addDays, D, daysBetween, type Day, type Dec } from "./money";

export type DatedAmount = { day: Day; amount: Dec };

export type DietzResult = {
  start: Day;
  end: Day;
  valueChange: Dec; // V(E) − V(S − 1): includes deposits and withdrawals
  netFlow: Dec; // Σ external flows in [S, E]
  result: Dec; // valueChange − netFlow: the investment result
  denominator: Dec;
  returnRate: Dec | null; // null when not meaningful
  notMeaningful: boolean;
  largeFlows: boolean; // Σ|F| > 10 % of V(S − 1): Modified Dietz is less accurate
};

export const MIN_DENOMINATOR_SHARE = new D("0.01");
export const LARGE_FLOW_SHARE = new D("0.1");

/**
 * The period the figures are really computed for: never before the day after
 * the tracking start (the opening balance is the value at the END of that day).
 */
export function effectivePeriod(start: Day, end: Day, trackingStart: Day): { start: Day; end: Day; truncated: boolean } | null {
  const first = addDays(trackingStart, 1);
  const s = start < first ? first : start;
  if (s > end) return null;
  return { start: s, end, truncated: s !== start };
}

export function modifiedDietz(vBefore: Dec, vEnd: Dec, flows: DatedAmount[], start: Day, end: Day): DietzResult {
  const T = daysBetween(start, end) + 1;
  if (T < 1) throw new Error("end must not be before start");
  const inPeriod = flows.filter((f) => f.day >= start && f.day <= end);

  const netFlow = inPeriod.reduce((a, f) => a.plus(f.amount), new D(0));
  const weighted = inPeriod.reduce((a, f) => a.plus(f.amount.times(daysBetween(f.day, end)).div(T)), new D(0));
  const grossFlow = inPeriod.reduce((a, f) => a.plus(f.amount.abs()), new D(0));

  const valueChange = vEnd.minus(vBefore);
  const result = valueChange.minus(netFlow);
  const denominator = vBefore.plus(weighted);

  const scale = D.max(vBefore.abs(), grossFlow);
  const notMeaningful = denominator.lte(0) || denominator.abs().lt(scale.times(MIN_DENOMINATOR_SHARE));
  const largeFlows = grossFlow.gt(0) && (vBefore.lte(0) || grossFlow.gt(vBefore.times(LARGE_FLOW_SHARE)));

  return {
    start, end, valueChange, netFlow, result, denominator,
    returnRate: notMeaningful ? null : result.div(denominator),
    notMeaningful, largeFlows,
  };
}
