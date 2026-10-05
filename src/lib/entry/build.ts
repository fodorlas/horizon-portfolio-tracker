/**
 * The simple form → one record_entry payload (4c plan §1–§2, with the owner's
 * change of 2026-09-27: no Mai állomány tab, every holding is a buy on its day).
 *
 *  - Vétel: the account's cash first (spec 2026-09-28 §3.4), a deposit of the
 *    rest, then the buy. Without a price or a total, the Yahoo close on or
 *    before the buy day is the price, and the cost is marked estimated.
 *  - Eladás: the sale (FIFO in the core); the money stays on the account, or
 *    a withdrawal takes the net proceeds out when the owner says so.
 *  - Manual-valued items move units at the latest value's unit price, and the
 *    entry stores the new total (typed, or the previous total ± the amount).
 *  - Government securities (spec 2026-09-28 §3.1–§3.2): a series from the ÁKK
 *    list; units are the nominal in forints, the cost is the amount paid. Only
 *    a today's buy may leave the amount out (the Kincstár's ask + accrued).
 *
 * Pure: the database facts and the Yahoo lookups come in through
 * EntryContext; the result is validated with validateEvent() like the
 * advanced form's, and the database checks it once more.
 */
import { ACCOUNT_TYPES, ASSET_CLASSES } from "@/lib/actions/schemas";
import type { FxRow } from "@/lib/finance/fx";
import { type LedgerEvent, type Line, validateEvent } from "@/lib/finance/ledger";
import { addDays, D, type Day, type Dec, isCurrency, isDay } from "@/lib/finance/money";
import type { AssetClass } from "@/lib/finance/valuation";
import type { Locale } from "@/lib/prefs-shared";
import { type AkkRow, buyEstimate, typeLabel } from "@/lib/providers/akk";
import type { SymbolInfo } from "@/lib/providers/symbols";
import { cash, costRefs, type Inst, type LinePayload, NOTE_MAX, position, type QuoteExtra, type ValuationExtra } from "@/lib/tx/build";
import { endOfDayBudapest, parseDecimal } from "@/lib/tx/parse";
import type { EntryInput, InstrumentInput } from "./input";

export { emptyEntryInput, type EntryInput } from "./input";

/** How the entry's own total of a manual item came about (edit shows the typed one only). */
export const ENTRY_VALUE_NOTE = "Tétel: megadott új összérték";
export const ENTRY_AUTO_VALUE_NOTE = "Tétel: előző érték ± befizetés/kivét";

export type EntryContext = {
  today: Day;
  /** The language the form was filled in: how its numbers are read (spec 2026-10-01 §2.5). */
  locale: Locale;
  institutions: Set<string>;
  accounts: Map<string, { institutionId: string; trackingStart: Day; hasOpening: boolean }>;
  instruments: Map<string, { name: string; currency: string; valuation: "market" | "manual"; priceSource: string; symbol: string | null }>;
  fxRows: FxRow[];
  /** Quantity at the end of `day`, the edited entry left out. */
  holding: (accountId: string, instrumentId: string, day: Day) => Dec;
  /** A manual item's selected total on `day`, the edited entry left out. */
  valueOn: (accountId: string, instrumentId: string, day: Day) => Dec | null;
  /** The day a maturity (Lejárat) was booked on this holding, the edited entry left out; null: none. */
  maturityBooked: (accountId: string, instrumentId: string) => Day | null;
  /** What a buy on `day` may take from the account's cash in `currency` (cash.ts), the edited entry left out. */
  availableCash: (accountId: string, currency: string, day: Day) => Dec;
  /** Yahoo lookups by upper-case symbol (see lookupPlan); null: not found. */
  symbols: Map<string, SymbolInfo | null>;
  /** BÉT lookups by upper-case code (see lookupPlan); null: not listed. */
  betSymbols?: Map<string, SymbolInfo | null>;
  /** Today's ÁKK rows by upper-case series (see lookupPlan); null: not on the list. */
  akk?: Map<string, AkkRow | null>;
  /** The maturity of each ÁKK instrument already there (bond_terms). */
  bondMaturity?: Map<string, Day>;
  newId: () => string;
  /** Set when an existing entry is replaced: its id is kept. */
  entryId?: string;
};

