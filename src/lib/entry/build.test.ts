import { describe, expect, it } from "vitest";
import type { FxRow } from "@/lib/finance/fx";
import { D, type Dec } from "@/lib/finance/money";
import type { ManualValuation, PriceQuote } from "@/lib/finance/prices";
import { periodFigures, type PortfolioData } from "@/lib/finance/valuation";
import type { AkkRow } from "@/lib/providers/akk";
import type { SymbolInfo } from "@/lib/providers/symbols";
import { endOfDayBudapest } from "@/lib/tx/parse";
import {
  buildEntry,
  type EntryContext,
  type EntryInput,
  type EntryPayload,
  ENTRY_AUTO_VALUE_NOTE,
  ENTRY_VALUE_NOTE,
  emptyEntryInput,
  lookupPlan,
  payloadEvents,
} from "./build";
import { availableFrom, cashKey, cashTimeline } from "./cash";

const fxRow = (id: string, base: string, rate: string, rateDate: string): FxRow => ({
  id, base, quote: "HUF", rate, rateDate, source: "MNB", status: "ok", supersedesId: null, fetchedAt: `${rateDate}T12:00:00Z`,
});

const infos: Record<string, SymbolInfo | null> = {
  "PLDA.DE": { symbol: "PLDA.DE", name: "Példa AG", currency: "EUR", assetClass: "stock", exchange: "XETRA", close: { day: "2025-12-31", price: "50" } },
  FAKECO: { symbol: "FAKECO", name: "Fake Co", currency: "EUR", assetClass: "etf", exchange: "FAKE", close: { day: "2026-09-24", price: "112.5" } },
  "GBPX.L": { symbol: "GBPX.L", name: "Pence plc", currency: "GBp", assetClass: "stock", exchange: "LSE", close: { day: "2026-09-24", price: "310" } },
  NOCLOSE: { symbol: "NOCLOSE", name: "No Close", currency: "EUR", assetClass: "stock", exchange: null, close: null },
  NOPE: null,
};

function context(over: Partial<EntryContext> = {}): EntryContext {
  let n = 0;
  const holdings = new Map<string, Dec>([
    ["A|ST", new D(10)],
    ["A|HOLD", new D(1000)],
  ]);
  const values = new Map<string, Dec>([["A|HOLD", new D(1200)]]);
  return {
    today: "2026-09-26",
    institutions: new Set(["BR", "BANK"]),
    accounts: new Map([
      ["A", { institutionId: "BR", trackingStart: "2026-01-01", hasOpening: false }],
      ["O", { institutionId: "BR", trackingStart: "2026-01-01", hasOpening: true }],
      ["K", { institutionId: "BANK", trackingStart: "2026-01-01", hasOpening: false }],
    ]),
    instruments: new Map([
      ["ST", { name: "Példa AG", currency: "EUR", valuation: "market" as const, priceSource: "yahoo", symbol: "PLDA.DE" }],
      ["MS", { name: "Magyar részvény", currency: "HUF", valuation: "market" as const, priceSource: "manual", symbol: null }],
      ["HOLD", { name: "Hold", currency: "HUF", valuation: "manual" as const, priceSource: "manual", symbol: null }],
    ]),
    fxRows: [fxRow("eur", "EUR", "400", "2026-02-02")],
    holding: (a, i) => holdings.get(`${a}|${i}`) ?? new D(0),
    valueOn: (a, i) => values.get(`${a}|${i}`) ?? null,
    maturityBooked: () => null,
    availableCash: () => new D(0),
    symbols: new Map(Object.entries(infos)),
    newId: () => `id${++n}`,
    locale: "hu",
    ...over,
  };
}

const input = (over: Partial<EntryInput>): EntryInput => ({ ...emptyEntryInput(), ...over });
const existing = { institution: { mode: "existing" as const, id: "BR", name: "" }, account: { mode: "existing" as const, id: "A", name: "", accountType: "normal" } };

function ok(i: EntryInput, ctx = context()): EntryPayload {
  const r = buildEntry(i, ctx);
  if (!r.ok) throw new Error(`unexpected errors: ${JSON.stringify(r.errors)}`);
  return r.payload;
}
function errors(i: EntryInput, ctx = context()) {
  const r = buildEntry(i, ctx);
  if (r.ok) throw new Error(`expected errors, got ${JSON.stringify(r.payload)}`);
  return r.errors;
}
const lines = (p: EntryPayload) =>
  p.entries.map((e) => e.events.map((ev) => [ev.type, ev.date, ev.lines.map((l) => [l.kind, l.accountId, l.instrumentId, l.currency, l.amount, l.role, l.costAmount, l.costEstimated])]));

