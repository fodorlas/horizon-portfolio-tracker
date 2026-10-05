import { describe, expect, it } from "vitest";
import cases from "../../../tests/fixtures/event-validation-cases.json";
import { costBasis, runLedger, validateEvent, type EventType, type FxFn, type LedgerEvent, type Line } from "./ledger";
import { D } from "./money";

type CompactLine = (string | number | boolean | null)[];
let seq = 0;

function line(c: CompactLine, refs: Line["costFxRefs"] = null): Line {
  const [kind, account, instrument, currency, amount, role, cost, est] = c;
  return {
    id: `l${++seq}`,
    kind: kind as Line["kind"],
    accountId: account as string,
    instrumentId: (instrument as string | null) ?? null,
    currency: currency as string,
    amount: new D(amount as string),
    role: role as Line["role"],
    costAmount: cost === null ? null : new D(cost as string),
    costEstimated: Boolean(est),
    costFxRefs: refs,
  };
}

function ev(type: EventType, date: string, lines: CompactLine[], extra: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    id: `e${++seq}`, type, date, createdAt: `${date}T12:00:00Z`, correctionKind: null, splitRatio: null, note: null,
    lines: lines.map((l) => line(l)), ...extra,
  };
}

const ctx = {
  instrumentCurrency: (id: string) => (cases.instruments as Record<string, string>)[id],
  trackingStart: (id: string) => (cases.accounts as Record<string, string>)[id],
};

type Case = { type: string; date: string; lines: CompactLine[]; correctionKind?: string; splitRatio?: string; note?: string };

function fromCase(c: Case): LedgerEvent {
  return ev(c.type as EventType, c.date, c.lines, {
    correctionKind: (c.correctionKind as LedgerEvent["correctionKind"]) ?? null,
    splitRatio: c.splitRatio ? new D(c.splitRatio) : null,
    note: c.note ?? null,
  });
}

describe("validateEvent – shared cases (same file drives the SQL validator test)", () => {
  for (const c of cases.valid) {
    it(`valid: ${c.name}`, () => expect(validateEvent(fromCase(c), ctx)).toEqual([]));
  }
  for (const c of cases.invalid) {
    it(`invalid: ${c.name}`, () => expect(validateEvent(fromCase(c), ctx).sort()).toEqual([...c.errors].sort()));
  }
  it("unknown instruments and positions without an instrument are errors", () => {
    const e = ev("buy", "2026-02-01", [["position", "A1", "NOPE", "USD", "1", "trade", "1", false], ["cash", "A1", null, "USD", "-1", "trade", null, false]]);
    expect(validateEvent(e, ctx)).toContain("unknown_instrument");
    const e2 = ev("buy", "2026-02-01", [["position", "A1", null, "USD", "1", "trade", "1", false], ["cash", "A1", null, "USD", "-1", "trade", null, false]]);
    expect(validateEvent(e2, ctx)).toContain("position_without_instrument");
    const e3 = ev("buy", "2026-02-01", [["position", "A1", "I1", "USD", "1", "trade", "-1", false], ["cash", "A1", null, "USD", "-1", "trade", null, false]]);
    expect(validateEvent(e3, ctx)).toContain("negative_cost");
  });
});

const noFx: FxFn = () => null;