export type NewInstrument = {
  id: string;
  name: string;
  assetClass: AssetClass;
  currency: string;
  ticker: string | null;
  exchange: string | null;
  valuation: "market" | "manual";
  priceSource: "yahoo" | "bet" | "manual" | "akk";
  providerSymbol: string | null;
  /** A government security's terms (bond_terms). */
  bond?: { series: string; securityType: string; tab: string; issueDate: Day; maturityDate: Day };
};

export type EntryEventType = "deposit" | "buy" | "sell" | "withdrawal" | "interest" | "interest_reinvest" | "maturity";
export type EntryEvent = { type: EntryEventType; date: Day; note: string | null; lines: LinePayload[]; quotes: QuoteExtra[]; valuations: ValuationExtra[] };
/** A market close standing in for a buy's price, from the instrument's own source. */
export type EstimateQuote = { instrumentId: string; price: string; currency: string; asOf: string; source: "yahoo" | "bet" };

export type EntryPayload = {
  institution?: { id: string; name: string };
  account?: { id: string; institutionId: string; name: string; accountType: string; trackingStart: Day };
  instruments: NewInstrument[];
  trackingStart?: { accountId: string; day: Day };
  quotes: EstimateQuote[];
  entries: { id: string; events: EntryEvent[] }[];
};

export type EntryErrors = Record<string, string>;
export type EntryResult = { ok: true; payload: EntryPayload } | { ok: false; errors: EntryErrors };

const r10 = (d: Dec) => d.toDecimalPlaces(10);
const upper = (s: string) => s.trim().toUpperCase();

/** `quoted`: where a close for this instrument comes from (its own market source), if anywhere. */
type Quoted = { source: "yahoo" | "bet"; symbol: string };
type Resolved = Inst & { quoted: Quoted | null; bond?: { series: string; maturity: Day | null } };

/** The market source of an instrument that has one: Yahoo or the BÉT. */
const quotedOf = (i: { priceSource: string; symbol: string | null }): Quoted | null =>
  (i.priceSource === "yahoo" || i.priceSource === "bet") && i.symbol ? { source: i.priceSource, symbol: upper(i.symbol) } : null;

class Builder {
  readonly errors: EntryErrors = {};
  readonly payload: EntryPayload = { instruments: [], quotes: [], entries: [] };
  private readonly newYahoo = new Map<string, Resolved>();
  private readonly newBet = new Map<string, Resolved>();
  private readonly newAkk = new Map<string, Resolved>();

  constructor(
    readonly input: EntryInput,
    readonly ctx: EntryContext,
  ) {}

  fail(key: string, code: string): undefined {
    this.errors[key] ??= code;
    return undefined;
  }
  get failed() {
    return Object.keys(this.errors).length > 0;
  }

  text(key: string, raw: string, max: number): string | undefined {
    const v = raw.trim();
    if (!v) return this.fail(key, "required");
    if (v.length > max) return this.fail(key, "tooLong");
    return v;
  }

  num(key: string, raw: string, { required = true, allowZero = false } = {}): Dec | undefined {
    if (!raw.trim()) return required ? this.fail(key, "required") : undefined;
    const p = parseDecimal(raw, this.ctx.locale);
    if (!p.ok) return this.fail(key, p.error);
    if (p.value.lt(0) || (!allowZero && p.value.isZero())) return this.fail(key, "positive");
    return p.value;
  }

  day(key: string, raw: string): Day | undefined {
    const v = raw.trim();
    if (!v) return this.fail(key, "required");
    if (!isDay(v)) return this.fail(key, "date");
    if (v > this.ctx.today) return this.fail(key, "future");
    return v;
  }

  currency(key: string, raw: string): string | undefined {
    const v = upper(raw);
    if (!v) return this.fail(key, "required");
    return isCurrency(v) ? v : this.fail(key, "currency");
  }

