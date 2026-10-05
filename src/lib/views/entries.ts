/**
 * Entries (4c plan §3–§4) as the list shows them and as the form edits them.
 * An entry's events share an entry id; the list shows them as one row, the
 * edit form gets back what was typed (as far as the stored rows tell).
 */
import { type EntryInput, emptyEntryInput, ENTRY_VALUE_NOTE } from "@/lib/entry/build";
import type { LedgerEvent, Line } from "@/lib/finance/ledger";
import { D, type Day, type Dec } from "@/lib/finance/money";
import type { I18n } from "@/lib/i18n";

/** What the simple form records, and the government security events a proposal's approval records (spec 2026-09-28 §7). */
export type EntryKind = "opening" | "buy" | "sell" | BondKind;
export type BondKind = "interest_reinvest" | "interest" | "maturity";
export const BOND_KINDS: readonly BondKind[] = ["interest_reinvest", "interest", "maturity"];
export const isBondKind = (k: EntryKind): k is BondKind => (BOND_KINDS as readonly string[]).includes(k);
export type ValuationOf = (instrumentId: string) => "market" | "manual" | undefined;

export type EntrySummary = {
  id: string;
  kind: EntryKind;
  date: Day;
  createdAt: string;
  accountId: string;
  instrumentId: string | null;
  currency: string;
  manual: boolean;
  /** Market items only. */
  quantity: Dec | null;
  price: Dec | null;
  /** Buy/sell: the traded amount before the fee; opening: the (estimated) cost or the cash. */
  amount: Dec;
  fee: Dec | null;
  estimated: boolean;
  /** Buy: what came from the account's cash rather than a deposit (spec 2026-09-28 §3.4). */
  fromCash: Dec | null;
  /** Buy: what came in as a deposit (the old simple buy: all of it). */
  paidIn: Dec | null;
  /** Sale, interest payment, maturity: the money stayed on the account (no withdrawal). */
  kept: boolean;
  /** Maturity: the last interest paid with the nominal. */
  interest: Dec | null;
  note: string | null;
};

export type ListItem = { kind: "entry"; entry: EntrySummary; events: LedgerEvent[] } | { kind: "event"; event: LedgerEvent };

export function entryKind(events: LedgerEvent[]): EntryKind {
  if (events.some((e) => e.type === "opening_balance")) return "opening";
  const bond = BOND_KINDS.find((k) => events.some((e) => e.type === k));
  if (bond) return bond;
  return events.some((e) => e.type === "sell") ? "sell" : "buy";
}

const mainEvent = (events: LedgerEvent[], kind: EntryKind) =>
  events.find((e) => e.type === (kind === "opening" ? "opening_balance" : kind)) ?? events[0];
const find = (lines: Line[], f: (l: Line) => boolean) => lines.find(f) ?? null;

function parts(events: LedgerEvent[]) {
  const kind = entryKind(events);
  const main = mainEvent(events, kind);
  const pos = find(main.lines, (l) => l.kind === "position");
  const trade = find(main.lines, (l) => l.kind === "cash" && l.role === (kind === "interest_reinvest" || kind === "interest" ? "income" : "trade"));
  const fee = find(main.lines, (l) => l.kind === "cash" && l.role === "fee");
  return { kind, main, pos, trade, fee };
}

/** The cash the entry's deposit brought in, and whether it took money out. */
function flows(events: LedgerEvent[]) {
  const deposit = events.find((e) => e.type === "deposit")?.lines.find((l) => l.kind === "cash")?.amount ?? new D(0);
  return { deposit, withdrawn: events.some((e) => e.type === "withdrawal") };
}

