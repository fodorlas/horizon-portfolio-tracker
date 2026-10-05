import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LedgerEvent, Line } from "@/lib/finance/ledger";
import { D } from "@/lib/finance/money";
import { i18nFor } from "@/lib/i18n";
import { EventLines, eventInstrumentNames } from "./event-lines";

const i18n = i18nFor("hu");

const line = (p: Partial<Line> & Pick<Line, "kind" | "role">, amount: string): Line => ({
  id: `l-${amount}-${p.role}`, accountId: "A", instrumentId: null, currency: "HUF", costAmount: null, costEstimated: false, costFxRefs: null, ...p, amount: new D(amount),
});
const ev = (lines: Line[]): LedgerEvent => ({ id: "e", type: "opening_balance", date: "2026-01-01", createdAt: "", correctionKind: null, splitRatio: null, note: null, lines });

describe("EventLines", () => {
  it("market items in units, manual-valued items by amount only: their units are internal", () => {
    render(
      <EventLines
        event={ev([
          line({ kind: "position", role: "opening", instrumentId: "ST", currency: "EUR", costAmount: new D(1350) }, "12"),
          line({ kind: "position", role: "opening", instrumentId: "HOLD", costAmount: new D(5_000_000) }, "5000000"),
          line({ kind: "position", role: "trade", instrumentId: "HOLD" }, "-250"),
        ])}
        manual={new Set(["HOLD"])}
        i18n={i18n}
      />,
    );
    const items = screen.getAllByRole("listitem").map((li) => li.textContent?.replace(/\s/g, " "));
    expect(items).toEqual(["+12 db", "+5 000 000 Ft"]);
  });
});

describe("eventInstrumentNames", () => {
  const names = new Map([["ST", "Példa"], ["B", "Béta"]]);

  it("names the instruments a transaction touches", () => {
    const e = ev([line({ kind: "position", role: "opening", instrumentId: "ST" }, "1"), line({ kind: "position", role: "opening", instrumentId: "B" }, "2")]);
    expect(eventInstrumentNames(e, names, i18n)).toBe("Példa, Béta");
  });

  it("money only – a deposit, a withdrawal, a fee, an exchange – is Készpénz, not a blank", () => {
    const deposit = { ...ev([line({ kind: "cash", role: "external" }, "1000")]), type: "deposit" as const };
    expect(eventInstrumentNames(deposit, names, i18n)).toBe("Készpénz");
  });
});