  /** The instrument an input names, creating a new one in the payload when needed. */
  instrument(key: string, inp: InstrumentInput): Resolved | undefined {
    const { ctx } = this;
    if (inp.mode === "existing") {
      const i = ctx.instruments.get(inp.id);
      if (!i) return this.fail(key, "unknown");
      if (i.priceSource === "akk" && i.symbol) return existingAkk(ctx, upper(i.symbol));
      return { id: inp.id, currency: i.currency, valuation: i.valuation, quoted: quotedOf(i) };
    }
    if (inp.mode === "akk") {
      const series = upper(inp.symbol);
      if (!series) return this.fail(key, "required");
      const known = existingAkk(ctx, series);
      if (known) return known;
      const made = this.newAkk.get(series);
      if (made) return made;
      const row = ctx.akk?.get(series);
      if (!row) return this.fail(key, "seriesNotFound");
      const r: Resolved = { id: ctx.newId(), currency: "HUF", valuation: "market", quoted: null, bond: { series: row.series, maturity: row.maturity } };
      this.payload.instruments.push({
        id: r.id, name: `${typeLabel(row)} ${row.series}`, assetClass: "bond", currency: "HUF", ticker: null, exchange: null,
        valuation: "market", priceSource: "akk", providerSymbol: row.series,
        bond: { series: row.series, securityType: row.securityType, tab: row.tab, issueDate: row.issue, maturityDate: row.maturity },
      });
      this.newAkk.set(series, r);
      return r;
    }
    if (inp.mode === "yahoo") {
      const sym = upper(inp.symbol);
      if (!sym) return this.fail(key, "required");
      const known = existingYahoo(ctx, sym);
      if (known) return known;
      const made = this.newYahoo.get(sym);
      if (made) return made;
      const info = ctx.symbols.get(sym);
      if (!info) return this.fail(key, "symbolNotFound");
      if (!isCurrency(info.currency)) return this.fail(key, "unsupportedCurrency");
      const r: Resolved = { id: ctx.newId(), currency: info.currency, valuation: "market", quoted: { source: "yahoo", symbol: sym } };
      this.payload.instruments.push({
        id: r.id, name: info.name.trim().slice(0, 120) || sym, assetClass: info.assetClass, currency: info.currency,
        ticker: sym.length <= 32 ? sym : null, exchange: info.exchange?.trim().slice(0, 32) || null,
        valuation: "market", priceSource: "yahoo", providerSymbol: sym,
      });
      this.newYahoo.set(sym, r);
      return r;
    }
    if (inp.mode === "bet") {
      const code = upper(inp.symbol);
      if (!code) return this.fail(key, "required");
      const known = existingBet(ctx, code);
      if (known) return known;
      const made = this.newBet.get(code);
      if (made) return made;
      const info = ctx.betSymbols?.get(code);
      if (!info) return this.fail(key, "betCodeNotFound");
      if (!isCurrency(info.currency)) return this.fail(key, "unsupportedCurrency");
      const r: Resolved = { id: ctx.newId(), currency: info.currency, valuation: "market", quoted: { source: "bet", symbol: code } };
      // The BÉT names a paper by its code (spec 2026-09-28 §2.6); the Instruments page can rename it.
      this.payload.instruments.push({
        id: r.id, name: info.name.trim().slice(0, 120) || code, assetClass: info.assetClass, currency: info.currency,
        ticker: code.length <= 32 ? code : null, exchange: "BÉT",
        valuation: "market", priceSource: "bet", providerSymbol: code,
      });
      this.newBet.set(code, r);
      return r;
    }
    const name = this.text(`${key}.name`, inp.name, 120);
    const ccy = this.currency(`${key}.currency`, inp.currency);
    const assetClass = ASSET_CLASSES.includes(inp.assetClass as AssetClass) ? (inp.assetClass as AssetClass) : this.fail(`${key}.assetClass`, "unknown");
    if (!name || !ccy || !assetClass) return undefined;
    // The same name and currency again is the item already there, not a second one.
    for (const [id, i] of ctx.instruments) {
      if (i.valuation === "manual" && i.currency === ccy && i.name.trim().toLocaleLowerCase("hu") === name.toLocaleLowerCase("hu")) {
        return { id, currency: ccy, valuation: "manual", quoted: null };
      }
    }
    const r: Resolved = { id: ctx.newId(), currency: ccy, valuation: "manual", quoted: null };
    this.payload.instruments.push({ id: r.id, name, assetClass, currency: ccy, ticker: null, exchange: null, valuation: "manual", priceSource: "manual", providerSymbol: null });
    return r;
  }

  entryId(): string {
    return this.ctx.entryId ?? this.ctx.newId();
  }
}

