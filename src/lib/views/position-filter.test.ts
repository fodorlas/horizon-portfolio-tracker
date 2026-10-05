import { describe, expect, it } from "vitest";
import { D } from "@/lib/finance/money";
import { filterPositions, isFiltered, parsePositionFilter } from "./position-filter";
import type { CashRow, PositionRow, PositionsModel } from "./portfolio";

const row = (accountId: string, instrumentId: string, currency: string, display: string | null): PositionRow => ({
  accountId, instrumentId, quantity: new D(1), currency, valuation: "market", price: new D(1), valueSource: "yahoo", valueAsOf: "2026-09-30",
  ageDays: 0, stale: false, native: new D(1), display: display === null ? null : new D(display), cost: new D(1), costEstimated: false,
  unrealized: new D(0), unrealizedRate: null, realized: new D(0), realizedIncomplete: false, incomeNet: new D(0),
});
const cash = (accountId: string, currency: string, display: string): CashRow => ({ accountId, currency, amount: new D(1), display: new D(display) });

const model: PositionsModel = {
  today: "2026-09-30", currency: "HUF",
  positions: [row("A", "NDX", "EUR", "3000"), row("A", "PLDA", "USD", "2000"), row("B", "HOLD", "HUF", "1000"), row("B", "BOND", "HUF", null)],
  cash: [cash("A", "EUR", "500"), cash("B", "HUF", "100")],
  total: new D(6600), complete: false,
};
const instruments = new Map([
  ["NDX", { assetClass: "etf", name: "Példa Nasdaq 100 ETF (PNDX)" }],
  ["PLDA", { assetClass: "stock", name: "Példa Részvény (PLDA)" }],
  ["HOLD", { assetClass: "managed", name: "Online vagyonkezelés" }],
  ["BOND", { assetClass: "bond", name: "Magyar Állampapír Plusz 2031/M5" }],
]);
const run = (sp: Record<string, string>) => filterPositions(model, parsePositionFilter(sp), (id) => instruments.get(id));
const ids = (r: ReturnType<typeof run>) => r.positions.map((p) => p.instrumentId);

describe("the Positions filter (the owner's request, 2026-09-30)", () => {
  it("no filter: everything, as before", () => {
    const r = run({});
    expect(ids(r)).toEqual(["NDX", "PLDA", "HOLD", "BOND"]);
    expect(r.cash).toHaveLength(2);
    expect(isFiltered(parsePositionFilter({}))).toBe(false);
  });

  it("one account: its positions and its cash, and their total", () => {
    const r = run({ account: "A" });
    expect(ids(r)).toEqual(["NDX", "PLDA"]);
    expect(r.cash.map((c) => c.accountId)).toEqual(["A"]);
    expect(r.total.toFixed()).toBe("5500");
    expect(r.complete).toBe(true);
  });

  it("a kind of asset: its positions only, no cash; Készpénz: the cash only", () => {
    const etf = run({ type: "etf" });
    expect(ids(etf)).toEqual(["NDX"]);
    expect(etf.cash).toEqual([]);
    const money = run({ type: "cash" });
    expect(ids(money)).toEqual([]);
    expect(money.cash).toHaveLength(2);
  });

  it("a currency: the positions priced in it and the cash held in it", () => {
    const r = run({ currency: "HUF" });
    expect(ids(r)).toEqual(["HOLD", "BOND"]);
    expect(r.cash.map((c) => c.currency)).toEqual(["HUF"]);
  });

  it("a name or code: any part, without case or accents; cash has no name, so it is left out", () => {
    expect(ids(run({ q: "nasdaq" }))).toEqual(["NDX"]);
    expect(ids(run({ q: "plda" }))).toEqual(["PLDA"]);
    expect(ids(run({ q: "allampapir" }))).toEqual(["BOND"]);
    expect(run({ q: "nasdaq" }).cash).toEqual([]);
  });

  it("filters combine; a missing value keeps the total incomplete", () => {
    const r = run({ account: "B", currency: "HUF", type: "bond" });
    expect(ids(r)).toEqual(["BOND"]);
    expect(r.complete).toBe(false);
    expect(r.total.toFixed()).toBe("0");
  });

  it("unknown values are no filter; the search is trimmed and kept short", () => {
    const f = parsePositionFilter({ type: "crypto", currency: "eur", q: `  ${"x".repeat(100)}  ` });
    expect(f.type).toBe("");
    expect(f.currency).toBe("");
    expect(f.q).toHaveLength(64);
    expect(parsePositionFilter({ account: ["A", "B"] }).account).toBe("");
  });
});
