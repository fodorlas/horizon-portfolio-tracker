/**
 * The ledger (plan §2). An event groups lines; each line changes either the
 * quantity of one instrument in one account (kind "position") or one cash
 * balance in one account and currency (kind "cash").
 *
 * validateEvent() mirrors the database's deferred validator
 * (private.validate_event, shared cases in tests/fixtures/event-validation-cases.json).
 * runLedger() replays events in order and derives positions, FIFO lots, cash,
 * realised results, income, fees, taxes and external flows. Every figure is a
 * portfolio-analysis estimate, not a tax figure.
 */
import { D, type Day, type Dec } from "./money";

export const EVENT_TYPES = [
  "buy",
  "sell",
  "dividend",
  "dividend_reinvest",
  "split",
  "fx_exchange",
  "deposit",
  "withdrawal",
  "transfer",
  "fee",
  "interest",
  "opening_balance",
  "correction",
  "interest_reinvest",
  "maturity",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const LINE_ROLES = ["trade", "fee", "tax", "income", "external", "transfer", "fx", "split", "opening", "correction"] as const;
export type LineRole = (typeof LINE_ROLES)[number];

/**
 * FX rows chosen by select_fx on the acquisition day (plan §3.2): one id for a
 * direct or inverse rate, two for a cross rate, [] when no conversion is
 * needed, null when the rate was missing.
 */
export type CostFxRefs = Partial<Record<"HUF" | "EUR" | "USD" | "fee", string[] | null>>;

export type Line = {
  id: string;
  kind: "position" | "cash";
  accountId: string;
  instrumentId: string | null; // required for positions; on cash lines it names the payer (e.g. dividend)
  currency: string;
  amount: Dec; // position: Δ units; cash: Δ money
  role: LineRole;
  costAmount: Dec | null; // acquisitions only: total cost in the instrument currency
  costEstimated: boolean;
  costFxRefs: CostFxRefs | null;
};

export type LedgerEvent = {
  id: string;
  type: EventType;
  date: Day;
  createdAt: string; // tie-break within a day
  correctionKind: "missing_flow" | "reconciliation" | null;
  splitRatio: Dec | null;
  note: string | null;
  lines: Line[];
};

export type ValidationContext = {
  instrumentCurrency: (instrumentId: string) => string | undefined;
  trackingStart: (accountId: string) => Day | undefined;
};

// ---------------------------------------------------------------- validation

export type ValidationError =
  | "no_lines"
  | "position_without_instrument"
  | "unknown_instrument"
  | "position_currency_mismatch"
  | "cost_on_cash_line"
  | "negative_cost"
  | "before_tracking_start"
  | "opening_not_on_tracking_start"
  | "correction_kind_mismatch"
  | "split_ratio_mismatch"
  | "note_required"
  | "bad_shape";

const pos = (l: Line) => l.kind === "position";
const cash = (l: Line) => l.kind === "cash";
const gt0 = (l: Line) => l.amount.gt(0);
const lt0 = (l: Line) => l.amount.lt(0);
const count = (lines: Line[], f: (l: Line) => boolean) => lines.filter(f).length;
const only = (lines: Line[], allowed: (l: Line) => boolean) => lines.every(allowed);

/** Shape rules per event type. Returns true when the lines form a valid event. */
function shapeOk(e: LedgerEvent): boolean {
  const L = e.lines;
  const is = (k: Line["kind"], role: LineRole, sign?: "+" | "-") => (l: Line) =>
    l.kind === k && l.role === role && (sign === undefined || (sign === "+" ? gt0(l) : lt0(l)));
  const feeOrTax = (l: Line) => cash(l) && (l.role === "fee" || l.role === "tax") && lt0(l);

  switch (e.type) {
    case "buy":
      return (
        count(L, is("position", "trade", "+")) === 1 &&
        L.filter(is("position", "trade")).every((l) => l.costAmount !== null) &&
        count(L, is("cash", "trade", "-")) >= 1 &&
        only(L, (l) => is("position", "trade", "+")(l) || is("cash", "trade", "-")(l) || feeOrTax(l))
      );
    case "sell":
      return (
        count(L, is("position", "trade", "-")) === 1 &&
        L.filter(pos).every((l) => l.costAmount === null) &&
        count(L, is("cash", "trade", "+")) >= 1 &&
        only(L, (l) => is("position", "trade", "-")(l) || is("cash", "trade", "+")(l) || feeOrTax(l))
      );
    case "maturity":
      // The nominal repaid, with the last interest when there is one. That nothing of the
      // paper is left afterwards needs the history: only the database checks it.
      return (
        count(L, is("position", "trade", "-")) === 1 &&
        L.filter(pos).every((l) => l.costAmount === null) &&
        count(L, is("cash", "trade", "+")) >= 1 &&
        only(L, (l) => is("position", "trade", "-")(l) || is("cash", "trade", "+")(l) || is("cash", "income", "+")(l) || feeOrTax(l))
      );
    case "dividend":
    case "interest":
      return count(L, is("cash", "income", "+")) >= 1 && only(L, (l) => is("cash", "income", "+")(l) || feeOrTax(l));
    case "dividend_reinvest":
    case "interest_reinvest":
      return (
        count(L, is("cash", "income", "+")) >= 1 &&
        count(L, is("cash", "trade", "-")) >= 1 &&
        count(L, is("position", "trade", "+")) === 1 &&
        L.filter(pos).every((l) => l.costAmount !== null) &&
        only(L, (l) => is("cash", "income", "+")(l) || is("cash", "trade", "-")(l) || is("position", "trade", "+")(l) || feeOrTax(l))
      );
    case "split":
      return L.length === 1 && is("position", "split")(L[0]) && L[0].costAmount === null;
    case "fx_exchange": {
      const fx = L.filter(is("cash", "fx"));
      return (
        fx.length === 2 &&
        fx[0].currency !== fx[1].currency &&
        fx[0].accountId === fx[1].accountId &&
        count(fx, gt0) === 1 &&
        count(fx, lt0) === 1 &&
        only(L, (l) => is("cash", "fx")(l) || feeOrTax(l))
      );
    }
    case "deposit":
      return L.length === 1 && is("cash", "external", "+")(L[0]);
    case "withdrawal":
      return L.length === 1 && is("cash", "external", "-")(L[0]);
    case "fee":
      return L.length >= 1 && only(L, (l) => is("cash", "fee", "-")(l) || is("cash", "tax", "-")(l));
    case "transfer": {
      if (!only(L, (l) => l.role === "transfer") || new Set(L.map((l) => l.accountId)).size < 2) return false;
      if (L.some((l) => l.costAmount !== null)) return false; // lots carry their own cost
      const sums = new Map<string, Dec>();
      for (const l of L) {
        const k = pos(l) ? `p:${l.instrumentId}` : `c:${l.currency}`;
        sums.set(k, (sums.get(k) ?? new D(0)).plus(l.amount));
      }
      return [...sums.values()].every((s) => s.isZero());
    }
    case "opening_balance":
      return only(L, (l) => l.role === "opening" && gt0(l)) && L.filter(pos).every((l) => l.costAmount !== null);
    case "correction":
      if (e.correctionKind === "missing_flow") return L.length === 1 && cash(L[0]) && L[0].role === "external";
      return (
        only(L, (l) => l.role === "correction") &&
        L.filter(pos).every((l) => (gt0(l) ? l.costAmount !== null && l.costEstimated : l.costAmount === null))
      );
  }
}

export function validateEvent(e: LedgerEvent, ctx: ValidationContext): ValidationError[] {
  const errors = new Set<ValidationError>();
  if (e.lines.length === 0) return ["no_lines"];

  if ((e.type === "correction") !== (e.correctionKind !== null)) errors.add("correction_kind_mismatch");
  if ((e.type === "split") !== (e.splitRatio !== null && e.splitRatio.gt(0) && !e.splitRatio.eq(1))) errors.add("split_ratio_mismatch");
  if (e.type === "correction" && !e.note?.trim()) errors.add("note_required");

  for (const l of e.lines) {
    if (l.kind === "position") {
      if (!l.instrumentId) errors.add("position_without_instrument");
      else {
        const ccy = ctx.instrumentCurrency(l.instrumentId);
        if (ccy === undefined) errors.add("unknown_instrument");
        else if (ccy !== l.currency) errors.add("position_currency_mismatch");
      }
    } else if (l.costAmount !== null) errors.add("cost_on_cash_line");
    if (l.costAmount !== null && l.costAmount.lt(0)) errors.add("negative_cost");

    const start = ctx.trackingStart(l.accountId);
    if (start !== undefined) {
      if (e.type === "opening_balance" && e.date !== start) errors.add("opening_not_on_tracking_start");
      if (e.type !== "opening_balance" && e.date <= start) errors.add("before_tracking_start");
    }
  }
  if (!shapeOk(e)) errors.add("bad_shape");
  return [...errors];
}

// ------------------------------------------------------------------- replay

export type Lot = {
  lineId: string; // the acquiring line (for transfers: the original acquisition)
  acquiredOn: Day;
  qty: Dec;
  unitCost: Dec; // instrument currency
  costEstimated: boolean;
  costFxRefs: CostFxRefs | null;
};

export type Disposal = {
  eventId: string;
  date: Day;
  accountId: string;
  instrumentId: string;
  lot: Lot; // the consumed part (qty = sold quantity from this lot)
  cost: Dec;
};

export type Realized = {
  eventId: string;
  date: Day;
  accountId: string;
  instrumentId: string;
  currency: string;
  proceeds: Dec; // trade cash in the instrument currency
  fees: Dec; // fees converted to the instrument currency (positive number)
  cost: Dec;
  result: Dec; // proceeds − fees − cost
  costEstimated: boolean;
  incomplete: boolean; // a fee could not be converted
  disposals: Disposal[];
};

export type Flow = {
  eventId: string;
  date: Day;
  accountId: string;
  currency: string;
  amount: Dec; // + into the portfolio, − out of it
  kind: "deposit" | "withdrawal" | "missing_flow";
};

export type IncomeItem = {
  eventId: string;
  date: Day;
  accountId: string;
  instrumentId: string | null;
  currency: string;
  gross: Dec;
  tax: Dec; // positive number
};

export type LedgerState = {
  positions: Map<string, { accountId: string; instrumentId: string; qty: Dec; lots: Lot[] }>;
  cash: Map<string, { accountId: string; currency: string; amount: Dec }>;
  realized: Realized[];
  income: IncomeItem[];
  fees: Array<{ eventId: string; date: Day; accountId: string; currency: string; amount: Dec }>;
  flows: Flow[];
  reconciliations: Array<{ eventId: string; date: Day; accountId: string; line: Line }>;
  errors: Array<{ eventId: string; error: "insufficient_quantity" | "transfer_mismatch" }>;
};

/** Converts `amount` from→to on `day`; null when no rate is available. */
export type FxFn = (amount: Dec, from: string, to: string, day: Day) => Dec | null;

const posKey = (accountId: string, instrumentId: string) => `${accountId}|${instrumentId}`;
const cashKey = (accountId: string, currency: string) => `${accountId}|${currency}`;

export function orderEvents(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));
}