describe("Vétel (a deposit and a buy)", () => {
  const buy = (over: Partial<EntryInput> = {}) =>
    input({ tab: "buy", ...existing, date: "2026-02-02", instrument: { mode: "existing", id: "ST", symbol: "", name: "", currency: "", assetClass: "" }, ...over });

  it("the invested amount comes in as a deposit, so the cash nets to zero", () => {
    const p = ok(buy({ quantity: "12", price: "112,50", fee: "2", note: "első vétel" }));
    expect(lines(p)).toEqual([
      [
        ["deposit", "2026-02-02", [["cash", "A", null, "EUR", "1352", "external", null, false]]],
        ["buy", "2026-02-02", [["position", "A", "ST", "EUR", "12", "trade", "1352", false], ["cash", "A", null, "EUR", "-1350", "trade", null, false], ["cash", "A", null, "EUR", "-2", "fee", null, false]]],
      ],
    ]);
    expect(p.entries[0].events.map((e) => e.note)).toEqual([null, "első vétel"]);
    expect(p.entries[0].events[1].lines[0].costFxRefs).toEqual({ HUF: ["eur"], EUR: [], USD: null });
  });

  it("the total can stand in for the unit price", () => {
    const p = ok(buy({ quantity: "3", total: "100" }));
    expect(p.entries[0].events[1].lines[0].costAmount).toBe("100");
  });

  it("without a price or a total: the Yahoo close on the buy day, as an estimated cost", () => {
    const ctx = context({ symbols: new Map([["PLDA.DE", { ...infos["PLDA.DE"]!, close: { day: "2026-01-30", price: "50" } }]]) });
    const p = ok(buy({ quantity: "12", fee: "2" }), ctx);
    expect(lines(p)).toEqual([
      [
        ["deposit", "2026-02-02", [["cash", "A", null, "EUR", "602", "external", null, false]]],
        ["buy", "2026-02-02", [["position", "A", "ST", "EUR", "12", "trade", "602", true], ["cash", "A", null, "EUR", "-600", "trade", null, false], ["cash", "A", null, "EUR", "-2", "fee", null, false]]],
      ],
    ]);
    expect(p.quotes).toEqual([{ instrumentId: "ST", price: "50", currency: "EUR", asOf: endOfDayBudapest("2026-01-30"), source: "yahoo" }]);
  });

  it("a new Yahoo symbol without a price takes its close too; a typed price is not an estimate", () => {
    const p = ok(buy({ date: "2026-09-24", instrument: { mode: "yahoo", id: "", symbol: "fakeco", name: "", currency: "", assetClass: "" }, quantity: "2" }));
    expect(p.instruments.map((i) => i.providerSymbol)).toEqual(["FAKECO"]);
    expect(p.entries[0].events[1].lines[0]).toMatchObject({ costAmount: "225", costEstimated: true });
    expect(ok(buy({ quantity: "2", price: "10" })).entries[0].events[1].lines[0]).toMatchObject({ costAmount: "20", costEstimated: false });
    expect(ok(buy({ quantity: "2", price: "10" })).quotes).toEqual([]);
  });

  it("no close for the buy day, or one in another currency: asks for the price", () => {
    const noClose = context({ symbols: new Map([["PLDA.DE", { ...infos["PLDA.DE"]!, close: null }]]) });
    expect(errors(buy({ quantity: "1" }), noClose)).toEqual({ price: "noPrice" });
    const otherCurrency = context({ symbols: new Map([["PLDA.DE", { ...infos["PLDA.DE"]!, currency: "USD" }]]) });
    expect(errors(buy({ quantity: "1" }), otherCurrency)).toEqual({ price: "noPrice" });
    // An instrument priced by hand has no Yahoo close to fall back on.
    expect(errors(buy({ instrument: { mode: "existing", id: "MS", symbol: "", name: "", currency: "", assetClass: "" }, quantity: "1" }))).toEqual({ price: "noPrice" });
  });

  it("a buy on or before the start moves the start of an account without opening balance", () => {
    const p = ok(buy({ date: "2025-12-15", quantity: "1", price: "10" }));
    expect(p.trackingStart).toEqual({ accountId: "A", day: "2025-12-14" });
    expect(errors(buy({ account: { ...existing.account, id: "O" }, date: "2026-01-01", quantity: "1", price: "10" }))).toEqual({ date: "beforeStartOpening" });
  });

  it("a new account on the buy tab starts the day before the buy", () => {
    const p = ok(buy({ account: { mode: "new", id: "", name: "Új", accountType: "normal" }, quantity: "1", price: "10" }));
    expect(p.account?.trackingStart).toBe("2026-02-01");
    expect(p.trackingStart).toBeUndefined();
  });

  it("refuses a future day, a missing day and an account of another broker", () => {
    expect(errors(buy({ date: "2026-09-27", quantity: "1", price: "1" }))).toEqual({ date: "future" });
    expect(errors(buy({ date: "", quantity: "1", price: "1" }))).toEqual({ date: "required" });
    expect(errors(buy({ account: { ...existing.account, id: "K" }, quantity: "1", price: "1" }))).toEqual({ "account.id": "unknown" });
    expect(errors(buy({ institution: { mode: "new", id: "", name: "X" }, quantity: "1", price: "1" }))).toEqual({ "account.id": "unknown" });
  });

  it("a manual item: the paid-in amount buys units at the latest value's unit price, and the total grows by it", () => {
    const manual = { mode: "existing" as const, id: "HOLD", symbol: "", name: "", currency: "", assetClass: "" };
    const p = ok(buy({ instrument: manual, amount: "600" }));
    // 1 200 Ft for 1 000 units: 1,2 Ft a unit, so 600 Ft is 500 units.
    expect(lines(p)[0][1]).toEqual(["buy", "2026-02-02", [["position", "A", "HOLD", "HUF", "500", "trade", "600", false], ["cash", "A", null, "HUF", "-600", "trade", null, false]]]);
    expect(p.entries[0].events[1].valuations).toEqual([
      { accountId: "A", instrumentId: "HOLD", value: "1800", currency: "HUF", asOf: endOfDayBudapest("2026-02-02"), note: ENTRY_AUTO_VALUE_NOTE },
    ]);
    const typed = ok(buy({ instrument: manual, amount: "600", newValue: "1 850" }));
    expect(typed.entries[0].events[1].valuations[0]).toMatchObject({ value: "1850", note: ENTRY_VALUE_NOTE });
  });

  it("a manual item typed again by name and currency is the one already there", () => {
    const p = ok(buy({ instrument: { mode: "manual", id: "", symbol: "", name: " hold ", currency: "huf", assetClass: "managed" }, amount: "600" }));
    expect(p.instruments).toEqual([]);
    expect(p.entries[0].events[1].lines[0].instrumentId).toBe("HOLD");
    // Another currency is another item.
    expect(ok(buy({ instrument: { mode: "manual", id: "", symbol: "", name: "Hold", currency: "EUR", assetClass: "managed" }, amount: "600" })).instruments).toHaveLength(1);
  });

  it("a new manual item starts at one unit per currency unit", () => {
    const p = ok(buy({ instrument: { mode: "manual", id: "", symbol: "", name: "Állampapír", currency: "HUF", assetClass: "bond" }, amount: "250000" }));
    expect(p.entries[0].events[1].lines[0]).toMatchObject({ amount: "250000", costAmount: "250000" });
    expect(p.entries[0].events[1].valuations[0].value).toBe("250000");
  });

  it("with cash on the account the buy takes it first; only the rest comes in as a deposit", () => {
    const ctx = context({ availableCash: (a, c, d) => (a === "A" && c === "EUR" && d === "2026-02-02" ? new D(1000) : new D(0)) });
    const p = ok(buy({ quantity: "12", price: "112,50", fee: "2" }), ctx);
    expect(lines(p)).toEqual([
      [
        ["deposit", "2026-02-02", [["cash", "A", null, "EUR", "352", "external", null, false]]],
        ["buy", "2026-02-02", [["position", "A", "ST", "EUR", "12", "trade", "1352", false], ["cash", "A", null, "EUR", "-1350", "trade", null, false], ["cash", "A", null, "EUR", "-2", "fee", null, false]]],
      ],
    ]);
  });

  it("enough cash: no deposit at all; 'Teljes egészében új befizetésből' brings all of it in anyway", () => {
    const ctx = context({ availableCash: () => new D(5000) });
    expect(ok(buy({ quantity: "12", price: "112,50", fee: "2" }), ctx).entries[0].events.map((e) => e.type)).toEqual(["buy"]);
    const p = ok(buy({ quantity: "12", price: "112,50", fee: "2", payFrom: "deposit" }), ctx);
    expect(p.entries[0].events.map((e) => [e.type, e.lines[0].amount])).toEqual([["deposit", "1352"], ["buy", "12"]]);
  });

  it("the server decides: no cash in the context means a full deposit, whatever the form showed", () => {
    const p = ok(buy({ quantity: "2", price: "100", payFrom: "cash" }), context({ availableCash: () => new D(0) }));
    expect(p.entries[0].events.map((e) => [e.type, e.lines[0].amount])).toEqual([["deposit", "200"], ["buy", "2"]]);
  });

  it("only cash in the buy's own currency counts, and a new account has none", () => {
    const hufOnly = context({ availableCash: (_a, c) => (c === "HUF" ? new D(9999) : new D(0)) });
    expect(ok(buy({ quantity: "2", price: "100" }), hufOnly).entries[0].events.map((e) => e.type)).toEqual(["deposit", "buy"]);
    const rich = context({ availableCash: () => new D(9999) });
    const fresh = ok(buy({ account: { mode: "new", id: "", name: "Új", accountType: "normal" }, quantity: "1", price: "10" }), rich);
    expect(fresh.entries[0].events.map((e) => e.type)).toEqual(["deposit", "buy"]);
  });

  it("a gap below the 10th decimal is no deposit of 0; one that rounds up is a deposit that balances (#28)", () => {
    const ctx = context({ availableCash: () => new D(1) });
    // 0,3 × 3,3333333334 = 1,00000000002: stored as 1, all of it from the cash.
    const tiny = ok(buy({ quantity: "0,3", price: "3,3333333334" }), ctx);
    expect(tiny.entries[0].events.map((e) => [e.type, e.lines.map((l) => l.amount)])).toEqual([["buy", ["0.3", "-1"]]]);
    // 0,3 × 3,3333333337 = 1,00000000011: stored as 1,0000000001, the extra 0,0000000001 comes in.
    const up = ok(buy({ quantity: "0,3", price: "3,3333333337" }), ctx);
    expect(up.entries[0].events.map((e) => [e.type, e.lines.map((l) => l.amount)])).toEqual([["deposit", ["0.0000000001"]], ["buy", ["0.3", "-1.0000000001"]]]);
  });

  it("a manual item bought from cash: no deposit", () => {
    const manual = { mode: "existing" as const, id: "HOLD", symbol: "", name: "", currency: "", assetClass: "" };
    const p = ok(buy({ instrument: manual, amount: "600" }), context({ availableCash: (_a, c) => (c === "HUF" ? new D(600) : new D(0)) }));
    expect(p.entries[0].events.map((e) => e.type)).toEqual(["buy"]);
  });
});

