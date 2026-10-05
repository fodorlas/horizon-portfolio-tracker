import { describe, expect, it } from "vitest";
import type { FxRow } from "./fx";
import type { LedgerEvent, Line } from "./ledger";
import { D } from "./money";
import type { ManualValuation, PriceQuote } from "./prices";
import { periodFigures, valueAt, type PortfolioData } from "./valuation";

let n = 0;
const L = (p: Omit<Partial<Line>, "amount"> & Pick<Line, "kind" | "accountId" | "currency" | "role"> & { amount: string }): Line => ({
  id: `l${++n}`, instrumentId: null, costAmount: null, costEstimated: false, costFxRefs: null, ...p, amount: new D(p.amount),
});
const E = (type: LedgerEvent["type"], date: string, lines: Line[]): LedgerEvent => ({
  id: `e${++n}`, type, date, createdAt: `${date}T10:00:00Z`, correctionKind: null, splitRatio: null, note: null, lines,
});
const fx = (id: string, base: string, rate: string, day: string): FxRow => ({
  id, base, quote: "HUF", rate, rateDate: day, source: "MNB", status: "ok", supersedesId: null, fetchedAt: `${day}T11:00:00Z`,
});
const quote = (id: string, price: string, day: string): PriceQuote => ({
  id, instrumentId: "AAPL", price, currency: "USD", asOf: `${day}T20:00:00Z`, enteredAt: `${day}T21:00:00Z`, source: "yahoo", status: "ok", supersedesId: null,
});
const hold = (id: string, value: string, day: string): ManualValuation => ({
  id, accountId: "A2", instrumentId: "HOLD", value, currency: "HUF", asOf: `${day}T10:00:00Z`, enteredAt: `${day}T10:00:00Z`, source: "manual", status: "ok", supersedesId: null,
});

const data: PortfolioData = {
  accounts: [{ id: "A1", trackingStart: "2026-01-01" }, { id: "A2", trackingStart: "2026-03-01" }],
  instruments: [
    { id: "AAPL", name: "Apple", assetClass: "stock", currency: "USD", valuation: "market", priceSource: "yahoo", staleAfterDays: null },
    { id: "HOLD", name: "Hold portfólió", assetClass: "managed", currency: "HUF", valuation: "manual", priceSource: "manual", staleAfterDays: null },
  ],
  events: [
    E("deposit", "2026-01-05", [L({ kind: "cash", accountId: "A1", currency: "USD", amount: "10000", role: "external" })]),
    E("buy", "2026-01-10", [
      L({ kind: "position", accountId: "A1", instrumentId: "AAPL", currency: "USD", amount: "10", role: "trade", costAmount: new D(2000) }),
      L({ kind: "cash", accountId: "A1", currency: "USD", amount: "-2000", role: "trade" }),
    ]),
    E("opening_balance", "2026-03-01", [
      L({ kind: "position", accountId: "A2", instrumentId: "HOLD", currency: "HUF", amount: "1", role: "opening", costAmount: new D(5_000_000), costEstimated: true }),
    ]),
  ],
  quotes: [quote("q1", "210", "2026-02-27"), quote("q2", "220", "2026-03-31")],
  valuations: [hold("v1", "5000000", "2026-03-01"), hold("v2", "5100000", "2026-03-31")],
  fxRows: [fx("f0", "USD", "340", "2026-01-05"), fx("f1", "USD", "350", "2026-02-27"), fx("f2", "USD", "360", "2026-03-31")],
};

describe("valueAt", () => {
  it("values positions and cash at the end of a day; later accounts are not yet tracked", () => {
    const v = valueAt(data, "2026-02-28", "HUF"); // Saturday: Friday's price and rate
    expect(v.total.toString()).toBe(String(10 * 210 * 350 + 8000 * 350));
    expect(v.items.map((i) => i.accountId)).not.toContain("A2");
    expect(v.complete).toBe(true);
  });

  it("breaks the total down by asset class, account and currency", () => {
    const v = valueAt(data, "2026-03-31", "HUF");
    expect(v.total.toString()).toBe("8772000");
    expect(Object.fromEntries([...v.byAssetClass].map(([k, x]) => [k, x.toString()]))).toEqual({ stock: "792000", cash: "2880000", managed: "5100000" });
    expect(Object.fromEntries([...v.byAccount].map(([k, x]) => [k, x.toString()]))).toEqual({ A1: "3672000", A2: "5100000" });
    expect(Object.fromEntries([...v.byCurrency].map(([k, x]) => [k, x.toString()]))).toEqual({ USD: "3672000", HUF: "5100000" });
  });

  it("never guesses: a missing FX rate leaves the item out and marks the valuation incomplete", () => {
    const v = valueAt(data, "2026-03-31", "EUR");
    expect(v.complete).toBe(false);
    expect(v.total.toString()).toBe("0");
    expect(v.items.every((i) => i.missing === "fx")).toBe(true);
  });

  it("a missing price is reported as such", () => {
    const v = valueAt({ ...data, quotes: [] }, "2026-03-31", "HUF");
    const aapl = v.items.find((i) => i.instrumentId === "AAPL")!;
    expect([aapl.missing, aapl.native]).toEqual(["price", null]);
    expect(v.complete).toBe(false);
  });

  it("reports the share of the total that rests on stale values", () => {
    const v = valueAt(data, "2026-04-10", "HUF", "2026-04-10");
    const aapl = v.items.find((i) => i.instrumentId === "AAPL")!;
    const holdItem = v.items.find((i) => i.instrumentId === "HOLD")!;
    expect([aapl.stale, holdItem.stale]).toEqual([true, false]); // 8 business days vs 10 calendar days
    expect(v.staleShare.toDecimalPlaces(6).toString()).toBe(new D(792000).div(8772000).toDecimalPlaces(6).toString());
  });
});

describe("periodFigures", () => {
  it("a later account enters as a 'tracking_in' flow, so its opening value is not a gain", () => {
    const p = periodFigures(data, "2026-03-01", "2026-03-31", "HUF")!;
    expect(p.flows.map((f) => [f.kind, f.day, f.amount.toString()])).toEqual([["tracking_in", "2026-03-01", "5000000"]]);
    expect(p.valueChange.toString()).toBe(String(8772000 - 3535000));
    // Apple +57 000, USD cash revalued +80 000, Hold +100 000.
    expect(p.result.toString()).toBe("237000");
    expect(p.denominator.toString()).toBe(new D(3535000).plus(new D(5000000).times(30).div(31)).toString());
    expect(p.complete).toBe(true);
  });

  it("starts the day after tracking began, and converts deposits on their own day", () => {
    const p = periodFigures(data, "2025-12-01", "2026-01-31", "HUF")!;
    expect([p.start, p.truncated]).toEqual(["2026-01-02", true]);
    expect(p.flows.map((f) => [f.kind, f.amount.toString()])).toEqual([["deposit", "3400000"]]);
  });

  it("nothing to compute before tracking starts or without accounts", () => {
    expect(periodFigures(data, "2025-01-01", "2026-01-01", "HUF")).toBeNull();
    expect(periodFigures({ ...data, accounts: [] }, "2026-01-01", "2026-02-01", "HUF")).toBeNull();
  });

  it("an unconvertible flow makes the figures incomplete", () => {
    const p = periodFigures({ ...data, fxRows: data.fxRows.filter((r) => r.id !== "f0") }, "2026-01-02", "2026-01-31", "HUF")!;
    expect(p.complete).toBe(false);
  });
});
