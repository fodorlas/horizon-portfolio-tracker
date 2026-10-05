/**
 * FX rates (plan §3.1).
 *
 * Meaning, always: 1 unit of `base` = `rate` units of `quote`.
 * Selection for day D: first the source (MNB → ECB → standalone manual),
 * then the latest rate_date within [D − 10 days, D] on which that source can
 * serve the pair (direct, inverse, or a cross with both legs from the same
 * source and the same day). Broker rates never take part. Nothing is guessed:
 * if no source can serve the pair, the result is "missing".
 *
 * The SQL function public.select_fx() implements the same rule; both are
 * checked against tests/fixtures/fx-selection-cases.json.
 */
import { addDays, D, type Day, type Dec, type Money } from "./money";

export const FX_WINDOW_DAYS = 10;
export const FX_SOURCE_ORDER = ["MNB", "ECB", "manual"] as const;
type SelectableSource = (typeof FX_SOURCE_ORDER)[number];
const PIVOTS: Record<SelectableSource, string[]> = { MNB: ["HUF"], ECB: ["EUR"], manual: ["HUF", "EUR"] };

export type FxSource = SelectableSource | "broker";

export type FxRow = {
  id: string;
  base: string;
  quote: string;
  rate: string | number | Dec;
  rateDate: Day;
  source: FxSource;
  status: "ok" | "suspect";
  supersedesId: string | null;
  fetchedAt: string; // ISO timestamp, tie-break for duplicate manual rows
};

/** A rate oriented for one conversion: 1 `base` = `rate` `quote`. */
export type OrientedRate = { base: string; quote: string; rate: Dec };

export type FxSelection =
  | { kind: "identity" }
  | {
      kind: "rate";
      base: string;
      quote: string;
      rate: Dec;
      method: "direct" | "inverse" | "cross";
      source: SelectableSource;
      rateDate: Day;
      rowIds: string[];
      via?: string;
    }
  | { kind: "missing" };

type Effective = { row: FxRow; source: SelectableSource; rateDate: Day; base: string; quote: string };

/** Rows as they count for selection: corrections take the slot of what they supersede. */
export function effectiveRows(rows: FxRow[]): Effective[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const superseded = new Set(
    rows.filter((r) => r.supersedesId && r.status === "ok" && r.source === "manual").map((r) => r.supersedesId!),
  );
  const out: Effective[] = [];
  for (const r of rows) {
    if (r.source === "broker" || r.status !== "ok" || superseded.has(r.id)) continue;
    const target = r.supersedesId ? byId.get(r.supersedesId) : undefined;
    if (r.source === "manual" && target && target.source !== "broker") {
      out.push({ row: r, source: target.source as SelectableSource, rateDate: target.rateDate, base: target.base, quote: target.quote });
    } else {
      out.push({ row: r, source: r.source as SelectableSource, rateDate: r.rateDate, base: r.base, quote: r.quote });
    }
  }
  return out;
}

type Leg = { rate: Dec; ids: string[]; method: "direct" | "inverse" };

function pick(rows: Effective[]): Effective | undefined {
  // Several rows for one slot can only be standalone manual ones: latest entry wins.
  return rows.reduce<Effective | undefined>((best, r) => (!best || r.row.fetchedAt > best.row.fetchedAt ? r : best), undefined);
}

function leg(rows: Effective[], from: string, to: string): Leg | undefined {
  const direct = pick(rows.filter((r) => r.base === from && r.quote === to));
  if (direct) return { rate: new D(direct.row.rate), ids: [direct.row.id], method: "direct" };
  const inverse = pick(rows.filter((r) => r.base === to && r.quote === from));
  if (inverse) return { rate: new D(1).div(new D(inverse.row.rate)), ids: [inverse.row.id], method: "inverse" };
  return undefined;
}

type Served = { rate: Dec; method: "direct" | "inverse" | "cross"; rowIds: string[]; via?: string };

function serve(rows: Effective[], source: SelectableSource, from: string, to: string): Served | undefined {
  const one = leg(rows, from, to);
  if (one) return { rate: one.rate, method: one.method, rowIds: one.ids };
  for (const pivot of PIVOTS[source]) {
    if (pivot === from || pivot === to) continue;
    const a = leg(rows, from, pivot);
    const b = leg(rows, pivot, to);
    if (a && b) return { rate: a.rate.times(b.rate), method: "cross", rowIds: [...a.ids, ...b.ids], via: pivot };
  }
  return undefined;
}

/** Rows made ready once for many selections: the corrections are resolved once, not per conversion. */
export type PreparedFx = { readonly effective: readonly Effective[] };

export function prepareFx(rows: FxRow[]): PreparedFx {
  return { effective: effectiveRows(rows) };
}

export function selectFx(rows: FxRow[] | PreparedFx, from: string, to: string, day: Day): FxSelection {
  if (from === to) return { kind: "identity" };
  const earliest = addDays(day, -FX_WINDOW_DAYS);
  const eff = (Array.isArray(rows) ? effectiveRows(rows) : rows.effective).filter((r) => r.rateDate >= earliest && r.rateDate <= day);

  for (const source of FX_SOURCE_ORDER) {
    const own = eff.filter((r) => r.source === source);
    const dates = [...new Set(own.map((r) => r.rateDate))].sort().reverse();
    for (const d of dates) {
      const hit = serve(own.filter((r) => r.rateDate === d), source, from, to);
      if (hit) return { kind: "rate", base: from, quote: to, source, rateDate: d, ...hit };
    }
  }
  return { kind: "missing" };
}

export class FxDirectionError extends Error {}

/** Applies a rate in its stated direction only: never silently inverted. */
export function applyRate(m: Money, rate: OrientedRate): Money {
  if (m.currency !== rate.base) {
    throw new FxDirectionError(`Rate ${rate.base}→${rate.quote} cannot convert ${m.currency}`);
  }
  return { amount: m.amount.times(rate.rate), currency: rate.quote };
}

/** Converts with a selection; `null` when the rate is missing (the caller shows a warning). */
export function convert(m: Money, to: string, selection: FxSelection): Money | null {
  if (m.currency === to) return m;
  if (selection.kind !== "rate") return null;
  return applyRate(m, selection);
}
