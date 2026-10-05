/**
 * Page models for the overview and the positions list. Pure functions over the
 * finance core, so every number on those pages is unit-tested.
 */
import { selectFx, type FxSelection } from "@/lib/finance/fx";
import { costBasis, runLedger } from "@/lib/finance/ledger";
import { addDays, businessDaysBetween, D, type Day, daysBetween, type Dec, DISPLAY_CURRENCIES } from "@/lib/finance/money";
import { dayOf, selectPrice, selectValuation, staleness } from "@/lib/finance/prices";
import { fxFnFromRows, periodFigures, type PeriodFigures, type PortfolioData, type Valuation, valueAt } from "@/lib/finance/valuation";
import { type ListItem, listItems } from "./entries";

// ------------------------------------------------------------------ periods

export const PERIODS = ["1w", "1m", "6m", "1y", "5y", "all"] as const;
export type PeriodKey = (typeof PERIODS)[number];
const PERIOD_DAYS: Record<Exclude<PeriodKey, "all">, number> = { "1w": 7, "1m": 30, "6m": 182, "1y": 365, "5y": 1826 };

export const parsePeriod = (v: string | string[] | undefined): PeriodKey =>
  typeof v === "string" && (PERIODS as readonly string[]).includes(v) ? (v as PeriodKey) : "1m";

/** First day of the period ending today (both ends included). */
export function periodStart(key: PeriodKey, today: Day, portfolioStart: Day): Day {
  if (key === "all") return addDays(portfolioStart, 1);
  return addDays(today, -(PERIOD_DAYS[key] - 1));
}

export const portfolioStartOf = (data: PortfolioData): Day | null => data.accounts.map((a) => a.trackingStart).sort()[0] ?? null;

// ------------------------------------------------------------------ series

export const MAX_POINTS = 90;

export type SeriesPoint = { day: Day; value: string; complete: boolean };
export type Marker = { day: Day; kind: "tracking_start" | "correction" };

/** Evenly spaced days from `from` to `to`, both included, at most `max` of them. */
export function sampleDays(from: Day, to: Day, max = MAX_POINTS): Day[] {
  const span = daysBetween(from, to);
  if (span < 0) return [];
  if (span + 1 <= max) return Array.from({ length: span + 1 }, (_, i) => addDays(from, i));
  const out = new Set<Day>();
  for (let i = 0; i < max; i++) out.add(addDays(from, Math.round((span * i) / (max - 1))));
  return [...out];
}

// ----------------------------------------------------------------- overview

export type Slice = { key: string; value: Dec; share: Dec };

function slices(m: Map<string, Dec>, total: Dec): Slice[] {
  return [...m]
    .filter(([, v]) => !v.isZero())
    .map(([key, value]) => ({ key, value, share: total.isZero() ? new D(0) : value.div(total) }))
    .sort((a, b) => b.value.cmp(a.value));
}

export type FxLine = { base: string; quote: string; selection: FxSelection; stale: boolean };

/** Rates between the display currencies, as used for today's value. */
export function fxPanel(data: PortfolioData, today: Day): FxLine[] {
  const pairs: [string, string][] = [["EUR", "HUF"], ["USD", "HUF"], ["EUR", "USD"]];
  return pairs.map(([base, quote]) => {
    const selection = selectFx(data.fxRows, base, quote, today);
    const stale = selection.kind === "rate" && businessDaysBetween(selection.rateDate, today) > 3;
    return { base, quote, selection, stale };
  });
}

export type OverviewModel = {
  today: Day;
  currency: string;
  period: PeriodKey;
  now: Valuation;
  missingCount: number;
  figures: PeriodFigures | null;
  series: SeriesPoint[];
  markers: Marker[];
  allocation: { assetClass: Slice[]; currency: Slice[]; account: Slice[] };
  fx: FxLine[];
  /** The latest entries (one item each) and other events. */
  recent: ListItem[];
};

export function overview(data: PortfolioData, today: Day, currency: string, period: PeriodKey, entries: Map<string, string> = new Map()): OverviewModel {
  const now = valueAt(data, today, currency);
  const start = portfolioStartOf(data);
  const figures = start ? periodFigures(data, periodStart(period, today, start), today, currency) : null;

  let series: SeriesPoint[] = [];
  const markers: Marker[] = [];
  if (figures) {
    // V(S − 1) is the starting value, so the line starts the day before S.
    const from = addDays(figures.start, -1);
    series = sampleDays(from, figures.end).map((day) => {
      const v = valueAt(data, day, currency, today);
      return { day, value: v.total.toFixed(), complete: v.complete };
    });
    for (const a of data.accounts) if (a.trackingStart >= from && a.trackingStart <= figures.end) markers.push({ day: a.trackingStart, kind: "tracking_start" });
    for (const e of data.events) if (e.type === "correction" && e.date >= from && e.date <= figures.end) markers.push({ day: e.date, kind: "correction" });
    markers.sort((a, b) => a.day.localeCompare(b.day));
  }

  const valuation = new Map(data.instruments.map((i) => [i.id, i.valuation]));
  const recent = listItems(data.events, entries, (id) => valuation.get(id)).slice(0, 6);

  return {
    today, currency, period, now, figures, series, markers, recent,
    missingCount: now.items.filter((i) => i.missing !== null).length,
    allocation: {
      assetClass: slices(now.byAssetClass, now.total),
      currency: slices(now.byCurrency, now.total),
      account: slices(now.byAccount, now.total),
    },
    fx: fxPanel(data, today),
  };
}