/** The instrument with this source and symbol, priced from that source. */
function existingBy(ctx: EntryContext, source: "yahoo" | "bet", sym: string): Resolved | undefined {
  for (const [id, i] of ctx.instruments) {
    if (i.priceSource === source && i.symbol && upper(i.symbol) === sym) return { id, currency: i.currency, valuation: i.valuation, quoted: { source, symbol: sym } };
  }
  return undefined;
}

// A BÉT paper's Yahoo twin is its code with .BD (OTP ↔ OTP.BD): the same paper, so the one
// already there is used, priced from its own source (#44; the picker does the same). An exact match wins.
function existingYahoo(ctx: EntryContext, sym: string): Resolved | undefined {
  return existingBy(ctx, "yahoo", sym) ?? (sym.endsWith(".BD") ? existingBy(ctx, "bet", sym.slice(0, -3)) : undefined);
}

function existingBet(ctx: EntryContext, code: string): Resolved | undefined {
  return existingBy(ctx, "bet", code) ?? existingBy(ctx, "yahoo", `${code}.BD`);
}

/** The ÁKK instrument of a series already there; its maturity from bond_terms, or today's list. */
function existingAkk(ctx: EntryContext, series: string): Resolved | undefined {
  for (const [id, i] of ctx.instruments) {
    if (i.priceSource === "akk" && i.symbol && upper(i.symbol) === series) {
      const maturity = ctx.bondMaturity?.get(id) ?? ctx.akk?.get(series)?.maturity ?? null;
      return { id, currency: i.currency, valuation: "market", quoted: null, bond: { series, maturity } };
    }
  }
  return undefined;
}

/** The series a government security input names (a new pick or an existing ÁKK instrument), or null. */
function seriesOf(ctx: EntryContext, inp: InstrumentInput): string | null {
  if (inp.mode === "akk") return upper(inp.symbol) || null;
  if (inp.mode !== "existing") return null;
  const i = ctx.instruments.get(inp.id);
  return i?.priceSource === "akk" && i.symbol ? upper(i.symbol) : null;
}

/** Valuation kind an input will have, known even when the input itself is invalid. */
function kindOf(ctx: EntryContext, inp: InstrumentInput): "market" | "manual" {
  if (inp.mode === "manual") return "manual";
  if (inp.mode === "existing") return ctx.instruments.get(inp.id)?.valuation ?? "market";
  return "market";
}

type Target = { accountId: string; trackingStart: Day | undefined; existing: boolean };

/** Broker and account: chosen or new. */
function target(b: Builder): Target {
  const { input: i, ctx } = b;
  let institutionId: string | undefined;
  if (i.institution.mode === "existing") {
    institutionId = ctx.institutions.has(i.institution.id) ? i.institution.id : b.fail("institution.id", "unknown");
  } else {
    const name = b.text("institution.name", i.institution.name, 100);
    if (name) {
      institutionId = ctx.newId();
      b.payload.institution = { id: institutionId, name };
    }
  }

  if (i.account.mode === "existing") {
    const a = ctx.accounts.get(i.account.id);
    if (!a || i.institution.mode === "new" || (institutionId && a.institutionId !== institutionId)) {
      b.fail("account.id", "unknown");
      // The rest of the form is still checked, so every error shows at once.
      return { accountId: "", trackingStart: undefined, existing: false };
    }
    return { accountId: i.account.id, trackingStart: a.trackingStart, existing: true };
  }
  const name = b.text("account.name", i.account.name, 100);
  const accountType = (ACCOUNT_TYPES as readonly string[]).includes(i.account.accountType) ? i.account.accountType : b.fail("account.accountType", "unknown");
  // A new account starts the day before its first buy.
  const d = i.date.trim();
  const start = isDay(d) ? addDays(d, -1) : undefined;
  if (!name || !accountType || !institutionId) return { accountId: "", trackingStart: start, existing: false };
  const id = ctx.newId();
  if (start) b.payload.account = { id, institutionId, name, accountType, trackingStart: start };
  return { accountId: id, trackingStart: start, existing: false };
}