describe("Eladás (a sale and a withdrawal)", () => {
  const sell = (over: Partial<EntryInput> = {}) =>
    input({ tab: "sell", ...existing, date: "2026-03-02", instrument: { mode: "existing", id: "ST", symbol: "", name: "", currency: "", assetClass: "" }, ...over });

  it("'Kivettem': the net proceeds leave as a withdrawal", () => {
    const p = ok(sell({ quantity: "4", price: "60", fee: "1,5", proceeds: "withdraw" }));
    expect(lines(p)).toEqual([
      [
        ["sell", "2026-03-02", [["position", "A", "ST", "EUR", "-4", "trade", null, false], ["cash", "A", null, "EUR", "240", "trade", null, false], ["cash", "A", null, "EUR", "-1.5", "fee", null, false]]],
        ["withdrawal", "2026-03-02", [["cash", "A", null, "EUR", "-238.5", "external", null, false]]],
      ],
    ]);
  });

  it("'A számlán marad' (the default): only the sale, the money stays as cash", () => {
    const p = ok(sell({ quantity: "4", price: "60", fee: "1,5" }));
    expect(p.entries[0].events.map((e) => e.type)).toEqual(["sell"]);
  });

  it("still needs a price or a total", () => {
    expect(errors(sell({ quantity: "3" }))).toEqual({ price: "required" });
  });

  it("not more than held, a fee below the proceeds, only an instrument that is there, after the start", () => {
    expect(errors(sell({ quantity: "11", price: "1" }))).toEqual({ quantity: "insufficient" });
    expect(errors(sell({ quantity: "1", price: "1", fee: "1" }))).toEqual({ fee: "feeTooHigh" });
    expect(errors(sell({ instrument: { mode: "yahoo", id: "", symbol: "FAKECO", name: "", currency: "", assetClass: "" }, quantity: "1", price: "1" }))).toEqual({ instrument: "unknown" });
    expect(errors(sell({ date: "2026-01-01", quantity: "1", price: "1" }))).toEqual({ date: "beforeStart" });
  });

  it("a manual item: units go in proportion to the latest value, and the total shrinks by the amount", () => {
    const manual = { mode: "existing" as const, id: "HOLD", symbol: "", name: "", currency: "", assetClass: "" };
    const p = ok(sell({ instrument: manual, amount: "300" }));
    expect(lines(p)[0][0]).toEqual(["sell", "2026-03-02", [["position", "A", "HOLD", "HUF", "-250", "trade", null, false], ["cash", "A", null, "HUF", "300", "trade", null, false]]]);
    expect(p.entries[0].events[0].valuations[0]).toMatchObject({ value: "900", note: ENTRY_AUTO_VALUE_NOTE });
    expect(ok(sell({ instrument: manual, amount: "1200" })).entries[0].events[0].lines[0].amount).toBe("-1000");
    expect(errors(sell({ instrument: manual, amount: "1201" }))).toEqual({ amount: "insufficientValue" });
    expect(errors(sell({ instrument: manual, amount: "1" }), context({ valueOn: () => null }))).toEqual({ amount: "noValue" });
    expect(ok(sell({ instrument: manual, amount: "300" })).entries[0].events.map((e) => e.type)).toEqual(["sell"]);
    expect(ok(sell({ instrument: manual, amount: "300", proceeds: "withdraw" })).entries[0].events.map((e) => [e.type, e.lines[0].amount])).toEqual([["sell", "-250"], ["withdrawal", "-300"]]);
  });
});

