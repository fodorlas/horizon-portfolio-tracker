import { describe, expect, it } from "vitest";
import { buildEntry, type EntryContext, type EntryInput, emptyEntryInput, ENTRY_AUTO_VALUE_NOTE, ENTRY_VALUE_NOTE, payloadEvents } from "@/lib/entry/build";
import type { LedgerEvent, Line } from "@/lib/finance/ledger";
import { D } from "@/lib/finance/money";
import { i18nFor } from "@/lib/i18n";
import { describeEntry, entryDetail, entryToInput, listItems } from "./entries";

const hu = i18nFor("hu");

let n = 0;
const ctx = (): EntryContext => ({
  locale: "hu",
  today: "2026-09-26",
  institutions: new Set(["BR"]),
  accounts: new Map([["A", { institutionId: "BR", trackingStart: "2026-01-01", hasOpening: false }]]),
  instruments: new Map([
    ["ST", { name: "Példa", currency: "EUR", valuation: "market" as const, priceSource: "yahoo", symbol: "PLDA.DE" }],
    ["HOLD", { name: "Hold", currency: "HUF", valuation: "manual" as const, priceSource: "manual", symbol: null }],
    ["BOND", { name: "Kötvény", currency: "HUF", valuation: "market" as const, priceSource: "akk", symbol: null }],
  ]),
  fxRows: [],
  holding: () => new D(1000),
  valueOn: () => new D(1000),
  maturityBooked: () => null,
  availableCash: () => new D(0),
  symbols: new Map([["PLDA.DE", { symbol: "PLDA.DE", name: "Példa", currency: "EUR", assetClass: "stock" as const, exchange: "XETRA", close: { day: "2026-01-30", price: "1000" } }]]),
  newId: () => `n${++n}`,
});
const valuationOf = (id: string) => (id === "HOLD" ? ("manual" as const) : ("market" as const));
const base = {
  institution: { mode: "existing" as const, id: "BR", name: "" },
  account: { mode: "existing" as const, id: "A", name: "", accountType: "normal" },
};
const inst = (id: string) => ({ mode: "existing" as const, id, symbol: "", name: "", currency: "", assetClass: "" });

/** Builds an entry the way the form does and returns it as stored: events and the entry's own extras. */
function stored(i: Partial<EntryInput>, over: Partial<EntryContext> = {}) {
  const r = buildEntry({ ...emptyEntryInput(), ...base, ...i }, { ...ctx(), ...over });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const entry = r.payload.entries[0];
  const events = payloadEvents({ ...r.payload, entries: [entry] }, "2026-09-26T10:00:00Z");
  return {
    id: entry.id,
    events,
    extras: { valuations: entry.events.flatMap((e) => e.valuations).map((v) => ({ value: v.value, note: v.note })) },
  };
}

/** An entry of the old Mai állomány tab as stored: one opening_balance event (no longer made by the form). */
function opening(line: Partial<Line>): LedgerEvent[] {
  return [{
    id: "o", type: "opening_balance", date: "2026-01-01", createdAt: "2026-09-26T10:00:00Z", correctionKind: null, splitRatio: null, note: null,
    lines: [{ id: "ol", kind: "position", accountId: "A", instrumentId: "ST", currency: "EUR", amount: new D(4), role: "opening", costAmount: new D(200), costEstimated: true, costFxRefs: null, ...line }],
  }];
}
const noExtras = { valuations: [] };