export function describeEntry(id: string, events: LedgerEvent[], valuationOf: ValuationOf): EntrySummary {
  const { kind, main, pos, trade, fee } = parts(events);
  const first = main.lines[0];
  const manual = pos?.instrumentId ? valuationOf(pos.instrumentId) === "manual" : false;
  const base = {
    id, kind, date: main.date, createdAt: main.createdAt, accountId: first.accountId, instrumentId: pos?.instrumentId ?? null,
    currency: (pos ?? first).currency, manual, note: main.note, fee: fee ? fee.amount.abs() : null,
  };
  if (kind === "opening") {
    if (!pos) return { ...base, quantity: null, price: null, amount: first.amount, estimated: false, fromCash: null, paidIn: null, kept: false, interest: null };
    const cost = pos.costAmount ?? new D(0);
    return { ...base, quantity: manual ? null : pos.amount, price: manual ? null : cost.div(pos.amount), amount: cost, estimated: pos.costEstimated, fromCash: null, paidIn: null, kept: false, interest: null };
  }
  const amount = trade ? trade.amount.abs() : new D(0);
  const qty = pos ? pos.amount.abs() : null;
  const { deposit, withdrawn } = flows(events);
  if (isBondKind(kind)) {
    const income = kind === "maturity" ? find(main.lines, (l) => l.kind === "cash" && l.role === "income") : null;
    return {
      ...base, instrumentId: pos?.instrumentId ?? trade?.instrumentId ?? null, quantity: null, price: null, amount, estimated: false,
      fromCash: null, paidIn: null, kept: kind !== "interest_reinvest" && !withdrawn, interest: income ? income.amount : null,
    };
  }
  const cost = amount.plus(base.fee ?? 0);
  // A buy priced by the Yahoo close carries an estimated cost.
  return {
    ...base, quantity: manual ? null : qty, price: manual || !qty ? null : amount.div(qty), amount, estimated: kind === "buy" && (pos?.costEstimated ?? false),
    fromCash: kind === "buy" && cost.gt(deposit) ? cost.minus(deposit) : null,
    paidIn: kind === "buy" && deposit.gt(0) ? deposit : null,
    kept: kind === "sell" && !withdrawn,
    interest: null,
  };
}

/** The list's short text: "12 db × 112,50 EUR + 2,00 EUR díj · készpénzből 500,00 EUR", "Összeg: 100 000 Ft", … */
export function entryDetail(e: EntrySummary, i18n: I18n): string {
  const { m, fill, f } = i18n;
  const text = baseDetail(e, i18n);
  const money = (d: Dec) => f.money(d, e.currency);
  // Spec 2026-09-28 §3.4: the split of a buy, "készpénzből X, befizetés Y".
  if (e.fromCash && e.paidIn) return fill(m.transactions.fromCashAndPaidIn, { text, amount: money(e.fromCash), paidIn: money(e.paidIn) });
  if (e.fromCash) return fill(m.transactions.fromCash, { text, amount: money(e.fromCash) });
  if (e.kept) return fill(m.transactions.kept, { text });
  if (e.kind === "interest" || e.kind === "maturity") return fill(m.transactions.withdrawn, { text });
  return text;
}

function baseDetail(e: EntrySummary, { m, fill, f }: I18n): string {
  const t = m.transactions;
  const money = (d: Dec) => f.money(d, e.currency);
  if (e.kind === "maturity") return fill(e.interest ? t.maturityWithInterest : t.maturity, { nominal: money(e.amount), interest: money(e.interest ?? new D(0)) });
  if (e.kind === "interest_reinvest" || e.kind === "interest") return money(e.amount);
  if (e.kind === "opening" && e.instrumentId === null) return fill(t.cash, { amount: money(e.amount) });
  if (e.manual) {
    if (e.kind === "opening") return fill(t.value, { value: money(e.amount) });
    // Not "Befizetés"/"Kivét": those words are the account's money (#26); the row already says Vétel or Eladás.
    return fill(t.manualAmount, { amount: money(e.amount) });
  }
  const base = e.quantity && e.price ? fill(t.qtyPrice, { qty: f.quantity(e.quantity), price: f.price(e.price, e.currency) }) : money(e.amount);
  if (!e.fee) return base;
  return fill(e.kind === "sell" ? t.withFeeSell : t.withFee, { text: base, fee: money(e.fee) });
}