describe("lookupPlan: what the action fetches from Yahoo before building", () => {
  const inst = (mode: "yahoo" | "existing", v: string) => ({ mode, id: mode === "existing" ? v : "", symbol: mode === "yahoo" ? v : "", name: "", currency: "", assetClass: "" });
  const buy = (over: Partial<EntryInput>) => input({ tab: "buy", ...existing, date: "2026-02-02", quantity: "1", ...over });

  it("a new symbol, and the symbol of a buy without a price, for the close on the buy day", () => {
    const ctx = context();
    // A new symbol with its price given: its name and currency only, not the close (#29).
    expect(lookupPlan(buy({ instrument: inst("yahoo", " fakeco "), price: "10" }), ctx)).toEqual({ symbols: ["FAKECO"], closeDay: "2026-02-02", close: false, betCodes: [], series: [] });
    expect(lookupPlan(buy({ instrument: inst("yahoo", " fakeco "), total: "10" }), ctx).close).toBe(false);
    expect(lookupPlan(buy({ instrument: inst("existing", "ST") }), ctx)).toEqual({ symbols: ["PLDA.DE"], closeDay: "2026-02-02", close: true, betCodes: [], series: [] });
    expect(lookupPlan(buy({ instrument: inst("yahoo", "PLDA.DE") }), ctx)).toEqual({ symbols: ["PLDA.DE"], closeDay: "2026-02-02", close: true, betCodes: [], series: [] });
  });

  it("nothing for a typed price or total of a known symbol, for a manual item or for a sale", () => {
    const ctx = context();
    expect(lookupPlan(buy({ instrument: inst("existing", "ST"), price: "10" }), ctx).symbols).toEqual([]);
    expect(lookupPlan(buy({ instrument: inst("existing", "ST"), total: "10" }), ctx).symbols).toEqual([]);
    expect(lookupPlan(buy({ instrument: inst("existing", "HOLD") }), ctx).symbols).toEqual([]);
    expect(lookupPlan(input({ tab: "sell", ...existing, date: "2026-02-02", instrument: inst("existing", "ST") }), ctx)).toEqual({ symbols: [], closeDay: null, close: false, betCodes: [], series: [] });
  });
});