describe("entryToInput: an entry back in the form, for editing", () => {
  it("a market buy: quantity, unit price and fee", () => {
    const s = stored({ tab: "buy", date: "2026-02-02", instrument: inst("ST"), quantity: "12", price: "112,5", fee: "2", note: "x" });
    expect(entryToInput(s.events, s.extras, { institutionId: "BR", valuationOf }, hu)).toEqual({
      ...emptyEntryInput(), ...base, tab: "buy", date: "2026-02-02", instrument: inst("ST"), quantity: "12", price: "112,5", fee: "2", note: "x",
      // Saved with a deposit of all of it (no cash on the account), so it stays so.
      payFrom: "deposit",
    });
  });

  it("a typed number comes back in the UI language's form (spec 2026-10-01 §2.5)", () => {
    const s = stored({ tab: "buy", date: "2026-02-02", instrument: inst("ST"), quantity: "12", price: "112,5" });
    expect(entryToInput(s.events, s.extras, { institutionId: "BR", valuationOf }, i18nFor("en"))).toMatchObject({ quantity: "12", price: "112.5" });
    expect(entryToInput(s.events, s.extras, { institutionId: "BR", valuationOf }, hu)).toMatchObject({ quantity: "12", price: "112,5" });
  });

  it("a total that is not quantity × a short price stays a total", () => {
    const s = stored({ tab: "sell", date: "2026-02-02", instrument: inst("ST"), quantity: "3", total: "100" });
    expect(entryToInput(s.events, s.extras, { institutionId: "BR", valuationOf }, hu)).toMatchObject({ tab: "sell", quantity: "3", price: "", total: "100", fee: "" });
  });

  it("a manual buy shows the typed new total only", () => {
    const auto = stored({ tab: "buy", date: "2026-02-02", instrument: inst("HOLD"), amount: "500" });
    expect(auto.extras.valuations[0].note).toBe(ENTRY_AUTO_VALUE_NOTE);
    expect(entryToInput(auto.events, auto.extras, { institutionId: "BR", valuationOf }, hu)).toMatchObject({ tab: "buy", amount: "500", newValue: "" });
    const typed = stored({ tab: "sell", date: "2026-02-02", instrument: inst("HOLD"), amount: "500", newValue: "480" });
    expect(typed.extras.valuations[0].note).toBe(ENTRY_VALUE_NOTE);
    expect(entryToInput(typed.events, typed.extras, { institutionId: "BR", valuationOf }, hu)).toMatchObject({ tab: "sell", amount: "500", newValue: "480" });
  });

  it("a buy priced by the Yahoo close opens with the price empty, so a save asks Yahoo again", () => {
    const s = stored({ tab: "buy", date: "2026-02-02", instrument: inst("ST"), quantity: "12", fee: "2" });
    expect(entryToInput(s.events, s.extras, { institutionId: "BR", valuationOf }, hu)).toMatchObject({ tab: "buy", quantity: "12", price: "", total: "", fee: "2" });
  });

  it("where the money came from and went comes back as it was saved", () => {
    const meta = { institutionId: "BR", valuationOf };
    const fromCash = stored({ tab: "buy", date: "2026-02-02", instrument: inst("ST"), quantity: "2", price: "100" }, { availableCash: () => new D(150) });
    expect(entryToInput(fromCash.events, fromCash.extras, meta, hu)).toMatchObject({ payFrom: "cash" });
    const deposit = stored({ tab: "buy", date: "2026-02-02", instrument: inst("ST"), quantity: "2", price: "100", payFrom: "deposit" }, { availableCash: () => new D(150) });
    expect(entryToInput(deposit.events, deposit.extras, meta, hu)).toMatchObject({ payFrom: "deposit" });
    const kept = stored({ tab: "sell", date: "2026-02-02", instrument: inst("ST"), quantity: "2", price: "100" });
    expect(entryToInput(kept.events, kept.extras, meta, hu)).toMatchObject({ proceeds: "keep" });
    const taken = stored({ tab: "sell", date: "2026-02-02", instrument: inst("ST"), quantity: "2", price: "100", proceeds: "withdraw" });
    expect(entryToInput(taken.events, taken.extras, meta, hu)).toMatchObject({ proceeds: "withdraw" });
  });

  it("an old opening entry is not edited in the form", () => {
    expect(entryToInput(opening({}), noExtras, { institutionId: "BR", valuationOf }, hu)).toBeNull();
  });
});

