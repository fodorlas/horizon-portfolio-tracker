/**
 * Portfolio value at the end of a day, and period figures (plan §3–§4).
 *
 * Nothing is guessed: a holding without a usable price or FX rate is listed
 * as missing and left out of the total, never valued at zero or an old
 * number silently.
 */
import { convert, type FxRow, prepareFx, selectFx } from "./fx";
import { runLedger, type FxFn, type LedgerEvent } from "./ledger";
import { addDays, D, type Day, type Dec } from "./money";
import { modifiedDietz, effectivePeriod, type DatedAmount, type DietzResult } from "./performance";
import { dayOf, selectPrice, selectValuation, staleness, type ManualValuation, type PriceQuote } from "./prices";

export type AssetClass = "stock" | "etf" | "fund" | "bond" | "managed" | "other";

export type Instrument = {
  id: string;
  name: string;
  assetClass: AssetClass;
  currency: string;
  valuation: "market" | "manual";
  /** Where its price comes from: its own source and manual rows count (prices.ts, plan §3.3). */
  priceSource: string;
  staleAfterDays: number | null;
};

export type Account = { id: string; trackingStart: Day };

export type PortfolioData = {
  accounts: Account[];
  instruments: Instrument[];
  events: LedgerEvent[];
  quotes: PriceQuote[];
  valuations: ManualValuation[];
  fxRows: FxRow[];
};

export type ValuedItem = {
  accountId: string;
  instrumentId: string | null; // null = cash
  assetClass: AssetClass | "cash";
  currency: string;
  quantity: Dec | null;
  native: Dec | null; // value in its own currency; null when the price is missing
  display: Dec | null; // null when price or FX is missing
  valueAsOf: Day | null;
  stale: boolean;
  missing: "price" | "fx" | null;
};

export type Valuation = {
  day: Day;
  currency: string;
  total: Dec; // complete items only
  items: ValuedItem[];
  byAssetClass: Map<string, Dec>;
  byAccount: Map<string, Dec>;
  byCurrency: Map<string, Dec>;
  staleShare: Dec; // share of the total valued with stale prices or manual values
  complete: boolean; // no missing item
};

export function fxFnFromRows(rows: FxRow[]): FxFn {
  const prepared = prepareFx(rows);
  return (amount, from, to, day) => convert({ amount, currency: from }, to, selectFx(prepared, from, to, day))?.amount ?? null;
}

const add = (m: Map<string, Dec>, k: string, v: Dec) => m.set(k, (m.get(k) ?? new D(0)).plus(v));

