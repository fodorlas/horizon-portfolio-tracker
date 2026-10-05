import { describe, expect, it } from "vitest";
import type { Loaded } from "@/lib/data/load";
import type { LedgerEvent, Line } from "@/lib/finance/ledger";
import { D } from "@/lib/finance/money";
import { entryContext } from "./context";

let n = 0;
const line = (p: Partial<Line> & Pick<Line, "kind" | "role">, amount: string): Line => ({
  id: `l${++n}`, accountId: "A", instrumentId: null, currency: "HUF", costAmount: null, costEstimated: false, costFxRefs: null, ...p, amount: new D(amount),
});
const ev = (id: string, type: LedgerEvent["type"], date: string, lines: Line[]): LedgerEvent => ({
  id, type, date, createdAt: `${date}T10:00:00Z`, correctionKind: null, splitRatio: null, note: null, lines,
});
const val = (id: string, value: string, day: string, entry: string | null) => ({
  id, owner_id: "o", account_id: "A", instrument_id: "HOLD", value, currency: "HUF", as_of: `${day}T21:59:59Z`, entered_at: `${day}T21:59:59Z`,
  source: "manual", status: "ok", supersedes_id: null, note: null, entry_id: entry,
});

const data = {
  institutions: [{ id: "BR", name: "Bróker", owner_id: "o", created_at: "" }],
  accountMeta: [{ id: "A", institution_id: "BR", name: "Számla", account_type: "normal", tracking_start_date: "2026-01-01", owner_id: "o", created_at: "" }],
  accounts: [{ id: "A", trackingStart: "2026-01-01" }],
  instrumentMeta: [
    { id: "ST", name: "Példa", currency: "EUR", valuation: "market", price_source: "yahoo", provider_symbol: "PLDA.DE" },
    { id: "HOLD", name: "Hold", currency: "HUF", valuation: "manual", price_source: "manual", provider_symbol: null },
  ],
  instruments: [],
  events: [
    ev("o1", "opening_balance", "2026-01-01", [line({ kind: "position", role: "opening", instrumentId: "HOLD", costAmount: new D(1000), costEstimated: true }, "1000")]),
    ev("d1", "deposit", "2026-02-01", [line({ kind: "cash", role: "external" }, "500")]),
    ev("b1", "buy", "2026-02-01", [line({ kind: "position", role: "trade", instrumentId: "HOLD", costAmount: new D(500) }, "500"), line({ kind: "cash", role: "trade" }, "-500")]),
  ],
  quotes: [],
  valuations: [],
  fxRows: [],
  logs: { quotes: [], fx: [], valuations: [val("v0", "1000", "2026-01-01", "E0"), val("v1", "1600", "2026-02-01", "E1")] },
  eventEntries: new Map([["o1", "E0"], ["d1", "E1"], ["b1", "E1"]]),
} as unknown as Loaded;

describe("entryContext: the database facts for the builder", () => {
  it("holdings and values as they are, and which accounts have an opening balance", () => {
    const c = entryContext(data, { today: "2026-09-26", symbols: new Map(), newId: () => "x", locale: "hu" as const });
    expect(c.holding("A", "HOLD", "2026-02-01").toString()).toBe("1500");
    expect(c.valueOn("A", "HOLD", "2026-02-01")?.toString()).toBe("1600");
    expect(c.accounts.get("A")).toEqual({ institutionId: "BR", trackingStart: "2026-01-01", hasOpening: true });
    expect(c.instruments.get("ST")).toEqual({ name: "Példa", currency: "EUR", valuation: "market", priceSource: "yahoo", symbol: "PLDA.DE" });
    expect(c.entryId).toBeUndefined();
  });

  it("an edited entry is left out of its own context", () => {
    const buy = entryContext(data, { today: "2026-09-26", symbols: new Map(), newId: () => "x", locale: "hu" as const, entryId: "E1" });
    expect(buy.holding("A", "HOLD", "2026-02-01").toString()).toBe("1000");
    expect(buy.valueOn("A", "HOLD", "2026-02-01")?.toString()).toBe("1000");
    expect(buy.entryId).toBe("E1");
    const opening = entryContext(data, { today: "2026-09-26", symbols: new Map(), newId: () => "x", locale: "hu" as const, entryId: "E0" });
    expect(opening.accounts.get("A")?.hasOpening).toBe(false);
  });

  it("the day a maturity was booked on a holding, the edited entry left out (#34)", () => {
    const matured = {
      ...data,
      events: [
        ...data.events,
        ev("m1", "maturity", "2026-03-01", [line({ kind: "position", role: "trade", instrumentId: "HOLD" }, "-1500"), line({ kind: "cash", role: "trade" }, "1500")]),
      ],
      eventEntries: new Map([...data.eventEntries, ["m1", "EM"]]),
    } as unknown as Loaded;
    const opts = { today: "2026-09-26", symbols: new Map(), newId: () => "x", locale: "hu" as const };
    expect(entryContext(matured, opts).maturityBooked("A", "HOLD")).toBe("2026-03-01");
    expect(entryContext(matured, opts).maturityBooked("A", "ST")).toBeNull();
    expect(entryContext(data, opts).maturityBooked("A", "HOLD")).toBeNull();
    expect(entryContext(matured, { ...opts, entryId: "EM" }).maturityBooked("A", "HOLD")).toBeNull();
  });

  it("the cash a buy may use: the account's money in that currency, the edited entry left out", () => {
    const sold = {
      ...data,
      events: [
        ...data.events,
        ev("s1", "sell", "2026-03-01", [line({ kind: "position", role: "trade", instrumentId: "HOLD" }, "-100"), line({ kind: "cash", role: "trade" }, "700")]),
      ],
      eventEntries: new Map([...data.eventEntries, ["s1", "E2"]]),
    } as unknown as Loaded;
    const c = entryContext(sold, { today: "2026-09-26", symbols: new Map(), newId: () => "x", locale: "hu" as const });
    expect(c.availableCash("A", "HUF", "2026-03-01").toString()).toBe("700");
    // On 2026-02-15 the account held no cash: the sale came later.
    expect(c.availableCash("A", "HUF", "2026-02-15").toString()).toBe("0");
    expect(c.availableCash("A", "EUR", "2026-03-01").toString()).toBe("0");
    const edited = entryContext(sold, { today: "2026-09-26", symbols: new Map(), newId: () => "x", locale: "hu" as const, entryId: "E2" });
    expect(edited.availableCash("A", "HUF", "2026-03-01").toString()).toBe("0");
  });
});
