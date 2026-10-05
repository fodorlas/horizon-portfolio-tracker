/**
 * Turns the "new transaction" form into ledger lines (plan §2, §3.2).
 *
 * Pure: everything it needs from the database comes in through BuildContext,
 * so every event type is unit-tested with hand-checked numbers. The result is
 * checked with validateEvent() (the TypeScript mirror of the database's
 * deferred validator); the database checks it once more when it is recorded.
 */
import { selectFx, type FxRow, type FxSelection } from "@/lib/finance/fx";
import { type CostFxRefs, type EventType, EVENT_TYPES, type LedgerEvent, type Line, type LineRole, validateEvent } from "@/lib/finance/ledger";
import { D, type Day, DISPLAY_CURRENCIES, type Dec, isCurrency, isDay } from "@/lib/finance/money";
import type { Locale } from "@/lib/prefs-shared";
import { endOfDayBudapest, parseDecimal } from "./parse";

export const TX_FIELDS = [
  "type", "date", "note", "accountId", "toAccountId", "instrumentId", "asset", "direction", "correctionKind",
  "currency", "amount", "quantity", "price", "total", "fee", "feeCurrency", "tax", "gross", "reinvest",
  "fromCurrency", "fromAmount", "toCurrency", "toAmount", "ratioFrom", "ratioTo", "cost", "value",
] as const;
export type TxField = (typeof TX_FIELDS)[number];
export type TxInput = Partial<Record<TxField, string>>;

export type TxErrorCode =
  | "required" | "number" | "decimals" | "ambiguous" | "positive" | "date" | "future" | "beforeStart" | "unknown"
  | "sameAccount" | "sameCurrency" | "insufficient" | "noHolding" | "noPrice" | "noFxFee" | "ratio"
  | "noteRequired" | "noteTooLong" | "invalid";
export type TxErrors = Partial<Record<TxField | "form", TxErrorCode>>;

export type BuildContext = {
  today: Day;
  /** The language the form was filled in: how its numbers are read (spec 2026-10-01 §2.5). */
  locale: Locale;
  accounts: Map<string, { trackingStart: Day }>;
  instruments: Map<string, { currency: string; valuation: "market" | "manual"; priceSource?: string }>;
  fxRows: FxRow[];
  /** Quantity held at the end of `day`, events recorded so far included. */
  holding: (accountId: string, instrumentId: string, day: Day) => Dec;
  /** Selected price (plan §3.3) for the day, or null. */
  priceOn: (instrumentId: string, day: Day) => Dec | null;
};

export type LinePayload = {
  kind: "position" | "cash";
  accountId: string;
  instrumentId: string | null;
  currency: string;
  amount: string;
  role: LineRole;
  costAmount: string | null;
  costEstimated: boolean;
  costFxRefs: CostFxRefs | null;
};
export type QuoteExtra = { instrumentId: string; price: string; currency: string; asOf: string; note: string };
export type ValuationExtra = { accountId: string; instrumentId: string; value: string; currency: string; asOf: string; note: string };

export type TxPayload = {
  event: { type: EventType; date: Day; correctionKind: "missing_flow" | "reconciliation" | null; splitRatio: string | null; note: string | null };
  lines: LinePayload[];
  extras: { quotes: QuoteExtra[]; valuations: ValuationExtra[] };
};

/** What the advanced form offers: everything but the maturity, which only a proposal records (spec 2026-09-28 §6). */
export const TX_TYPES = EVENT_TYPES.filter((t) => t !== "maturity");

export type BuildResult = { ok: true; payload: TxPayload } | { ok: false; errors: TxErrors };

export const NOTE_MAX = 500;
export const OPENING_PRICE_NOTE = "Nyitó ár (nyitó egyenleg)";
export const OPENING_VALUE_NOTE = "Nyitó érték (nyitó egyenleg)";

const r10 = (d: Dec) => d.toDecimalPlaces(10);
const refOf = (s: FxSelection): string[] | null => (s.kind === "identity" ? [] : s.kind === "rate" ? s.rowIds : null);

export type Inst = { id: string; currency: string; valuation: "market" | "manual" };
type NumOpts = { required?: boolean; allowZero?: boolean; signed?: boolean };

