import { describe, expect, it } from "vitest";
import type { Loaded } from "@/lib/data/load";
import type { LedgerEvent, Line } from "@/lib/finance/ledger";
import { D } from "@/lib/finance/money";
import { entryFormData } from "./entry-form";

const line = (p: Partial<Line> & Pick<Line, "kind" | "role" | "accountId">, amount: string): Line => ({
  id: `l-${amount}-${p.instrumentId}`, instrumentId: null, currency: "HUF", costAmount: null, costEstimated: false, costFxRefs: null, ...p, amount: new D(amount),
});
const ev = (id: string, date: string, lines: Line[]): LedgerEvent => ({ id, type: "opening_balance", date, createdAt: `${date}T10:00:00Z`, correctionKind: null, splitRatio: null, note: null, lines });

const data = {
  institutions: [{ id: "BR", name: "Bróker" }],
  accountMeta: [{ id: "A", institution_id: "BR", name: "Számla", tracking_start_date: "2026-01-01" }],
  accounts: [{ id: "A", trackingStart: "2026-01-01" }],
  instrumentMeta: [
    { id: "ST", name: "Példa", ticker: "PLDA", currency: "EUR", valuation: "market", provider_symbol: "PLDA.DE", price_source: "yahoo" },
    { id: "HOLD", name: "Hold", ticker: null, currency: "HUF", valuation: "manual", provider_symbol: null, price_source: "manual" },
    { id: "OLD", name: "Régi", ticker: null, currency: "CHF", valuation: "market", provider_symbol: "OLD", price_source: "manual" },
    { id: "CET", name: "CETOP", ticker: "ETFCETOPOTP", currency: "EUR", valuation: "market", provider_symbol: "ETFCETOPOTP", price_source: "bet" },
  ],
  events: [
    ev("e1", "2026-01-01", [
      line({ kind: "position", role: "opening", accountId: "A", instrumentId: "ST", currency: "EUR", costAmount: new D(1) }, "10"),
      line({ kind: "position", role: "opening", accountId: "A", instrumentId: "HOLD", costAmount: new D(1) }, "1000"),
      line({ kind: "cash", role: "opening", accountId: "A", currency: "SEK" }, "5"),
    ]),
  ],
  valuations: [{ id: "v", accountId: "A", instrumentId: "HOLD", value: "1200", currency: "HUF", asOf: "2026-01-01T21:59:59Z", enteredAt: "", source: "manual", status: "ok", supersedesId: null }],
  fxRows: [],
} as unknown as Loaded;

describe("entryFormData: what the simple form offers", () => {
  it("brokers, accounts, instruments with their Yahoo symbol only when Yahoo prices them, and today's holdings", () => {
    const f = entryFormData(data, "2026-09-26");
    expect(f.institutions).toEqual([{ id: "BR", name: "Bróker" }]);
    expect(f.accounts).toEqual([{ id: "A", institutionId: "BR", name: "Számla", trackingStart: "2026-01-01" }]);
    expect(f.instruments.map((i) => [i.id, i.name, i.label, i.symbol])).toEqual([
      ["ST", "Példa", "Példa (PLDA)", "PLDA.DE"], ["HOLD", "Hold", "Hold", null], ["OLD", "Régi", "Régi", null], ["CET", "CETOP", "CETOP (ETFCETOPOTP)", "ETFCETOPOTP"],
    ]);
    expect(f.instruments.find((i) => i.id === "CET")?.source).toBe("bet");
    expect(f.holdings).toEqual([
      { accountId: "A", instrumentId: "ST", quantity: "10", value: null },
      { accountId: "A", instrumentId: "HOLD", quantity: "1000", value: "1200" },
    ]);
    // Common currencies first, then anything already in use.
    expect(f.currencies.slice(0, 3)).toEqual(["HUF", "EUR", "USD"]);
    expect(f.currencies).toContain("SEK");
    expect(f).not.toHaveProperty("yesterday");
  });

  it("the cash on each account by currency, day by day; an edited entry's own cash left out", () => {
    expect(entryFormData(data, "2026-09-26").cash).toEqual([{ accountId: "A", currency: "SEK", steps: [{ day: "2026-01-01", balance: "5" }] }]);
    const edited = { ...data, eventEntries: new Map([["e1", "E1"]]) } as unknown as Loaded;
    expect(entryFormData(edited, "2026-09-26", "E1").cash).toEqual([]);
  });
});