/** Entries as one row each, other events as they are; newest day first, then the latest recorded. */
export function listItems(events: LedgerEvent[], entryOf: Map<string, string>, valuationOf: ValuationOf): ListItem[] {
  const grouped = new Map<string, LedgerEvent[]>();
  const items: ListItem[] = [];
  for (const e of events) {
    const id = entryOf.get(e.id);
    if (!id) items.push({ kind: "event", event: e });
    else grouped.set(id, [...(grouped.get(id) ?? []), e]);
  }
  for (const [id, evs] of grouped) items.push({ kind: "entry", entry: describeEntry(id, evs, valuationOf), events: evs });
  const key = (i: ListItem) => (i.kind === "entry" ? [i.entry.date, i.entry.createdAt] : [i.event.date, i.event.createdAt]);
  return items.sort((a, b) => {
    const [da, ca] = key(a);
    const [db, cb] = key(b);
    return da === db ? cb.localeCompare(ca) : db.localeCompare(da);
  });
}

/** The entry's own manual valuations (the typed new total of a manual item). */
export type EntryExtras = { valuations: { value: string; note: string | null }[] };

/**
 * The form state that records this entry again (for editing); null for an
 * entry of the old Mai állomány tab, which the form no longer makes.
 */
export function entryToInput(
  events: LedgerEvent[],
  extras: EntryExtras,
  meta: { institutionId: string; valuationOf: ValuationOf; /** ÁKK instruments: nominal and amount, no unit price. */ bondOf?: (id: string) => boolean },
  /** The UI language: typed numbers come back in its form (spec 2026-10-01 §2.5). */
  i18n: I18n,
): EntryInput | null {
  const typed = (d: Dec) => i18n.f.typed(d);
  const { kind, main, pos, trade, fee } = parts(events);
  if (kind === "opening" || isBondKind(kind)) return null;
  const accountId = main.lines[0].accountId;
  const input: EntryInput = {
    ...emptyEntryInput(),
    tab: kind,
    institution: { mode: "existing", id: meta.institutionId, name: "" },
    account: { mode: "existing", id: accountId, name: "", accountType: "normal" },
  };
  const instrument = (id: string) => ({ mode: "existing" as const, id, symbol: "", name: "", currency: "", assetClass: "" });
  const manual = pos?.instrumentId ? meta.valuationOf(pos.instrumentId) === "manual" : false;
  const noted = <T extends { note: string | null }>(rows: T[], note: string) => rows.find((r) => r.note === note);

  const gross = trade ? trade.amount.abs() : new D(0);
  const { deposit, withdrawn } = flows(events);
  // As saved: a buy whose deposit covered all of it stays so, whatever the account holds now.
  const money = {
    payFrom: kind === "buy" && deposit.gte(gross.plus(fee ? fee.amount.abs() : 0)) ? ("deposit" as const) : ("cash" as const),
    proceeds: withdrawn ? ("withdraw" as const) : ("keep" as const),
  };
  const out: EntryInput = { ...input, ...money, date: main.date, note: main.note ?? "", instrument: instrument(pos?.instrumentId ?? "") };
  if (manual) {
    const v = noted(extras.valuations, ENTRY_VALUE_NOTE);
    return { ...out, amount: typed(gross), newValue: v ? typed(new D(v.value)) : "" };
  }
  const qty = pos ? pos.amount.abs() : new D(1);
  const feeText = fee ? typed(fee.amount.abs()) : "";
  // A government security keeps its amount, estimated or not: the ÁKK can estimate only today's buy.
  if (pos?.instrumentId && meta.bondOf?.(pos.instrumentId)) return { ...out, quantity: typed(qty), total: typed(gross), fee: feeText };
  // Priced by the day's close (Yahoo or the BÉT): left empty, so a save asks again.
  if (kind === "buy" && pos?.costEstimated) return { ...out, quantity: typed(qty), fee: feeText };
  const price = gross.div(qty);
  // A short unit price that gives back the total exactly; otherwise the total itself.
  const exact = price.decimalPlaces() <= 10 && price.times(qty).eq(gross);
  return {
    ...out,
    quantity: typed(qty),
    price: exact ? typed(price) : "",
    total: exact ? "" : typed(gross),
    fee: feeText,
  };
}