describe("describeEntry: one line in the list", () => {
  it("a buy: quantity × price + fee, on its account and instrument", () => {
    const s = stored({ tab: "buy", date: "2026-02-02", instrument: inst("ST"), quantity: "12", price: "112,5", fee: "2" });
    const d = describeEntry(s.id, s.events, valuationOf);
    expect({ ...d, quantity: d.quantity?.toString(), price: d.price?.toString(), amount: d.amount.toString(), fee: d.fee?.toString(), paidIn: d.paidIn?.toString() }).toEqual({
      id: s.id, kind: "buy", date: "2026-02-02", createdAt: "2026-09-26T10:00:00Z", accountId: "A", instrumentId: "ST", currency: "EUR", manual: false,
      quantity: "12", price: "112.5", amount: "1350", fee: "2", estimated: false, fromCash: null, paidIn: "1352", kept: false, interest: null, note: null,
    });
  });

  it("a buy priced by the Yahoo close is an estimate; a typed price is not", () => {
    const est = describeEntry("x", stored({ tab: "buy", date: "2026-02-02", instrument: inst("ST"), quantity: "12" }).events, valuationOf);
    expect([est.estimated, est.price?.toString(), est.amount.toString()]).toEqual([true, "1000", "12000"]);
    expect(describeEntry("y", stored({ tab: "buy", date: "2026-02-02", instrument: inst("ST"), quantity: "1", price: "5" }).events, valuationOf).estimated).toBe(false);
  });

  it("an old opening row is still listed: an estimate; a manual sale is just the amount", () => {
    const o = describeEntry("x", opening({}), valuationOf);
    expect([o.kind, o.quantity?.toString(), o.price?.toString(), o.amount.toString(), o.estimated]).toEqual(["opening", "4", "50", "200", true]);
    const m = describeEntry("y", stored({ tab: "sell", date: "2026-02-02", instrument: inst("HOLD"), amount: "300" }).events, valuationOf);
    expect([m.kind, m.manual, m.quantity, m.price, m.amount.toString()]).toEqual(["sell", true, null, null, "300"]);
    const c = describeEntry("z", opening({ kind: "cash", instrumentId: null, currency: "HUF", amount: new D(150000), costAmount: null, costEstimated: false }), valuationOf);
    expect([c.instrumentId, c.currency, c.amount.toString(), c.quantity]).toEqual([null, "HUF", "150000", null]);
  });
});

describe("listItems: entries as one row, other events as they are, newest first", () => {
  const line = (p: Partial<Line>): Line => ({
    id: `l${++n}`, kind: "cash", accountId: "A", instrumentId: null, currency: "HUF", amount: new D(1), role: "external", costAmount: null, costEstimated: false, costFxRefs: null, ...p,
  });
  const ev = (id: string, type: LedgerEvent["type"], date: string, createdAt: string): LedgerEvent => ({
    id, type, date, createdAt, correctionKind: null, splitRatio: null, note: null, lines: [line({})],
  });

  it("groups by entry id and sorts by day, then by recording time", () => {
    const events = [ev("d", "deposit", "2026-02-02", "t1"), ev("b", "buy", "2026-02-02", "t1"), ev("f", "fee", "2026-02-02", "t2"), ev("x", "interest", "2026-03-01", "t0")];
    events[1].lines = [line({ kind: "position", instrumentId: "ST", currency: "EUR", amount: new D(1), role: "trade", costAmount: new D(1) }), line({ currency: "EUR", amount: new D(-1), role: "trade" })];
    const items = listItems(events, new Map([["d", "E1"], ["b", "E1"]]), valuationOf);
    expect(items.map((i) => (i.kind === "entry" ? `entry:${i.entry.id}:${i.events.length}` : `event:${i.event.id}`))).toEqual(["event:x", "event:f", "entry:E1:2"]);
  });
});