describe("performance from the buy day (plan §4, via the core's periodFigures)", () => {
  const T = "2026-09-24";
  const newAccount = (name: string) => ({
    institution: { mode: "new" as const, id: "", name: "Bróker" },
    account: { mode: "new" as const, id: "", name, accountType: "normal" },
  });
  const fakeco = { mode: "yahoo" as const, id: "", symbol: "FAKECO", name: "", currency: "", assetClass: "" };

  function portfolio(payloads: EntryPayload[], quotes: [string, string][]): PortfolioData {
    const events = payloads.flatMap((p) => payloadEvents(p, "2026-09-26T10:00:00Z"));
    const instruments = payloads.flatMap((p) => p.instruments);
    return {
      accounts: payloads.flatMap((p) => (p.account ? [{ id: p.account.id, trackingStart: p.account.trackingStart }] : [])),
      instruments: instruments.map((i) => ({ id: i.id, name: i.name, assetClass: i.assetClass, currency: i.currency, valuation: i.valuation, priceSource: i.priceSource, staleAfterDays: null })),
      events,
      quotes: [
        ...payloads.flatMap((p) => p.quotes).map((q, n): PriceQuote => ({ id: `y${n}`, ...q, enteredAt: q.asOf, status: "ok", supersedesId: null })),
        ...quotes.map(([day, price], n): PriceQuote => ({
          id: `q${n}`, instrumentId: instruments[0].id, price, currency: "EUR", asOf: endOfDayBudapest(day), enteredAt: endOfDayBudapest(day), source: "yahoo", status: "ok", supersedesId: null,
        })),
      ],
      valuations: payloads.flatMap((p) => p.entries.flatMap((e) => e.events.flatMap((ev) => ev.valuations))).map((v, n): ManualValuation => ({
        id: `v${n}`, ...v, enteredAt: v.asOf, source: "manual", status: "ok", supersedesId: null,
      })),
      fxRows: [],
    };
  }

  it("the money of a buy comes in as a deposit on its day: the result is the price change after it", () => {
    const p = ok(input({ tab: "buy", ...newAccount("Számla"), date: T, instrument: fakeco, quantity: "12" }));
    expect(p.account?.trackingStart).toBe("2026-09-23");
    const f = periodFigures(portfolio([p], [["2026-09-25", "120"]]), "2026-09-01", "2026-09-25", "EUR")!;
    expect(f.flows.map((x) => [x.kind, x.day, x.amount.toString()])).toEqual([["deposit", T, "1350"]]);
    expect(f.result.toString()).toBe("90"); // 12 × (120 − 112,5)
  });

  it("an account whose first buy comes later brings its money in as a deposit, not as a gain", () => {
    const first = ok(input({ tab: "buy", ...newAccount("Első"), date: T, instrument: fakeco, quantity: "12" }));
    const later = ok(
      input({ tab: "buy", ...newAccount("Második"), date: "2026-09-25", instrument: { mode: "manual", id: "", symbol: "", name: "Hold", currency: "EUR", assetClass: "managed" }, amount: "1000" }),
      context({ newId: (() => { let n = 100; return () => `id${++n}`; })() }),
    );
    const f = periodFigures(portfolio([first, later], [["2026-09-25", "112.5"]]), "2026-09-25", "2026-09-25", "EUR")!;
    expect(f.flows.map((x) => [x.kind, x.day, x.amount.toString()])).toEqual([["deposit", "2026-09-25", "1000"]]);
    expect(f.result.toString()).toBe("0");
  });
  it("a sale that keeps its money and a buy from it bring no new money: only the first deposit is a flow", () => {
    const first = ok(input({ tab: "buy", ...newAccount("Számla"), date: T, instrument: fakeco, quantity: "12" }));
    const inst = first.instruments[0].id;
    const acc = first.account!.id;
    const broker = first.institution!.id;
    const later = (i: Partial<EntryInput>, done: EntryPayload[]) => {
      const timeline = cashTimeline(done.flatMap((p) => payloadEvents(p, "2026-09-26T10:00:00Z")));
      let k = 200 + done.length * 10;
      return ok(
        input({
          institution: { mode: "existing", id: broker, name: "" },
          account: { mode: "existing", id: acc, name: "", accountType: "normal" },
          instrument: { mode: "existing", id: inst, symbol: "", name: "", currency: "", assetClass: "" },
          ...i,
        }),
        context({
          institutions: new Set([broker]),
          accounts: new Map([[acc, { institutionId: broker, trackingStart: first.account!.trackingStart, hasOpening: false }]]),
          instruments: new Map([[inst, { name: "Fake Co", currency: "EUR", valuation: "market" as const, priceSource: "yahoo", symbol: "FAKECO" }]]),
          holding: () => new D(12),
          availableCash: (a, c, d) => availableFrom(timeline.get(cashKey(a, c)), d),
          newId: () => `id${++k}`,
        }),
      );
    };
    const sale = later({ tab: "sell", date: "2026-09-25", quantity: "4", price: "120" }, [first]);
    const rebuy = later({ tab: "buy", date: "2026-09-25", quantity: "4", price: "120" }, [first, sale]);
    expect(rebuy.entries[0].events.map((e) => e.type)).toEqual(["buy"]);
    const f = periodFigures(portfolio([first, sale, rebuy], [["2026-09-25", "120"]]), "2026-09-01", "2026-09-25", "EUR")!;
    expect(f.flows.map((x) => [x.kind, x.day, x.amount.toString()])).toEqual([["deposit", T, "1350"]]);
    expect(f.result.toString()).toBe("90"); // 12 × (120 − 112,5); nothing counted twice
  });
});