function trade(b: Builder, t: Target, side: "buy" | "sell") {
  const { input: i, ctx } = b;
  const date = b.day("date", i.date);
  const note = i.note.trim() || null;
  if (note && note.length > NOTE_MAX) b.fail("note", "noteTooLong");

  if (side === "sell" && i.instrument.mode !== "existing") return b.fail("instrument", "unknown");
  if (side === "sell" && !t.existing) return b.fail("account.id", "unknown");
  const manual = kindOf(ctx, i.instrument) === "manual";
  const inst = b.instrument("instrument", i.instrument);

  // Tracking start (4c plan §1 B): a buy before it moves it earlier, unless an
  // opening balance is there; a sale is never before it.
  if (date && t.existing && t.trackingStart && date <= t.trackingStart) {
    const a = ctx.accounts.get(t.accountId)!;
    if (a.hasOpening) b.fail("date", "beforeStartOpening");
    else if (side === "sell") b.fail("date", "beforeStart");
    else {
      b.payload.trackingStart = { accountId: t.accountId, day: addDays(date, -1) };
      t.trackingStart = addDays(date, -1);
    }
  }

  const acc = t.accountId;
  const held = () => (inst && t.existing && date ? ctx.holding(acc, inst.id, date) : new D(0));
  const prevValue = () => (inst && t.existing && date ? ctx.valueOn(acc, inst.id, date) : null);
  const valuation = (value: Dec, typed: boolean): ValuationExtra => ({
    accountId: acc, instrumentId: inst!.id, value: r10(value).toFixed(), currency: inst!.currency, asOf: endOfDayBudapest(date!),
    note: typed ? ENTRY_VALUE_NOTE : ENTRY_AUTO_VALUE_NOTE,
  });
  const ev = (type: EntryEventType, lines: LinePayload[], extra: { note?: string | null; valuations?: ValuationExtra[] } = {}): EntryEvent => ({
    type, date: date!, note: extra.note ?? null, lines, quotes: [], valuations: extra.valuations ?? [],
  });
  // Spec 2026-09-28 §3.4: a buy takes the account's cash first and only the rest is new money;
  // the amount is always the server's (availableCash), the form sends only the choice.
  const fromCash = (cost: Dec) =>
    i.payFrom === "cash" && t.existing && inst && date ? D.min(cost, ctx.availableCash(acc, inst.currency, date)) : new D(0);
  const payIn = (cost: Dec): EntryEvent[] => {
    // Lines keep 10 decimals: a gap that rounds to 0 is no deposit, not a deposit of 0 (#28).
    const rest = r10(cost.minus(fromCash(cost)));
    return rest.gt(0) ? [ev("deposit", [cash(acc, inst!.currency, rest, "external")])] : [];
  };
  const takeOut = (net: Dec): EntryEvent[] => (i.proceeds === "withdraw" ? [ev("withdrawal", [cash(acc, inst!.currency, net.neg(), "external")])] : []);

  if (seriesOf(ctx, i.instrument)) {
    // A government security: the nominal and the amount paid or received, no unit price.
    const nominal = b.num("quantity", i.quantity);
    let paid = b.num("total", i.total, { required: side === "sell" });
    const fee = b.num("fee", i.fee, { required: false, allowZero: true }) ?? new D(0);
    const maturity = inst?.bond?.maturity;
    if (date && maturity && date >= maturity) b.fail("date", "matured");
    if (b.failed || !inst || !nominal || !date) return;
    // #34: an approved maturity repaid what was held then. A buy or sale before it
    // may not change that, or units of a matured paper stay (or go below zero).
    const booked = t.existing ? ctx.maturityBooked(acc, inst.id) : null;
    const change = side === "buy" ? nominal : nominal.neg();
    if (booked && (date >= booked || !ctx.holding(acc, inst.id, booked).plus(change).isZero())) return b.fail("date", "maturityBooked");
    let estimated = false;
    if (side === "buy" && paid === undefined) {
      const row = ctx.akk?.get(inst.bond!.series);
      const estimate = date === ctx.today && row ? buyEstimate(row, nominal) : null;
      if (!estimate) return b.fail("total", date === ctx.today ? "akkNoEstimate" : "akkTotalRequired");
      [paid, estimated] = [estimate, true];
    }
    const feeLines = fee.gt(0) ? [cash(acc, "HUF", fee.neg(), "fee")] : [];
    if (side === "buy") {
      const cost = paid!.plus(fee);
      b.payload.entries.push({
        id: b.entryId(),
        events: [
          ...payIn(cost),
          ev("buy", [position(acc, inst, nominal, "trade", { amount: cost, estimated, refs: costRefs(ctx, "HUF", date) }), cash(acc, "HUF", paid!.neg(), "trade"), ...feeLines], { note }),
        ],
      });
      return;
    }
    if (held().lt(nominal)) return b.fail("quantity", "insufficient");
    const net = paid!.minus(fee);
    if (net.lte(0)) return b.fail("fee", "feeTooHigh");
    b.payload.entries.push({
      id: b.entryId(),
      events: [ev("sell", [position(acc, inst, nominal.neg(), "trade"), cash(acc, "HUF", paid!, "trade"), ...feeLines], { note }), ...takeOut(net)],
    });
    return;
  }

  if (manual) {
    const amount = b.num("amount", i.amount);
    const newValue = b.num("newValue", i.newValue, { required: false, allowZero: true });
    if (b.failed || !inst || !amount || !date) return;
    const prev = prevValue();
    const units = held();
    if (side === "buy") {
      const unitPrice = prev?.gt(0) && units.gt(0) ? prev.div(units) : new D(1);
      const qty = r10(amount.div(unitPrice));
      if (qty.lte(0)) return b.fail("amount", "positive");
      const total = newValue ?? (prev ?? new D(0)).plus(amount);
      b.payload.entries.push({
        id: b.entryId(),
        events: [
          ...payIn(amount),
          ev("buy", [position(acc, inst, qty, "trade", { amount, estimated: false, refs: costRefs(ctx, inst.currency, date) }), cash(acc, inst.currency, amount.neg(), "trade")], {
            note, valuations: [valuation(total, newValue !== undefined)],
          }),
        ],
      });
      return;
    }
    if (!prev || prev.lte(0)) return b.fail("amount", "noValue");
    if (amount.gt(prev)) return b.fail("amount", "insufficientValue");
    if (units.lte(0)) return b.fail("amount", "noHolding");
    let qty = amount.eq(prev) ? units : r10(units.times(amount).div(prev));
    if (qty.gt(units)) qty = units;
    if (qty.lte(0)) return b.fail("amount", "positive");
    const total = newValue ?? prev.minus(amount);
    b.payload.entries.push({
      id: b.entryId(),
      events: [
        ev("sell", [position(acc, inst, qty.neg(), "trade"), cash(acc, inst.currency, amount, "trade")], { note, valuations: [valuation(total, newValue !== undefined)] }),
        ...takeOut(amount),
      ],
    });
    return;
  }

  const qty = b.num("quantity", i.quantity);
  const total = b.num("total", i.total, { required: false });
  // A buy may leave both out: the close on the day from the paper's own source (Yahoo or the BÉT) stands in, as an estimate.
  let price = b.num("price", i.price, { required: side === "sell" && total === undefined });
  let close: { day: Day; price: string } | null = null;
  if (side === "buy" && total === undefined && price === undefined && inst) {
    const info = inst.quoted ? (inst.quoted.source === "bet" ? ctx.betSymbols : ctx.symbols)?.get(inst.quoted.symbol) : null;
    close = info?.close && info.currency === inst.currency ? info.close : null;
    if (!close) return b.fail("price", "noPrice");
    price = new D(close.price);
  }
  const fee = b.num("fee", i.fee, { required: false, allowZero: true }) ?? new D(0);
  if (b.failed || !inst || !qty || !date) return;
  const gross = total ?? qty.times(price!);
  const feeLines = fee.gt(0) ? [cash(acc, inst.currency, fee.neg(), "fee")] : [];

  if (side === "buy") {
    const cost = gross.plus(fee);
    if (close && inst.quoted) {
      const q: EstimateQuote = { instrumentId: inst.id, price: new D(close.price).toFixed(), currency: inst.currency, asOf: endOfDayBudapest(close.day), source: inst.quoted.source };
      b.payload.quotes.push(q);
    }
    b.payload.entries.push({
      id: b.entryId(),
      events: [
        ...payIn(cost),
        ev("buy", [position(acc, inst, qty, "trade", { amount: cost, estimated: close !== null, refs: costRefs(ctx, inst.currency, date) }), cash(acc, inst.currency, gross.neg(), "trade"), ...feeLines], { note }),
      ],
    });
    return;
  }
  if (held().lt(qty)) return b.fail("quantity", "insufficient");
  const net = gross.minus(fee);
  if (net.lte(0)) return b.fail("fee", "feeTooHigh");
  b.payload.entries.push({
    id: b.entryId(),
    events: [
      ev("sell", [position(acc, inst, qty.neg(), "trade"), cash(acc, inst.currency, gross, "trade"), ...feeLines], { note }),
      ...takeOut(net),
    ],
  });
}