/** Replays events up to and including `upTo` (all when omitted). */
export function runLedger(events: LedgerEvent[], fx: FxFn, upTo?: Day): LedgerState {
  const s: LedgerState = { positions: new Map(), cash: new Map(), realized: [], income: [], fees: [], flows: [], reconciliations: [], errors: [] };

  const position = (accountId: string, instrumentId: string) => {
    const k = posKey(accountId, instrumentId);
    let p = s.positions.get(k);
    if (!p) s.positions.set(k, (p = { accountId, instrumentId, qty: new D(0), lots: [] }));
    return p;
  };
  const addCash = (accountId: string, currency: string, amount: Dec) => {
    const k = cashKey(accountId, currency);
    const c = s.cash.get(k) ?? { accountId, currency, amount: new D(0) };
    c.amount = c.amount.plus(amount);
    s.cash.set(k, c);
  };
  /** Removes `qty` FIFO; returns the consumed lot parts or null if not enough. */
  const takeFifo = (p: { qty: Dec; lots: Lot[] }, qty: Dec): Lot[] | null => {
    if (p.qty.lt(qty)) return null;
    const taken: Lot[] = [];
    let left = qty;
    while (left.gt(0)) {
      const lot = p.lots[0];
      const q = D.min(lot.qty, left);
      taken.push({ ...lot, qty: q });
      lot.qty = lot.qty.minus(q);
      if (lot.qty.isZero()) p.lots.shift();
      left = left.minus(q);
    }
    p.qty = p.qty.minus(qty);
    return taken;
  };

  for (const e of orderEvents(events)) {
    if (upTo && e.date > upTo) break;

    // Cash first: every cash line moves a balance.
    for (const l of e.lines.filter(cash)) addCash(l.accountId, l.currency, l.amount);

    switch (e.type) {
      case "buy":
      case "dividend_reinvest":
      case "interest_reinvest":
      case "opening_balance": {
        for (const l of e.lines.filter(pos)) {
          const p = position(l.accountId, l.instrumentId!);
          p.lots.push({ lineId: l.id, acquiredOn: e.date, qty: l.amount, unitCost: l.costAmount!.div(l.amount), costEstimated: l.costEstimated, costFxRefs: l.costFxRefs });
          p.qty = p.qty.plus(l.amount);
        }
        break;
      }
      case "sell":
      case "maturity": {
        const pl = e.lines.find(pos)!;
        const p = position(pl.accountId, pl.instrumentId!);
        const taken = takeFifo(p, pl.amount.neg());
        if (!taken) {
          s.errors.push({ eventId: e.id, error: "insufficient_quantity" });
          break;
        }
        const currency = pl.currency;
        let incomplete = false;
        const proceeds = e.lines
          .filter((l) => cash(l) && l.role === "trade")
          .reduce((acc, l) => {
            const v = l.currency === currency ? l.amount : fx(l.amount, l.currency, currency, e.date);
            if (v === null) incomplete = true;
            return acc.plus(v ?? 0);
          }, new D(0));
        const fees = e.lines
          .filter((l) => cash(l) && (l.role === "fee" || l.role === "tax"))
          .reduce((acc, l) => {
            const v = l.currency === currency ? l.amount : fx(l.amount, l.currency, currency, e.date);
            if (v === null) incomplete = true;
            return acc.plus((v ?? new D(0)).neg());
          }, new D(0));
        const disposals = taken.map((lot) => ({ eventId: e.id, date: e.date, accountId: pl.accountId, instrumentId: pl.instrumentId!, lot, cost: lot.qty.times(lot.unitCost) }));
        const cost = disposals.reduce((acc, d) => acc.plus(d.cost), new D(0));
        s.realized.push({
          eventId: e.id, date: e.date, accountId: pl.accountId, instrumentId: pl.instrumentId!, currency,
          proceeds, fees, cost, result: proceeds.minus(fees).minus(cost),
          costEstimated: taken.some((l) => l.costEstimated), incomplete, disposals,
        });
        break;
      }
      case "split": {
        const l = e.lines[0];
        const p = position(l.accountId, l.instrumentId!);
        const r = e.splitRatio!;
        for (const lot of p.lots) {
          lot.qty = lot.qty.times(r);
          lot.unitCost = lot.unitCost.div(r);
        }
        p.qty = p.qty.times(r);
        break;
      }
      case "transfer": {
        // Lots leave the source FIFO and arrive unchanged (cost, date, FX refs).
        const queue = new Map<string, Lot[]>();
        for (const l of e.lines.filter((x) => pos(x) && lt0(x))) {
          const taken = takeFifo(position(l.accountId, l.instrumentId!), l.amount.neg());
          if (!taken) {
            s.errors.push({ eventId: e.id, error: "insufficient_quantity" });
            continue;
          }
          queue.set(l.instrumentId!, [...(queue.get(l.instrumentId!) ?? []), ...taken]);
        }
        for (const l of e.lines.filter((x) => pos(x) && gt0(x))) {
          const q = queue.get(l.instrumentId!) ?? [];
          const p = position(l.accountId, l.instrumentId!);
          let left = l.amount;
          while (left.gt(0) && q.length) {
            const lot = q[0];
            const take = D.min(lot.qty, left);
            p.lots.push({ ...lot, qty: take });
            lot.qty = lot.qty.minus(take);
            if (lot.qty.isZero()) q.shift();
            left = left.minus(take);
          }
          p.qty = p.qty.plus(l.amount.minus(left));
          if (left.gt(0)) s.errors.push({ eventId: e.id, error: "transfer_mismatch" });
        }
        break;
      }
      case "correction": {
        if (e.correctionKind === "missing_flow") {
          const l = e.lines[0];
          s.flows.push({ eventId: e.id, date: e.date, accountId: l.accountId, currency: l.currency, amount: l.amount, kind: "missing_flow" });
          break;
        }
        for (const l of e.lines) {
          s.reconciliations.push({ eventId: e.id, date: e.date, accountId: l.accountId, line: l });
          if (!pos(l)) continue;
          const p = position(l.accountId, l.instrumentId!);
          if (gt0(l)) {
            p.lots.push({ lineId: l.id, acquiredOn: e.date, qty: l.amount, unitCost: l.costAmount!.div(l.amount), costEstimated: true, costFxRefs: l.costFxRefs });
            p.qty = p.qty.plus(l.amount);
          } else if (!takeFifo(p, l.amount.neg())) s.errors.push({ eventId: e.id, error: "insufficient_quantity" });
        }
        break;
      }
      case "deposit":
      case "withdrawal": {
        const l = e.lines[0];
        s.flows.push({ eventId: e.id, date: e.date, accountId: l.accountId, currency: l.currency, amount: l.amount, kind: e.type });
        break;
      }
    }

    // Income, taxes and fees are reported for every event type that has them.
    const incomeLines = e.lines.filter((l) => cash(l) && l.role === "income");
    if (incomeLines.length) {
      const taxes = e.lines.filter((l) => cash(l) && l.role === "tax");
      for (const l of incomeLines) {
        const tax = taxes.filter((t) => t.currency === l.currency && t.accountId === l.accountId).reduce((a, t) => a.plus(t.amount.neg()), new D(0));
        s.income.push({ eventId: e.id, date: e.date, accountId: l.accountId, instrumentId: l.instrumentId, currency: l.currency, gross: l.amount, tax });
      }
    }
    for (const l of e.lines.filter((x) => cash(x) && x.role === "fee")) {
      s.fees.push({ eventId: e.id, date: e.date, accountId: l.accountId, currency: l.currency, amount: l.amount.neg() });
    }
  }

  for (const [k, p] of s.positions) if (p.qty.isZero() && p.lots.length === 0) s.positions.delete(k);
  return s;
}

/** Remaining cost basis of a position (instrument currency). */
export function costBasis(lots: Lot[]): Dec {
  return lots.reduce((acc, l) => acc.plus(l.qty.times(l.unitCost)), new D(0));
}