export function valueAt(data: PortfolioData, day: Day, displayCurrency: string, today: Day = day, onlyAccounts?: Set<string>): Valuation {
  const tracked = new Set(
    data.accounts.filter((a) => a.trackingStart <= day && (!onlyAccounts || onlyAccounts.has(a.id))).map((a) => a.id),
  );
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const fx = fxFnFromRows(data.fxRows);
  const state = runLedger(data.events, fx, day);
  // Each position looks only at its own instrument's prices (a chart values ~90 days).
  const quotesOf = new Map<string, PriceQuote[]>();
  for (const q of data.quotes) {
    const own = quotesOf.get(q.instrumentId);
    if (own) own.push(q);
    else quotesOf.set(q.instrumentId, [q]);
  }
  const items: ValuedItem[] = [];

  const toDisplay = (amount: Dec, currency: string) => fx(amount, currency, displayCurrency, day);

  for (const p of state.positions.values()) {
    if (!tracked.has(p.accountId) || p.qty.isZero()) continue;
    const inst = instruments.get(p.instrumentId);
    if (!inst) continue;
    let native: Dec | null = null;
    let asOf: Day | null = null;
    if (inst.valuation === "manual") {
      const v = selectValuation(data.valuations, p.accountId, inst.id, day);
      if (v && v.currency === inst.currency) {
        native = new D(v.value);
        asOf = dayOf(v.asOf);
      }
    } else {
      const q = selectPrice(quotesOf.get(inst.id) ?? [], inst, day);
      if (q && q.currency === inst.currency) {
        native = p.qty.times(new D(q.price));
        asOf = dayOf(q.asOf);
      }
    }
    const display = native === null ? null : toDisplay(native, inst.currency);
    items.push({
      accountId: p.accountId,
      instrumentId: inst.id,
      assetClass: inst.assetClass,
      currency: inst.currency,
      quantity: p.qty,
      native,
      display,
      valueAsOf: asOf,
      stale: asOf === null ? false : staleness(asOf, today, inst.valuation, inst.staleAfterDays).stale,
      missing: native === null ? "price" : display === null ? "fx" : null,
    });
  }

  for (const c of state.cash.values()) {
    if (!tracked.has(c.accountId) || c.amount.isZero()) continue;
    const display = toDisplay(c.amount, c.currency);
    items.push({
      accountId: c.accountId, instrumentId: null, assetClass: "cash", currency: c.currency, quantity: null,
      native: c.amount, display, valueAsOf: day, stale: false, missing: display === null ? "fx" : null,
    });
  }

  const byAssetClass = new Map<string, Dec>();
  const byAccount = new Map<string, Dec>();
  const byCurrency = new Map<string, Dec>();
  let total = new D(0);
  let staleTotal = new D(0);
  for (const it of items) {
    if (it.display === null) continue;
    total = total.plus(it.display);
    if (it.stale) staleTotal = staleTotal.plus(it.display);
    add(byAssetClass, it.assetClass, it.display);
    add(byAccount, it.accountId, it.display);
    add(byCurrency, it.currency, it.display);
  }
  return {
    day, currency: displayCurrency, total, items, byAssetClass, byAccount, byCurrency,
    staleShare: total.isZero() ? new D(0) : staleTotal.div(total),
    complete: items.every((i) => i.missing === null),
  };
}

export type FlowItem = DatedAmount & { kind: "deposit" | "withdrawal" | "missing_flow" | "tracking_in"; accountId: string };

export type PeriodFigures = DietzResult & {
  requestedStart: Day;
  truncated: boolean; // "since tracking started"
  flows: FlowItem[];
  complete: boolean; // every value and flow could be converted
};

/**
 * Figures for [start, end] in the display currency. Accounts that join the
 * tracking later bring their opening value in as a "tracking_in" flow at the
 * end of their tracking-start day, shown apart from real deposits.
 */
export function periodFigures(data: PortfolioData, start: Day, end: Day, displayCurrency: string): PeriodFigures | null {
  if (data.accounts.length === 0) return null;
  const portfolioStart = data.accounts.map((a) => a.trackingStart).sort()[0];
  const period = effectivePeriod(start, end, portfolioStart);
  if (!period) return null;

  const fx = fxFnFromRows(data.fxRows);
  const before = valueAt(data, addDays(period.start, -1), displayCurrency);
  const after = valueAt(data, period.end, displayCurrency);
  let complete = before.complete && after.complete;

  const flows: FlowItem[] = [];
  for (const f of runLedger(data.events, fx, period.end).flows) {
    if (f.date < period.start) continue;
    const amount = fx(f.amount, f.currency, displayCurrency, f.date);
    if (amount === null) {
      complete = false;
      continue;
    }
    flows.push({ day: f.date, amount, kind: f.kind, accountId: f.accountId });
  }
  for (const a of data.accounts) {
    if (a.trackingStart === portfolioStart || a.trackingStart < period.start || a.trackingStart > period.end) continue;
    const opening = valueAt(data, a.trackingStart, displayCurrency, a.trackingStart, new Set([a.id]));
    if (!opening.complete) complete = false;
    flows.push({ day: a.trackingStart, amount: opening.total, kind: "tracking_in", accountId: a.id });
  }

  const dietz = modifiedDietz(before.total, after.total, flows, period.start, period.end);
  return { ...dietz, requestedStart: start, truncated: period.truncated, flows, complete };
}