/** Reads fields and collects the first error per field. */
class Reader {
  readonly errors: TxErrors = {};
  constructor(private readonly input: TxInput, private readonly ctx: BuildContext) {}

  fail(field: TxField | "form", code: TxErrorCode): undefined {
    this.errors[field] ??= code;
    return undefined;
  }
  get failed() {
    return Object.keys(this.errors).length > 0;
  }
  text(f: TxField): string | undefined {
    const v = this.input[f]?.trim();
    return v ? v : undefined;
  }
  req(f: TxField): string | undefined {
    return this.text(f) ?? this.fail(f, "required");
  }
  num(f: TxField, { required = true, allowZero = false, signed = false }: NumOpts = {}): Dec | undefined {
    const raw = this.text(f);
    if (raw === undefined) return required ? this.fail(f, "required") : undefined;
    const p = parseDecimal(raw, this.ctx.locale);
    if (!p.ok) return this.fail(f, p.error);
    if (!signed && (p.value.lt(0) || (!allowZero && p.value.isZero()))) return this.fail(f, "positive");
    return p.value;
  }
  choice<T extends string>(f: TxField, options: readonly T[]): T | undefined {
    const v = this.req(f);
    if (v === undefined) return undefined;
    return options.includes(v as T) ? (v as T) : this.fail(f, "unknown");
  }
  account(f: TxField): string | undefined {
    const id = this.req(f);
    if (id === undefined) return undefined;
    return this.ctx.accounts.has(id) ? id : this.fail(f, "unknown");
  }
  instrument(f: TxField): Inst | undefined {
    const id = this.req(f);
    if (id === undefined) return undefined;
    const i = this.ctx.instruments.get(id);
    return i ? { id, ...i } : this.fail(f, "unknown");
  }
  currency(f: TxField, fallback?: string): string | undefined {
    const v = this.text(f)?.toUpperCase() ?? fallback;
    if (v === undefined) return this.fail(f, "required");
    return isCurrency(v) ? v : this.fail(f, "unknown");
  }
}

export function cash(accountId: string, currency: string, amount: Dec, role: LineRole, instrumentId: string | null = null): LinePayload {
  return { kind: "cash", accountId, instrumentId, currency, amount: r10(amount).toFixed(), role, costAmount: null, costEstimated: false, costFxRefs: null };
}

export function position(accountId: string, inst: Inst, amount: Dec, role: LineRole, cost?: { amount: Dec; estimated: boolean; refs: CostFxRefs }): LinePayload {
  return {
    kind: "position", accountId, instrumentId: inst.id, currency: inst.currency, amount: r10(amount).toFixed(), role,
    costAmount: cost ? r10(cost.amount).toFixed() : null, costEstimated: cost?.estimated ?? false, costFxRefs: cost?.refs ?? null,
  };
}

/** FX rows for HUF, EUR and USD on the acquisition day (plan §3.2). */
export function costRefs(ctx: Pick<BuildContext, "fxRows">, currency: string, day: Day): CostFxRefs {
  const refs: CostFxRefs = {};
  for (const to of DISPLAY_CURRENCIES) refs[to] = refOf(selectFx(ctx.fxRows, currency, to, day));
  return refs;
}

