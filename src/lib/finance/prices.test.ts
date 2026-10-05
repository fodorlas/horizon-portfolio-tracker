import { describe, expect, it } from "vitest";
import cases from "../../../tests/fixtures/price-selection-cases.json";
import { D } from "./money";
import { classifyQuote, dayOf, selectPrice, selectValuation, staleness, type ManualValuation, type PriceQuote } from "./prices";

const quotes: PriceQuote[] = cases.rows.map((r) => ({
  id: r.key,
  instrumentId: r.instrument,
  price: r.price,
  currency: r.currency,
  asOf: r.asOf,
  enteredAt: r.enteredAt,
  source: r.source,
  status: r.status as PriceQuote["status"],
  supersedesId: (r as { supersedes?: string }).supersedes ?? null,
}));

describe("selectPrice – shared cases (same file drives the SQL test)", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const priceSource = cases.instruments[c.instrument as keyof typeof cases.instruments].priceSource;
      expect(selectPrice(quotes, { id: c.instrument, priceSource }, c.day)?.id ?? null).toBe(c.expect);
    });
  }
});

describe("selectValuation", () => {
  const v = (id: string, account: string, asOf: string, value: string, extra: Partial<ManualValuation> = {}): ManualValuation => ({
    id, accountId: account, instrumentId: "H", value, currency: "HUF", asOf, enteredAt: asOf, source: "manual", status: "ok", supersedesId: null, ...extra,
  });
  const vals = [
    v("v1", "acc1", "2026-08-31T12:00:00Z", "5000000"),
    v("v2", "acc1", "2026-09-30T12:00:00Z", "5100000"),
    v("v3", "acc2", "2026-09-15T12:00:00Z", "999"),
    v("v4", "acc1", "2026-08-31T12:00:00Z", "5010000", { enteredAt: "2026-09-02T00:00:00Z", supersedesId: "v1" }),
  ];
  it("is per account and instrument, and honours corrections", () => {
    expect(selectValuation(vals, "acc1", "H", "2026-09-20")?.id).toBe("v4");
    expect(selectValuation(vals, "acc1", "H", "2026-09-30")?.id).toBe("v2");
    expect(selectValuation(vals, "acc2", "H", "2026-09-20")?.id).toBe("v3");
    expect(selectValuation(vals, "acc1", "H", "2026-08-01")).toBeNull();
  });
});

describe("tie-breaks at the same market moment", () => {
  const base = { instrumentId: "Z", price: "1", currency: "USD", asOf: "2026-09-25T20:00:00Z", status: "ok" as const, supersedesId: null };
  it("two automatic quotes: the later entry wins", () => {
    const a = { ...base, id: "a", source: "yahoo", enteredAt: "2026-09-25T21:00:00Z" };
    const b = { ...base, id: "b", source: "finnhub", enteredAt: "2026-09-25T21:05:00Z" };
    expect(selectPrice([a, b], { id: "Z", priceSource: "manual" }, "2026-09-26")?.id).toBe("b");
    expect(selectPrice([b, a], { id: "Z", priceSource: "manual" }, "2026-09-26")?.id).toBe("b");
  });
  it("an automatic quote never beats a manual one at the same moment", () => {
    const m = { ...base, id: "m", source: "manual", enteredAt: "2026-09-25T20:30:00Z" };
    const y = { ...base, id: "y", source: "yahoo", enteredAt: "2026-09-25T23:00:00Z" };
    expect(selectPrice([m, y], { id: "Z", priceSource: "yahoo" }, "2026-09-26")?.id).toBe("m");
  });
});

describe("classifyQuote", () => {
  it("flags zero, negative, wrong currency and > 50 % jumps", () => {
    expect(classifyQuote({ price: "0", currency: "USD" }, "USD", null)).toBe("suspect");
    expect(classifyQuote({ price: "-1", currency: "USD" }, "USD", null)).toBe("suspect");
    expect(classifyQuote({ price: "10", currency: "EUR" }, "USD", null)).toBe("suspect");
    expect(classifyQuote({ price: "151", currency: "USD" }, "USD", "100")).toBe("suspect");
    expect(classifyQuote({ price: "49", currency: "USD" }, "USD", "100")).toBe("suspect");
  });
  it("accepts normal moves, and the first quote without history", () => {
    expect(classifyQuote({ price: "150", currency: "USD" }, "USD", "100")).toBe("ok"); // exactly +50 %
    expect(classifyQuote({ price: "50", currency: "USD" }, "USD", "100")).toBe("ok"); // exactly −50 %
    expect(classifyQuote({ price: new D("341.07"), currency: "USD" }, "USD", null)).toBe("ok");
  });
});

describe("staleness", () => {
  it("market prices: more than 3 business days", () => {
    expect(staleness("2026-09-25", "2026-09-30", "market")).toEqual({ ageDays: 5, stale: false }); // Fri → Wed: 3 bd
    expect(staleness("2026-09-25", "2026-10-01", "market")).toEqual({ ageDays: 6, stale: true });
  });
  it("manual values: more than 35 days; per-instrument override", () => {
    expect(staleness("2026-08-31", "2026-10-05", "manual").stale).toBe(false);
    expect(staleness("2026-08-31", "2026-10-06", "manual").stale).toBe(true);
    expect(staleness("2026-09-01", "2026-09-20", "manual", 10).stale).toBe(true);
  });
  it("future dates count as age 0", () => {
    expect(staleness("2026-10-01", "2026-09-30", "manual").ageDays).toBe(0);
  });
});

describe("dayOf", () => {
  it("uses the Budapest calendar", () => {
    expect(dayOf("2026-09-25T22:30:00Z")).toBe("2026-09-26");
    expect(dayOf("2026-12-31T22:30:00Z")).toBe("2026-12-31"); // UTC+1 in winter
  });
});