describe("government securities from the ÁKK list (spec 2026-09-28 §3.1–§3.2)", () => {
  const row = (series: string, over: Partial<AkkRow> = {}): AkkRow => ({
    series, securityType: "MÁPP_T", kind: "mapp", tab: "MAPP", issue: "2026-07-20", maturity: "2031-08-21", settle: "2026-09-28",
    bid: new D(99), ask: new D(100), accrued: new D("0.9589"), coupon: new D(5), ...over,
  });
  const akk = new Map<string, AkkRow | null>([["2031/M5", row("2031/M5")], ["2027/N", row("2027/N", { securityType: "BMÁP", kind: "bmap", tab: "MAP", ask: null, maturity: "2027-05-26" })], ["NINCS/1", null]]);
  const withBond = (over: Partial<EntryContext> = {}) =>
    context({
      akk,
      instruments: new Map([
        ...context().instruments,
        ["M5", { name: "MÁP Plusz 2031/M5", currency: "HUF", valuation: "market" as const, priceSource: "akk", symbol: "2031/M5" }],
      ]),
      bondMaturity: new Map([["M5", "2031-08-21"]]),
      holding: (a, i) => (a === "A" && i === "M5" ? new D(1000000) : new D(0)),
      ...over,
    });
  const buyBond = (instrument: EntryInput["instrument"], over: Partial<EntryInput> = {}): EntryInput => ({
    ...emptyEntryInput(), tab: "buy", institution: { mode: "existing", id: "BR", name: "" }, account: { mode: "existing", id: "A", name: "", accountType: "normal" },
    date: "2026-09-20", instrument, quantity: "1 000 000", total: "1 001 200", payFrom: "deposit", ...over,
  });
  const akkPick = (series: string) => ({ mode: "akk" as const, id: "", symbol: series, name: "", currency: "", assetClass: "" });
  const existing = (id: string) => ({ mode: "existing" as const, id, symbol: "", name: "", currency: "", assetClass: "" });

  it("a new series: an ÁKK instrument with its terms; units = nominal, cost = the amount paid", () => {
    const r = buildEntry(buyBond(akkPick("2031/m5")), withBond({ instruments: context().instruments, bondMaturity: new Map() }));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.payload.instruments).toEqual([{
      id: "id1", name: "MÁP Plusz 2031/M5", assetClass: "bond", currency: "HUF", ticker: null, exchange: null, valuation: "market", priceSource: "akk", providerSymbol: "2031/M5",
      bond: { series: "2031/M5", securityType: "MÁPP_T", tab: "MAPP", issueDate: "2026-07-20", maturityDate: "2031-08-21" },
    }]);
    const buy = r.payload.entries[0].events.find((e) => e.type === "buy")!;
    expect(buy.lines.map((l) => [l.kind, l.amount, l.costAmount, l.costEstimated])).toEqual([["position", "1000000", "1001200", false], ["cash", "-1001200", null, false]]);
  });

  it("a series already there is that instrument, not a second one", () => {
    const r = buildEntry(buyBond(akkPick("2031/M5")), withBond());
    expect(r.ok && r.payload.instruments).toEqual([]);
    expect(r.ok && r.payload.entries[0].events.at(-1)?.lines[0].instrumentId).toBe("M5");
  });

  it("today's buy may leave the amount out: the Kincstár's ask plus accrued interest, estimated", () => {
    const r = buildEntry(buyBond(existing("M5"), { date: "2026-09-26", total: "" }), withBond());
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const pos = r.payload.entries[0].events.find((e) => e.type === "buy")!.lines[0];
    expect([pos.costAmount, pos.costEstimated]).toEqual(["1009589", true]);
  });

  it("an earlier day, or a paper without an ask, needs the amount from the statement", () => {
    expect(buildEntry(buyBond(existing("M5"), { total: "" }), withBond())).toEqual({ ok: false, errors: { total: "akkTotalRequired" } });
    expect(buildEntry(buyBond(akkPick("2027/N"), { date: "2026-09-26", total: "" }), withBond())).toEqual({ ok: false, errors: { total: "akkNoEstimate" } });
  });

  it("nothing on or after the maturity; an unknown series is refused", () => {
    expect(buildEntry(buyBond(akkPick("2027/N"), { date: "2027-05-26" }), withBond({ today: "2027-06-01" }))).toMatchObject({ ok: false, errors: { date: "matured" } });
    expect(buildEntry(buyBond(akkPick("NINCS/1")), withBond())).toMatchObject({ ok: false, errors: { instrument: "seriesNotFound" } });
  });

  it("before a maturity already approved, only a change that keeps what it repaid (#34)", () => {
    // The Lejárat on 2031-08-21 repaid everything held: nothing is left after it.
    const booked = withBond({ maturityBooked: (a, i) => (a === "A" && i === "M5" ? "2031-08-21" : null), holding: () => new D(0) });
    expect(buildEntry(buyBond(existing("M5")), booked)).toEqual({ ok: false, errors: { date: "maturityBooked" } });
    expect(buildEntry({ ...buyBond(existing("M5")), tab: "sell", quantity: "400000", total: "396 000", proceeds: "keep" }, booked)).toEqual({
      ok: false, errors: { date: "maturityBooked" },
    });
    // Editing the buy it repaid: without that buy, the holding after the maturity is its nominal below zero.
    const edit = withBond({ maturityBooked: () => "2031-08-21", holding: () => new D(-1000000), entryId: "E" });
    expect(buildEntry(buyBond(existing("M5"), { total: "1 000 500" }), edit).ok).toBe(true);
    expect(buildEntry(buyBond(existing("M5"), { quantity: "1 200 000" }), edit)).toEqual({ ok: false, errors: { date: "maturityBooked" } });
    // Another account's maturity does not count.
    expect(buildEntry(buyBond(existing("M5")), withBond({ maturityBooked: (a) => (a === "K" ? "2031-08-21" : null) })).ok).toBe(true);
  });

  it("a sale needs the nominal and the amount received", () => {
    const sale = (over: Partial<EntryInput>) => buildEntry({ ...buyBond(existing("M5")), tab: "sell", ...over }, withBond());
    expect(sale({ total: "" })).toMatchObject({ ok: false, errors: { total: "required" } });
    const r = sale({ quantity: "400000", total: "396 000", proceeds: "keep" });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.payload.entries[0].events.map((e) => [e.type, e.lines.map((l) => l.amount)])).toEqual([["sell", ["-400000", "396000"]]]);
  });

  it("the lookup asks the ÁKK for a new series, and for today's buy without an amount", () => {
    expect(lookupPlan(buyBond(akkPick("2031/m5")), withBond({ instruments: context().instruments })).series).toEqual(["2031/M5"]);
    expect(lookupPlan(buyBond(akkPick("2031/m5")), withBond()).series).toEqual([]); // already there, amount given
    expect(lookupPlan(buyBond(existing("M5")), withBond()).series).toEqual([]);
    expect(lookupPlan(buyBond(existing("M5"), { date: "2026-09-26", total: "" }), withBond()).series).toEqual(["2031/M5"]);
  });
});