function asLedgerEvent(e: EntryEvent, id: string, createdAt = ""): LedgerEvent {
  return {
    id, type: e.type, date: e.date, createdAt, correctionKind: null, splitRatio: null, note: e.note,
    lines: e.lines.map(
      (l, k): Line => ({
        id: `${id}-${k}`, kind: l.kind, accountId: l.accountId, instrumentId: l.instrumentId, currency: l.currency, amount: new D(l.amount),
        role: l.role, costAmount: l.costAmount === null ? null : new D(l.costAmount), costEstimated: l.costEstimated, costFxRefs: l.costFxRefs,
      }),
    ),
  };
}

/** The payload's events as the finance core sees them (previews and tests). */
export function payloadEvents(p: EntryPayload, createdAt: string): LedgerEvent[] {
  return p.entries.flatMap((en) => en.events.map((e, n) => asLedgerEvent(e, `${en.id}-${n}`, createdAt)));
}

export function buildEntry(input: EntryInput, ctx: EntryContext): EntryResult {
  const b = new Builder(input, ctx);
  const t = target(b);
  trade(b, t, input.tab);
  if (b.failed) return { ok: false, errors: b.errors };

  // The core's own check, with the start as it will be after this entry.
  const currencies = new Map(b.payload.instruments.map((i) => [i.id, i.currency]));
  const events = b.payload.entries.flatMap((e) => e.events);
  const problems = events.flatMap((e, n) =>
    validateEvent(asLedgerEvent(e, `check-${n}`), {
      instrumentCurrency: (id) => currencies.get(id) ?? ctx.instruments.get(id)?.currency,
      trackingStart: (id) => (id === t.accountId ? t.trackingStart : ctx.accounts.get(id)?.trackingStart),
    }),
  );
  if (problems.includes("before_tracking_start")) return { ok: false, errors: { date: "beforeStart" } };
  if (problems.length) return { ok: false, errors: { form: "invalid" } };
  return { ok: true, payload: b.payload };
}