// ---------------------------------------------------------------- positions

export type PositionRow = {
  accountId: string;
  instrumentId: string;
  quantity: Dec;
  currency: string;
  valuation: "market" | "manual";
  price: Dec | null; // market: unit price; manual: null
  valueSource: string | null;
  valueAsOf: Day | null;
  ageDays: number | null;
  stale: boolean;
  native: Dec | null;
  display: Dec | null; // null: price or FX missing
  cost: Dec;
  costEstimated: boolean;
  unrealized: Dec | null;
  unrealizedRate: Dec | null;
  realized: Dec; // FIFO, instrument currency (estimate)
  realizedIncomplete: boolean;
  incomeNet: Dec; // instrument currency only; other currencies are left out
};

export type CashRow = { accountId: string; currency: string; amount: Dec; display: Dec | null };

export type PositionsModel = { today: Day; currency: string; positions: PositionRow[]; cash: CashRow[]; total: Dec; complete: boolean };

export function positions(data: PortfolioData, today: Day, currency: string): PositionsModel {
  const fx = fxFnFromRows(data.fxRows);
  const state = runLedger(data.events, fx, today);
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const tracked = new Set(data.accounts.filter((a) => a.trackingStart <= today).map((a) => a.id));

  const rows: PositionRow[] = [];
  for (const p of state.positions.values()) {
    const inst = instruments.get(p.instrumentId);
    if (!inst || !tracked.has(p.accountId) || p.qty.isZero()) continue;

    let price: Dec | null = null;
    let native: Dec | null = null;
    let source: string | null = null;
    let asOf: Day | null = null;
    if (inst.valuation === "manual") {
      const v = selectValuation(data.valuations, p.accountId, inst.id, today);
      if (v && v.currency === inst.currency) [native, source, asOf] = [new D(v.value), v.source, dayOf(v.asOf)];
    } else {
      const q = selectPrice(data.quotes, inst, today);
      if (q && q.currency === inst.currency) {
        price = new D(q.price);
        [native, source, asOf] = [p.qty.times(price), q.source, dayOf(q.asOf)];
      }
    }
    const age = asOf ? staleness(asOf, today, inst.valuation, inst.staleAfterDays) : null;
    const cost = costBasis(p.lots);
    const unrealized = native === null ? null : native.minus(cost);
    const realizedHere = state.realized.filter((x) => x.accountId === p.accountId && x.instrumentId === inst.id);
    const incomeNet = state.income
      .filter((x) => x.accountId === p.accountId && x.instrumentId === inst.id && x.currency === inst.currency)
      .reduce((a, x) => a.plus(x.gross).minus(x.tax), new D(0));

    rows.push({
      accountId: p.accountId, instrumentId: inst.id, quantity: p.qty, currency: inst.currency, valuation: inst.valuation,
      price, valueSource: source, valueAsOf: asOf, ageDays: age?.ageDays ?? null, stale: age?.stale ?? false,
      native, display: native === null ? null : fx(native, inst.currency, currency, today),
      cost, costEstimated: p.lots.some((l) => l.costEstimated),
      unrealized, unrealizedRate: unrealized !== null && cost.gt(0) ? unrealized.div(cost) : null,
      realized: realizedHere.reduce((a, x) => a.plus(x.result), new D(0)),
      realizedIncomplete: realizedHere.some((x) => x.incomplete),
      incomeNet,
    });
  }
  rows.sort((a, b) => (b.display ?? new D(-1)).cmp(a.display ?? new D(-1)));

  const cash: CashRow[] = [...state.cash.values()]
    .filter((c) => tracked.has(c.accountId) && !c.amount.isZero())
    .map((c) => ({ accountId: c.accountId, currency: c.currency, amount: c.amount, display: fx(c.amount, c.currency, currency, today) }));

  const values = [...rows.map((r) => r.display), ...cash.map((c) => c.display)];
  return {
    today, currency, positions: rows, cash,
    total: values.reduce<Dec>((a, v) => (v === null ? a : a.plus(v)), new D(0)),
    complete: values.every((v) => v !== null),
  };
}

export const isDisplayCurrency = (v: string | undefined): v is (typeof DISPLAY_CURRENCIES)[number] =>
  v !== undefined && (DISPLAY_CURRENCIES as readonly string[]).includes(v);