describe("entryDetail: the list's short text", () => {
  const text = (i: Partial<EntryInput>) => entryDetail(describeEntry("x", stored(i).events, valuationOf), i18nFor("hu")).replace(/\s/g, " ");
  it("units × price with the fee, amounts for manual items, cash as it is", () => {
    expect(text({ tab: "buy", date: "2026-02-02", instrument: inst("ST"), quantity: "12", price: "112,5", fee: "2" })).toBe("12 db × 112,50 EUR + 2,00 EUR díj");
    expect(text({ tab: "sell", date: "2026-02-02", instrument: inst("ST"), quantity: "4", price: "60", fee: "1,5", proceeds: "withdraw" })).toBe("4 db × 60,00 EUR − 1,50 EUR díj");
    expect(text({ tab: "buy", date: "2026-02-02", instrument: inst("HOLD"), amount: "600" })).toBe("Összeg: 600 Ft");
    // An ÁKK price is per 1 Ft face value (≈ 1,0123): not "1 Ft" (#76).
    expect(text({ tab: "buy", date: "2026-02-02", instrument: inst("BOND"), quantity: "100000", price: "1,0123456" })).toBe("100 000 db × 1,0123 Ft");
    const old = (line: Partial<Line>) => entryDetail(describeEntry("o", opening(line), valuationOf), i18nFor("hu")).replace(/\s/g, " ");
    expect(old({ instrumentId: "HOLD", currency: "HUF", amount: new D(5000000), costAmount: new D(5000000) })).toBe("Érték: 5 000 000 Ft");
    expect(old({ kind: "cash", instrumentId: null, currency: "HUF", amount: new D(150000), costAmount: null, costEstimated: false })).toBe("Készpénz: 150 000 Ft");
  });
  it("says what a buy took from the account's cash and that a sale's money stayed", () => {
    const cashText = (i: Partial<EntryInput>, over: Partial<EntryContext> = {}) => entryDetail(describeEntry("x", stored(i, over).events, valuationOf), i18nFor("hu")).replace(/\s/g, " ");
    expect(cashText({ tab: "buy", date: "2026-02-02", instrument: inst("ST"), quantity: "12", price: "112,5", fee: "2" }, { availableCash: () => new D(1000) }))
      .toBe("12 db × 112,50 EUR + 2,00 EUR díj · készpénzből 1000,00 EUR, befizetés 352,00 EUR");
    // All of it from cash: nothing was paid in.
    expect(cashText({ tab: "buy", date: "2026-02-02", instrument: inst("ST"), quantity: "2", price: "100" }, { availableCash: () => new D(1000) }))
      .toBe("2 db × 100,00 EUR · készpénzből 200,00 EUR");
    expect(cashText({ tab: "sell", date: "2026-02-02", instrument: inst("ST"), quantity: "4", price: "60", fee: "1,5" })).toBe("4 db × 60,00 EUR − 1,50 EUR díj · a pénz a számlán maradt");
    expect(cashText({ tab: "buy", date: "2026-02-02", instrument: inst("HOLD"), amount: "600" }, { availableCash: () => new D(600) })).toBe("Összeg: 600 Ft · készpénzből 600 Ft");
    // A manual item's own amount is not the account's "befizetés" or "kivét" (#26).
    expect(cashText({ tab: "sell", date: "2026-02-02", instrument: inst("HOLD"), amount: "300" })).toBe("Összeg: 300 Ft · a pénz a számlán maradt");
  });
});