export function buildTransaction(input: TxInput, ctx: BuildContext): BuildResult {
  const r = new Reader(input, ctx);
  const type = r.choice("type", TX_TYPES);
  if (type === undefined) return { ok: false, errors: r.errors };

  let date = r.req("date");
  if (date !== undefined && !isDay(date)) date = r.fail("date", "date");
  if (date !== undefined && date > ctx.today) date = r.fail("date", "future");

  const note = r.text("note");
  if (note && note.length > NOTE_MAX) r.fail("note", "noteTooLong");

  const lines: LinePayload[] = [];
  const quotes: QuoteExtra[] = [];
  const valuations: ValuationExtra[] = [];
  let correctionKind: TxPayload["event"]["correctionKind"] = null;
  let splitRatio: string | null = null;
  const day = date ?? ctx.today; // only used once every field is valid

  switch (type) {
    case "buy": {
      const acc = r.account("accountId");
      const inst = r.instrument("instrumentId");
      const qty = r.num("quantity");
      const total = r.num("total", { required: false });
      const price = r.num("price", { required: total === undefined });
      const fee = r.num("fee", { required: false, allowZero: true });
      const feeCcy = r.currency("feeCurrency", inst?.currency);
      if (r.failed || !acc || !inst || !qty || !feeCcy) break;

      const trade = total ?? qty.times(price!);
      const refs = costRefs(ctx, inst.currency, day);
      let feeInInstrument = new D(0);
      if (fee?.gt(0)) {
        if (feeCcy === inst.currency) feeInInstrument = fee;
        else {
          const sel = selectFx(ctx.fxRows, feeCcy, inst.currency, day);
          if (sel.kind !== "rate") {
            r.fail("fee", "noFxFee");
            break;
          }
          feeInInstrument = fee.times(sel.rate);
          refs.fee = sel.rowIds;
        }
      }
      lines.push(position(acc, inst, qty, "trade", { amount: trade.plus(feeInInstrument), estimated: false, refs }));
      lines.push(cash(acc, inst.currency, trade.neg(), "trade"));
      if (fee?.gt(0)) lines.push(cash(acc, feeCcy, fee.neg(), "fee"));
      break;
    }
    case "sell": {
      const acc = r.account("accountId");
      const inst = r.instrument("instrumentId");
      const qty = r.num("quantity");
      const total = r.num("total", { required: false });
      const price = r.num("price", { required: total === undefined });
      const fee = r.num("fee", { required: false, allowZero: true });
      const feeCcy = r.currency("feeCurrency", inst?.currency);
      if (r.failed || !acc || !inst || !qty || !feeCcy) break;
      if (ctx.holding(acc, inst.id, day).lt(qty)) {
        r.fail("quantity", "insufficient");
        break;
      }
      lines.push(position(acc, inst, qty.neg(), "trade"));
      lines.push(cash(acc, inst.currency, total ?? qty.times(price!), "trade"));
      if (fee?.gt(0)) lines.push(cash(acc, feeCcy, fee.neg(), "fee"));
      break;
    }
    case "dividend":
    case "interest": {
      const acc = r.account("accountId");
      // An interest may name the government security that paid it in cash, so its proposal counts as recorded (spec 2026-09-28 §6).
      const inst = type === "dividend" || r.text("instrumentId") ? r.instrument("instrumentId") : undefined;
      if (type === "interest" && inst && ctx.instruments.get(inst.id)?.priceSource !== "akk") r.fail("instrumentId", "unknown");
      const ccy = type === "interest" && inst ? inst.currency : r.currency("currency", inst?.currency);
      const gross = r.num("gross");
      const tax = r.num("tax", { required: false, allowZero: true });
      if (r.failed || !acc || !ccy || !gross) break;
      lines.push(cash(acc, ccy, gross, "income", inst?.id ?? null));
      if (tax?.gt(0)) lines.push(cash(acc, ccy, tax.neg(), "tax"));
      break;
    }
    case "dividend_reinvest": {
      const acc = r.account("accountId");
      const inst = r.instrument("instrumentId");
      const gross = r.num("gross");
      const tax = r.num("tax", { required: false, allowZero: true });
      const qty = r.num("quantity");
      const reinvestInput = r.num("reinvest", { required: false });
      if (r.failed || !acc || !inst || !gross || !qty) break;
      const reinvest = reinvestInput ?? gross.minus(tax ?? 0);
      if (reinvest.lte(0)) {
        r.fail("reinvest", "positive");
        break;
      }
      lines.push(cash(acc, inst.currency, gross, "income", inst.id));
      if (tax?.gt(0)) lines.push(cash(acc, inst.currency, tax.neg(), "tax"));
      lines.push(cash(acc, inst.currency, reinvest.neg(), "trade"));
      lines.push(position(acc, inst, qty, "trade", { amount: reinvest, estimated: false, refs: costRefs(ctx, inst.currency, day) }));
      break;
    }
    case "interest_reinvest": {
      // A MÁP Plusz interest in papers of the same series: 1 unit is 1 Ft nominal (spec 2026-09-28 §7).
      const acc = r.account("accountId");
      const inst = r.instrument("instrumentId");
      if (inst && ctx.instruments.get(inst.id)?.priceSource !== "akk") r.fail("instrumentId", "unknown");
      const gross = r.num("gross");
      if (r.failed || !acc || !inst || !gross) break;
      lines.push(cash(acc, inst.currency, gross, "income", inst.id));
      lines.push(cash(acc, inst.currency, gross.neg(), "trade"));
      lines.push(position(acc, inst, gross, "trade", { amount: gross, estimated: false, refs: costRefs(ctx, inst.currency, day) }));
      break;
    }
    case "split": {
      const acc = r.account("accountId");
      const inst = r.instrument("instrumentId");
      const from = r.num("ratioFrom");
      const to = r.num("ratioTo");
      if (r.failed || !acc || !inst || !from || !to) break;
      const ratio = r10(to.div(from));
      if (ratio.lte(0) || ratio.eq(1)) {
        r.fail("ratioTo", "ratio");
        break;
      }
      const before = ctx.holding(acc, inst.id, day);
      if (before.lte(0)) {
        r.fail("instrumentId", "noHolding");
        break;
      }
      const delta = r10(before.times(ratio.minus(1)));
      if (delta.isZero()) {
        r.fail("ratioTo", "ratio");
        break;
      }
      splitRatio = ratio.toFixed();
      lines.push(position(acc, inst, delta, "split"));
      break;
    }
    case "fx_exchange": {
      const acc = r.account("accountId");
      const fromCcy = r.currency("fromCurrency");
      const fromAmount = r.num("fromAmount");
      const toCcy = r.currency("toCurrency");
      const toAmount = r.num("toAmount");
      const fee = r.num("fee", { required: false, allowZero: true });
      const feeCcy = r.currency("feeCurrency", fromCcy);
      if (fromCcy && toCcy && fromCcy === toCcy) r.fail("toCurrency", "sameCurrency");
      if (r.failed || !acc || !fromCcy || !fromAmount || !toCcy || !toAmount || !feeCcy) break;
      lines.push(cash(acc, fromCcy, fromAmount.neg(), "fx"));
      lines.push(cash(acc, toCcy, toAmount, "fx"));
      if (fee?.gt(0)) lines.push(cash(acc, feeCcy, fee.neg(), "fee"));
      break;
    }
    case "deposit":
    case "withdrawal":
    case "fee": {
      const acc = r.account("accountId");
      const ccy = r.currency("currency");
      const amount = r.num("amount");
      if (r.failed || !acc || !ccy || !amount) break;
      if (type === "deposit") lines.push(cash(acc, ccy, amount, "external"));
      else if (type === "withdrawal") lines.push(cash(acc, ccy, amount.neg(), "external"));
      else lines.push(cash(acc, ccy, amount.neg(), "fee"));
      break;
    }
    case "transfer": {
      const from = r.account("accountId");
      const to = r.account("toAccountId");
      if (from && to && from === to) r.fail("toAccountId", "sameAccount");
      const asset = r.choice("asset", ["cash", "position"] as const);
      if (asset === "cash") {
        const ccy = r.currency("currency");
        const amount = r.num("amount");
        if (r.failed || !from || !to || !ccy || !amount) break;
        lines.push(cash(from, ccy, amount.neg(), "transfer"), cash(to, ccy, amount, "transfer"));
      } else if (asset === "position") {
        const inst = r.instrument("instrumentId");
        const qty = r.num("quantity");
        if (r.failed || !from || !to || !inst || !qty) break;
        if (ctx.holding(from, inst.id, day).lt(qty)) {
          r.fail("quantity", "insufficient");
          break;
        }
        lines.push(position(from, inst, qty.neg(), "transfer"), position(to, inst, qty, "transfer"));
      }
      break;
    }
    case "opening_balance": {
      const acc = r.account("accountId");
      const asset = r.choice("asset", ["cash", "position"] as const);
      if (!acc) break;
      // Always the tracking-start day (plan §2): the END of that day.
      date = ctx.accounts.get(acc)!.trackingStart;
      delete r.errors.date;
      if (asset === "cash") {
        const ccy = r.currency("currency");
        const amount = r.num("amount");
        if (r.failed || !ccy || !amount) break;
        lines.push(cash(acc, ccy, amount, "opening"));
      } else if (asset === "position") {
        const inst = r.instrument("instrumentId");
        const qty = r.num("quantity");
        const manual = inst?.valuation === "manual";
        const price = manual ? undefined : r.num("price");
        const value = manual ? r.num("value") : undefined;
        const knownCost = r.num("cost", { required: false, allowZero: true });
        if (r.failed || !inst || !qty) break;
        const asOf = endOfDayBudapest(date);
        const marketValue = manual ? value! : qty.times(price!);
        if (manual) valuations.push({ accountId: acc, instrumentId: inst.id, value: r10(value!).toFixed(), currency: inst.currency, asOf, note: OPENING_VALUE_NOTE });
        else quotes.push({ instrumentId: inst.id, price: r10(price!).toFixed(), currency: inst.currency, asOf, note: OPENING_PRICE_NOTE });
        lines.push(
          position(acc, inst, qty, "opening", {
            amount: knownCost ?? marketValue,
            estimated: knownCost === undefined,
            refs: costRefs(ctx, inst.currency, date),
          }),
        );
      }
      break;
    }
    case "correction": {
      correctionKind = r.choice("correctionKind", ["missing_flow", "reconciliation"] as const) ?? null;
      if (!note) r.fail("note", "noteRequired");
      const acc = r.account("accountId");
      const dir = r.choice("direction", ["in", "out"] as const);
      const sign = (d: Dec) => (dir === "out" ? d.neg() : d);
      if (correctionKind === "missing_flow") {
        const ccy = r.currency("currency");
        const amount = r.num("amount");
        if (r.failed || !acc || !ccy || !amount) break;
        lines.push(cash(acc, ccy, sign(amount), "external"));
      } else if (correctionKind === "reconciliation") {
        const asset = r.choice("asset", ["cash", "position"] as const);
        if (asset === "cash") {
          const ccy = r.currency("currency");
          const amount = r.num("amount");
          if (r.failed || !acc || !ccy || !amount) break;
          lines.push(cash(acc, ccy, sign(amount), "correction"));
        } else if (asset === "position") {
          const inst = r.instrument("instrumentId");
          const qty = r.num("quantity");
          const priceInput = r.num("price", { required: false });
          if (r.failed || !acc || !inst || !qty) break;
          if (dir === "out") {
            if (ctx.holding(acc, inst.id, day).lt(qty)) {
              r.fail("quantity", "insufficient");
              break;
            }
            lines.push(position(acc, inst, qty.neg(), "correction"));
          } else {
            // Cost = market value on the correction day, marked as estimated (plan §2).
            const price = priceInput ?? ctx.priceOn(inst.id, day);
            if (!price) {
              r.fail("price", "noPrice");
              break;
            }
            lines.push(position(acc, inst, qty, "correction", { amount: qty.times(price), estimated: true, refs: costRefs(ctx, inst.currency, day) }));
          }
        }
      }
      break;
    }
  }

  if (r.failed || date === undefined) return { ok: false, errors: r.errors };

  const payload: TxPayload = {
    event: { type, date, correctionKind, splitRatio, note: note ?? null },
    lines,
    extras: { quotes, valuations },
  };
  const problems = validateEvent(toLedgerEvent(payload), {
    instrumentCurrency: (id) => ctx.instruments.get(id)?.currency,
    trackingStart: (id) => ctx.accounts.get(id)?.trackingStart,
  });
  if (problems.includes("before_tracking_start")) return { ok: false, errors: { date: "beforeStart" } };
  if (problems.length) return { ok: false, errors: { form: "invalid" } };
  return { ok: true, payload };
}

/** The payload as the finance core sees it (for validation and previews). */
export function toLedgerEvent(p: TxPayload, id = "new", createdAt = new Date().toISOString()): LedgerEvent {
  return {
    id, type: p.event.type, date: p.event.date, createdAt, correctionKind: p.event.correctionKind,
    splitRatio: p.event.splitRatio === null ? null : new D(p.event.splitRatio), note: p.event.note,
    lines: p.lines.map(
      (l, i): Line => ({
        id: `${id}-${i}`, kind: l.kind, accountId: l.accountId, instrumentId: l.instrumentId, currency: l.currency,
        amount: new D(l.amount), role: l.role, costAmount: l.costAmount === null ? null : new D(l.costAmount),
        costEstimated: l.costEstimated, costFxRefs: l.costFxRefs,
      }),
    ),
  };
}