describe("BÉT papers (spec 2026-09-28 §12/3)", () => {
  const bet = (code: string) => ({ mode: "bet" as const, id: "", symbol: code, name: "", currency: "", assetClass: "" });
  const betInfos: Record<string, SymbolInfo | null> = {
    TESZTETF: { symbol: "TESZTETF", name: "TESZTETF", currency: "EUR", assetClass: "etf", exchange: "BÉT", close: { day: "2026-09-25", price: "21.575" } },
    RITKA: { symbol: "RITKA", name: "RITKA", currency: "EUR", assetClass: "other", exchange: "BÉT", close: null },
    FURCSA: { symbol: "FURCSA", name: "FURCSA", currency: "XYZ1", assetClass: "stock", exchange: "BÉT", close: null },
    NINCS: null,
  };
  const withBet = (over: Partial<EntryContext> = {}) =>
    context({
      betSymbols: new Map(Object.entries(betInfos)),
      instruments: new Map([
        ...context().instruments,
        ["BT", { name: "OTP Bank", currency: "HUF", valuation: "market" as const, priceSource: "bet", symbol: "OTP" }],
      ]),
      ...over,
    });
  const buy = (over: Partial<EntryInput> = {}) => input({ tab: "buy", ...existing, date: "2026-09-25", quantity: "3", ...over });

  it("a new BÉT paper: its code is its name, the currency is the BÉT's, the source is the BÉT", () => {
    const p = ok(buy({ instrument: bet("tesztetf"), price: "21" }), withBet());
    expect(p.instruments).toEqual([
      { id: "id1", name: "TESZTETF", assetClass: "etf", currency: "EUR", ticker: "TESZTETF", exchange: "BÉT", valuation: "market", priceSource: "bet", providerSymbol: "TESZTETF" },
    ]);
    expect(p.quotes).toEqual([]);
  });

  it("without a price or a total: the BÉT close, as an estimate with the BÉT as its source", () => {
    const p = ok(buy({ instrument: bet("TESZTETF") }), withBet());
    expect(p.entries[0].events[1].lines[0]).toMatchObject({ costAmount: "64.725", costEstimated: true });
    expect(p.quotes).toEqual([{ instrumentId: "id1", price: "21.575", currency: "EUR", asOf: endOfDayBudapest("2026-09-25"), source: "bet" }]);
  });

  it("a code the BÉT does not know, a currency the Horizon does not keep, no close for an estimate", () => {
    expect(errors(buy({ instrument: bet("NINCS"), price: "1" }), withBet())).toEqual({ instrument: "betCodeNotFound" });
    expect(errors(buy({ instrument: bet("FURCSA"), price: "1" }), withBet())).toEqual({ instrument: "unsupportedCurrency" });
    expect(errors(buy({ instrument: bet("RITKA") }), withBet())).toEqual({ price: "noPrice" });
  });

  it("the BÉT paper already there is used, whatever the case; an estimate for it comes from the BÉT", () => {
    const ctx = withBet({ betSymbols: new Map([["OTP", { symbol: "OTP", name: "OTP", currency: "HUF", assetClass: "stock", exchange: "BÉT", close: { day: "2026-09-25", price: "46000" } }]]) });
    const p = ok(buy({ instrument: bet("otp") }), ctx);
    expect(p.instruments).toEqual([]);
    expect(p.entries[0].events[1].lines[0]).toMatchObject({ instrumentId: "BT", costAmount: "138000", costEstimated: true });
    expect(p.quotes).toEqual([{ instrumentId: "BT", price: "46000", currency: "HUF", asOf: endOfDayBudapest("2026-09-25"), source: "bet" }]);
    const viaList = ok(buy({ instrument: { mode: "existing", id: "BT", symbol: "", name: "", currency: "", assetClass: "" } }), ctx);
    expect(viaList.quotes.map((q) => q.source)).toEqual(["bet"]);
  });

  describe("the same paper on the BÉT and on Yahoo is one instrument: OTP ↔ OTP.BD (#44)", () => {
    const yahoo = (sym: string) => ({ mode: "yahoo" as const, id: "", symbol: sym, name: "", currency: "", assetClass: "" });
    const withTwins = (over: Partial<EntryContext> = {}) =>
      withBet({
        instruments: new Map([
          ...withBet().instruments,
          ["MT", { name: "Magyar Telekom", currency: "HUF", valuation: "market" as const, priceSource: "yahoo", symbol: "MTELEKOM.BD" }],
        ]),
        symbols: new Map([["MTELEKOM.BD", { symbol: "MTELEKOM.BD", name: "Magyar Telekom", currency: "HUF", assetClass: "stock", exchange: "BUD", close: { day: "2026-09-25", price: "1500" } }]]),
        ...over,
      });

    it("a BÉT hit whose Yahoo twin is already there is that instrument, its estimate from its own source", () => {
      const p = ok(buy({ instrument: bet("mtelekom") }), withTwins());
      expect(p.instruments).toEqual([]);
      expect(p.entries[0].events[1].lines[0]).toMatchObject({ instrumentId: "MT", costAmount: "4500", costEstimated: true });
      expect(p.quotes.map((q) => [q.instrumentId, q.source])).toEqual([["MT", "yahoo"]]);
      expect(lookupPlan(buy({ instrument: bet("MTELEKOM") }), withTwins())).toMatchObject({ symbols: ["MTELEKOM.BD"], betCodes: [] });
    });

    it("a Yahoo .BD hit whose BÉT twin is already there is that instrument", () => {
      const ctx = withTwins({ betSymbols: new Map([["OTP", { symbol: "OTP", name: "OTP", currency: "HUF", assetClass: "stock", exchange: "BÉT", close: { day: "2026-09-25", price: "46000" } }]]) });
      const p = ok(buy({ instrument: yahoo("otp.bd") }), ctx);
      expect(p.instruments).toEqual([]);
      expect(p.entries[0].events[1].lines[0]).toMatchObject({ instrumentId: "BT" });
      expect(p.quotes.map((q) => [q.instrumentId, q.source])).toEqual([["BT", "bet"]]);
      expect(lookupPlan(buy({ instrument: yahoo("OTP.BD") }), ctx)).toMatchObject({ symbols: [], betCodes: ["OTP"] });
    });

    it("where both are there already, the exact one wins", () => {
      const both = withTwins({
        instruments: new Map([...withTwins().instruments, ["OY", { name: "OTP (Yahoo)", currency: "HUF", valuation: "market" as const, priceSource: "yahoo", symbol: "OTP.BD" }]]),
      });
      expect(ok(buy({ instrument: yahoo("OTP.BD"), price: "1" }), both).entries[0].events[1].lines[0]).toMatchObject({ instrumentId: "OY" });
      expect(ok(buy({ instrument: bet("OTP"), price: "1" }), both).entries[0].events[1].lines[0]).toMatchObject({ instrumentId: "BT" });
    });
  });

  it("lookupPlan: a new code, and a known one without a price, are asked of the BÉT, never of Yahoo", () => {
    const ctx = withBet();
    expect(lookupPlan(buy({ instrument: bet(" tesztetf "), price: "1" }), ctx)).toEqual({ symbols: [], betCodes: ["TESZTETF"], closeDay: "2026-09-25", close: false, series: [] });
    expect(lookupPlan(buy({ instrument: { mode: "existing", id: "BT", symbol: "", name: "", currency: "", assetClass: "" } }), ctx)).toMatchObject({ symbols: [], betCodes: ["OTP"] });
    expect(lookupPlan(buy({ instrument: { mode: "existing", id: "BT", symbol: "", name: "", currency: "", assetClass: "" }, price: "1" }), ctx)).toMatchObject({ symbols: [], betCodes: [] });
  });
});

describe("numbers in the form's language (spec 2026-10-01 §2.5)", () => {
  const buy = (over: Partial<EntryInput> = {}) =>
    input({ tab: "buy", ...existing, date: "2026-02-02", instrument: { mode: "existing", id: "ST", symbol: "", name: "", currency: "", assetClass: "" }, ...over });

  it("English: point decimal, comma thousands", () => {
    const p = ok(buy({ quantity: "1,000.00", price: "12.5" }), context({ locale: "en" }));
    expect(p.entries[0].events[1].lines[0].amount).toBe("1000");
    expect(p.entries[0].events[1].lines[0].costAmount).toBe("12500");
  });

  it("English refuses a Hungarian-style number", () => {
    expect(errors(buy({ quantity: "10", price: "12,5" }), context({ locale: "en" })).price).toBe("number");
  });

  it("English refuses one comma group without a point as ambiguous (owner, 2026-10-01)", () => {
    expect(errors(buy({ quantity: "1,000", price: "12.5" }), context({ locale: "en" })).quantity).toBe("ambiguous");
  });
});