/**
 * What to ask Yahoo and the BÉT before building: the name and currency of a
 * new symbol or code, and for a buy without a price or a total the close on
 * the buy day, from the paper's own source.
 */
/** `close`: whether the build needs the close on `closeDay` (a buy with neither a price nor a total); otherwise a new paper's name and currency are enough (#29). */
export function lookupPlan(input: EntryInput, ctx: EntryContext): { symbols: string[]; betCodes: string[]; closeDay: Day | null; close: boolean; series: string[] } {
  // Government securities: the ÁKK list for a new series, and for today's buy without an amount.
  const series = seriesOf(ctx, input.instrument);
  if (series) {
    const isNew = input.instrument.mode === "akk" && !existingAkk(ctx, series);
    const estimate = input.tab === "buy" && !input.total.trim() && input.date.trim() === ctx.today;
    return { symbols: [], betCodes: [], closeDay: null, close: false, series: isNew || estimate ? [series] : [] };
  }
  if (input.tab !== "buy") return { symbols: [], betCodes: [], closeDay: null, close: false, series: [] };
  const inp = input.instrument;
  let quoted: Quoted | null = null;
  let isNew = false;
  if ((inp.mode === "yahoo" || inp.mode === "bet") && upper(inp.symbol)) {
    // An instrument already there (its .BD twin included) is asked of its own source.
    const sym = upper(inp.symbol);
    const known = inp.mode === "yahoo" ? existingYahoo(ctx, sym) : existingBet(ctx, sym);
    quoted = known?.quoted ?? { source: inp.mode, symbol: sym };
    isNew = !known;
  } else if (inp.mode === "existing") {
    const i = ctx.instruments.get(inp.id);
    quoted = i ? quotedOf(i) : null;
  }
  const needsClose = !input.price.trim() && !input.total.trim();
  const day = input.date.trim();
  const ask = quoted && (isNew || needsClose) ? quoted : null;
  return {
    symbols: ask?.source === "yahoo" ? [ask.symbol] : [],
    betCodes: ask?.source === "bet" ? [ask.symbol] : [],
    closeDay: isDay(day) ? day : null,
    close: ask !== null && needsClose,
    series: [],
  };
}