describe("runLedger", () => {
  const buy1 = ev("buy", "2026-02-01", [["position", "A1", "I1", "USD", "10", "trade", "3411", false], ["cash", "A1", null, "USD", "-3410", "trade", null, false], ["cash", "A1", null, "USD", "-1", "fee", null, false]]);
  buy1.lines[0].costFxRefs = { HUF: ["fx-huf-0201"], EUR: ["fx-eur-0201", "fx-usd-0201"], USD: [] };
  const buy2 = ev("buy", "2026-02-05", [["position", "A1", "I1", "USD", "5", "trade", "1750", false], ["cash", "A1", null, "USD", "-1750", "trade", null, false]]);
  const sell = ev("sell", "2026-02-10", [["position", "A1", "I1", "USD", "-12", "trade", null, false], ["cash", "A1", null, "USD", "4200", "trade", null, false], ["cash", "A1", null, "USD", "-1", "fee", null, false]]);

  it("FIFO: realised = proceeds − fees − cost of the consumed lots", () => {
    const s = runLedger([sell, buy2, buy1], noFx); // order of input does not matter
    const r = s.realized[0];
    expect([r.proceeds, r.fees, r.cost, r.result].map(String)).toEqual(["4200", "1", "4111", "88"]);
    expect(r.disposals.map((d) => [d.lot.lineId, d.lot.qty.toString(), d.cost.toString()])).toEqual([
      [buy1.lines[0].id, "10", "3411"],
      [buy2.lines[0].id, "2", "700"],
    ]);
    // FX references of the acquisition travel with the disposed lot (plan §3.2).
    expect(r.disposals[0].lot.costFxRefs).toEqual({ HUF: ["fx-huf-0201"], EUR: ["fx-eur-0201", "fx-usd-0201"], USD: [] });

    const p = s.positions.get("A1|I1")!;
    expect(p.qty.toString()).toBe("3");
    expect(costBasis(p.lots).toString()).toBe("1050");
    expect(s.cash.get("A1|USD")!.amount.toString()).toBe(String(-3410 - 1 - 1750 + 4200 - 1));
    expect(s.fees.map((f) => f.amount.toString())).toEqual(["1", "1"]);
  });

  it("split multiplies quantities and divides unit cost; total cost unchanged", () => {
    const split = ev("split", "2026-02-20", [["position", "A1", "I1", "USD", "3", "split", null, false]], { splitRatio: new D(2) });
    const s = runLedger([buy1, buy2, sell, split], noFx);
    const p = s.positions.get("A1|I1")!;
    expect(p.qty.toString()).toBe("6");
    expect(p.lots[0].unitCost.toString()).toBe("175");
    expect(costBasis(p.lots).toString()).toBe("1050");
  });

  it("dividend reinvestment: income and tax are reported, new shares cost the reinvested amount", () => {
    const drip = ev("dividend_reinvest", "2026-02-16", [["cash", "A1", "I1", "USD", "10", "income", null, false], ["cash", "A1", "I1", "USD", "-1.5", "tax", null, false], ["cash", "A1", null, "USD", "-8.5", "trade", null, false], ["position", "A1", "I1", "USD", "0.025", "trade", "8.5", false]]);
    const s = runLedger([buy1, drip], noFx);
    expect(s.income.map((i) => [i.gross.toString(), i.tax.toString(), i.instrumentId])).toEqual([["10", "1.5", "I1"]]);
    expect(s.positions.get("A1|I1")!.qty.toString()).toBe("10.025");
    expect(s.positions.get("A1|I1")!.lots[1].unitCost.toString()).toBe("340");
    expect(s.flows).toEqual([]); // income is return, never an external flow
  });

  it("transfer moves lots unchanged between own accounts, and is not a flow", () => {
    const t = ev("transfer", "2026-04-01", [["position", "A1", "I1", "USD", "-12", "transfer", null, false], ["position", "A2", "I1", "USD", "12", "transfer", null, false]]);
    const s = runLedger([buy1, buy2, t], noFx);
    // 15 held, 12 moved: the FIFO remainder of the second lot stays behind.
    expect(s.positions.get("A1|I1")!.lots.map((l) => [l.acquiredOn, l.qty.toString()])).toEqual([["2026-02-05", "3"]]);
    const p = s.positions.get("A2|I1")!;
    expect(p.lots.map((l) => [l.acquiredOn, l.qty.toString(), l.unitCost.toString()])).toEqual([
      ["2026-02-01", "10", "341.1"],
      ["2026-02-05", "2", "350"],
    ]);
    expect(s.flows).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("a transfer of more than held is reported", () => {
    const t = ev("transfer", "2026-04-01", [["position", "A1", "I1", "USD", "-99", "transfer", null, false], ["position", "A2", "I1", "USD", "99", "transfer", null, false]]);
    const s = runLedger([buy1, t], noFx);
    expect(s.errors.map((e) => e.error)).toEqual(["insufficient_quantity", "transfer_mismatch"]);
    expect(s.positions.get("A1|I1")!.qty.toString()).toBe("10");
  });

  it("selling more than held is reported, the position is untouched", () => {
    const tooMuch = ev("sell", "2026-02-10", [["position", "A1", "I1", "USD", "-11", "trade", null, false], ["cash", "A1", null, "USD", "100", "trade", null, false]]);
    const s = runLedger([buy1, tooMuch], noFx);
    expect(s.errors).toEqual([{ eventId: tooMuch.id, error: "insufficient_quantity" }]);
    expect(s.positions.get("A1|I1")!.qty.toString()).toBe("10");
    expect(s.realized).toEqual([]);
  });

  it("a fee in another currency is converted; without a rate the result is marked incomplete", () => {
    const hufFeeSell = ev("sell", "2026-02-10", [["position", "A1", "I1", "USD", "-10", "trade", null, false], ["cash", "A1", null, "USD", "3500", "trade", null, false], ["cash", "A1", null, "HUF", "-640", "fee", null, false]]);
    const fx: FxFn = (a, from, to) => (from === "HUF" && to === "USD" ? a.div(320) : null);
    const ok = runLedger([buy1, hufFeeSell], fx).realized[0];
    expect([ok.fees.toString(), ok.result.toString(), ok.incomplete]).toEqual(["2", "87", false]);
    const missing = runLedger([buy1, hufFeeSell], noFx).realized[0];
    expect(missing.incomplete).toBe(true);
  });

  it("deposits, withdrawals and missing-flow corrections are external flows; FX exchanges are not", () => {
    const dep = ev("deposit", "2026-01-05", [["cash", "A1", null, "HUF", "1000", "external", null, false]]);
    const wd = ev("withdrawal", "2026-01-06", [["cash", "A1", null, "HUF", "-500", "external", null, false]]);
    const miss = ev("correction", "2026-03-10", [["cash", "A1", null, "HUF", "200", "external", null, false]], { correctionKind: "missing_flow", note: "x" });
    const fxEx = ev("fx_exchange", "2026-02-21", [["cash", "A1", null, "HUF", "-640", "fx", null, false], ["cash", "A1", null, "USD", "2", "fx", null, false]]);
    const s = runLedger([dep, wd, miss, fxEx], noFx);
    expect(s.flows.map((f) => [f.kind, f.amount.toString()])).toEqual([["deposit", "1000"], ["withdrawal", "-500"], ["missing_flow", "200"]]);
    expect(s.cash.get("A1|HUF")!.amount.toString()).toBe("60");
    expect(s.cash.get("A1|USD")!.amount.toString()).toBe("2");
  });

  it("reconciliation corrections adjust holdings, are listed separately and are not flows", () => {
    const plus = ev("correction", "2026-03-11", [["position", "A1", "I1", "USD", "1", "correction", "340", true]], { correctionKind: "reconciliation", note: "x" });
    const minus = ev("correction", "2026-03-12", [["position", "A1", "I1", "USD", "-2", "correction", null, false]], { correctionKind: "reconciliation", note: "y" });
    const s = runLedger([buy1, plus, minus], noFx);
    expect(s.reconciliations).toHaveLength(2);
    expect(s.positions.get("A1|I1")!.qty.toString()).toBe("9");
    expect(s.flows).toEqual([]);
    expect(s.realized).toEqual([]); // not a sale
  });

  it("government security: interest in papers adds a lot at its amount; the maturity repays all of it like a sale", () => {
    const s = runLedger(
      [
        ev("buy", "2026-05-01", [["position", "A1", "B", "HUF", "1000", "trade", "990", false], ["cash", "A1", null, "HUF", "-990", "trade", null, false]]),
        ev("interest_reinvest", "2026-05-10", [["cash", "A1", "B", "HUF", "61", "income", null, false], ["cash", "A1", null, "HUF", "-61", "trade", null, false], ["position", "A1", "B", "HUF", "61", "trade", "61", false]]),
        ev("maturity", "2026-06-01", [["position", "A1", "B", "HUF", "-1061", "trade", null, false], ["cash", "A1", null, "HUF", "1061", "trade", null, false], ["cash", "A1", "B", "HUF", "30", "income", null, false]]),
      ],
      () => null,
    );
    expect(s.positions.size).toBe(0);
    expect(s.realized).toHaveLength(1);
    expect(s.realized[0].result.toFixed()).toBe("10"); // 1061 repaid − (990 + 61)
    expect(s.income.map((i) => i.gross.toFixed())).toEqual(["61", "30"]);
    expect(s.cash.get("A1|HUF")?.amount.toFixed()).toBe("101"); // −990 + 61 − 61 + 1061 + 30
    expect(s.flows).toEqual([]);
  });

  it("interest is income; fee events are fees", () => {
    const interest = ev("interest", "2026-01-31", [["cash", "A1", null, "HUF", "3", "income", null, false]]);
    const fee = ev("fee", "2026-01-31", [["cash", "A1", null, "HUF", "-5", "fee", null, false]]);
    const s = runLedger([interest, fee], noFx);
    expect(s.income.map((i) => [i.gross.toString(), i.tax.toString(), i.instrumentId])).toEqual([["3", "0", null]]);
    expect(s.fees.map((f) => f.amount.toString())).toEqual(["5"]);
  });

  it("opening balances create estimated lots and cash", () => {
    const open = ev("opening_balance", "2026-03-01", [["position", "A2", "I2", "HUF", "5", "opening", "100000", true], ["cash", "A2", null, "HUF", "1000", "opening", null, false]]);
    const s = runLedger([open], noFx);
    expect(s.positions.get("A2|I2")!.lots[0]).toMatchObject({ costEstimated: true, acquiredOn: "2026-03-01" });
    expect(s.cash.get("A2|HUF")!.amount.toString()).toBe("1000");
    expect(s.flows).toEqual([]); // the starting value, never an inflow (plan §2)
  });

  it("stops at upTo and orders same-day events by creation time", () => {
    const early = ev("buy", "2026-02-05", [["position", "A1", "I1", "USD", "1", "trade", "1", false], ["cash", "A1", null, "USD", "-1", "trade", null, false]], { createdAt: "2026-02-05T08:00:00Z" });
    const lateSell = ev("sell", "2026-02-05", [["position", "A1", "I1", "USD", "-1", "trade", null, false], ["cash", "A1", null, "USD", "2", "trade", null, false]], { createdAt: "2026-02-05T09:00:00Z" });
    expect(runLedger([lateSell, early], noFx).errors).toEqual([]);
    expect(runLedger([buy1, buy2, sell], noFx, "2026-02-05").realized).toEqual([]);
  });
});