describe("government securities in the list (spec 2026-09-28 §7)", () => {
  const ev = (id: string, type: LedgerEvent["type"], lines: [Line["kind"], string | null, string, Line["role"]][]): LedgerEvent => ({
    id, type, date: "2026-09-25", createdAt: "2026-09-28T10:00:00Z", correctionKind: null, splitRatio: null, note: null,
    lines: lines.map(([kind, instrumentId, amount, role], k) => ({
      id: `${id}-${k}`, kind, accountId: "A", instrumentId, currency: "HUF", amount: new D(amount), role,
      costAmount: kind === "position" && new D(amount).gt(0) ? new D(amount) : null, costEstimated: false, costFxRefs: null,
    })),
  });
  const reinvest = [ev("r", "interest_reinvest", [["cash", "B", "61100", "income"], ["cash", null, "-61100", "trade"], ["position", "B", "61100", "trade"]])];
  const interest = [ev("i", "interest", [["cash", "B", "8700", "income"]]), ev("w", "withdrawal", [["cash", null, "-8700", "external"]])];
  const maturity = [ev("m", "maturity", [["position", "B", "-1061100", "trade"], ["cash", null, "1061100", "trade"], ["cash", "B", "67500", "income"]])];

  it("their own kinds, amounts and texts; a withdrawal next to them is 'kivéve'", () => {
    const entryText = (e: Parameters<typeof entryDetail>[0]) => entryDetail(e, i18nFor("hu")).replace(/\s/g, " ");
    const r = describeEntry("E1", reinvest, valuationOf);
    expect(r).toMatchObject({ kind: "interest_reinvest", instrumentId: "B", amount: new D(61100), interest: null, kept: false });
    expect(entryText(r)).toBe("61 100 Ft");
    const i = describeEntry("E2", interest, valuationOf);
    expect(i).toMatchObject({ kind: "interest", amount: new D(8700), kept: false });
    expect(entryText(i)).toBe("8700 Ft · kivéve");
    const mt = describeEntry("E3", maturity, valuationOf);
    expect(mt).toMatchObject({ kind: "maturity", amount: new D(1061100), interest: new D(67500), kept: true });
    expect(entryText(mt)).toBe("névérték 1 061 100 Ft, kamat 67 500 Ft · a pénz a számlán maradt");
  });

  it("no edit form: the proposal card is where they change", () => {
    expect(entryToInput(maturity, { valuations: [] }, { institutionId: "BR", valuationOf }, hu)).toBeNull();
  });
});

describe("entryToInput: a government security buy edits as nominal and amount paid", () => {
  it("the amount goes back into Fizetett összeg, never into a unit price", () => {
    const buy: LedgerEvent = {
      id: "b", type: "buy", date: "2026-09-20", createdAt: "2026-09-26T10:00:00Z", correctionKind: null, splitRatio: null, note: null,
      lines: [
        { id: "b1", kind: "position", accountId: "A", instrumentId: "M5", currency: "HUF", amount: new D(1000000), role: "trade", costAmount: new D(1001200), costEstimated: false, costFxRefs: null },
        { id: "b2", kind: "cash", accountId: "A", instrumentId: null, currency: "HUF", amount: new D(-1001200), role: "trade", costAmount: null, costEstimated: false, costFxRefs: null },
      ],
    };
    const r = entryToInput([buy], { valuations: [] }, { institutionId: "BR", valuationOf, bondOf: (id) => id === "M5" }, hu);
    expect(r).toMatchObject({ quantity: "1000000", price: "", total: "1001200" });
  });

  it("an estimated buy comes back with its amount: the ÁKK can estimate only today's buy", () => {
    const buy: LedgerEvent = {
      id: "b", type: "buy", date: "2026-09-20", createdAt: "2026-09-20T10:00:00Z", correctionKind: null, splitRatio: null, note: null,
      lines: [
        { id: "b1", kind: "position", accountId: "A", instrumentId: "M5", currency: "HUF", amount: new D(500000), role: "trade", costAmount: new D(500245), costEstimated: true, costFxRefs: null },
        { id: "b2", kind: "cash", accountId: "A", instrumentId: null, currency: "HUF", amount: new D(-500245), role: "trade", costAmount: null, costEstimated: false, costFxRefs: null },
      ],
    };
    const r = entryToInput([buy], { valuations: [] }, { institutionId: "BR", valuationOf, bondOf: (id) => id === "M5" }, hu);
    expect(r).toMatchObject({ quantity: "500000", price: "", total: "500245" });
  });
});
