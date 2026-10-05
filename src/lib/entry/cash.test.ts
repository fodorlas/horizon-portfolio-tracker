import { describe, expect, it } from "vitest";
import type { LedgerEvent, Line } from "@/lib/finance/ledger";
import { D } from "@/lib/finance/money";
import { availableFrom, cashBreaks, cashKey, cashTimeline } from "./cash";

let n = 0;
const cashLine = (amount: string, currency = "HUF", accountId = "A"): Line => ({
  id: `l${++n}`, kind: "cash", accountId, instrumentId: null, currency, amount: new D(amount), role: "external", costAmount: null, costEstimated: false, costFxRefs: null,
});
const posLine = (amount: string): Line => ({
  id: `l${++n}`, kind: "position", accountId: "A", instrumentId: "ST", currency: "HUF", amount: new D(amount), role: "trade", costAmount: new D(amount), costEstimated: false, costFxRefs: null,
});
const ev = (id: string, date: string, lines: Line[], createdAt = `${date}T10:00:00Z`): LedgerEvent => ({
  id, type: "deposit", date, createdAt, correctionKind: null, splitRatio: null, note: null, lines,
});

describe("cashTimeline: end-of-day cash per account and currency", () => {
  it("adds up the cash lines day by day, one step a day, accounts and currencies apart", () => {
    const t = cashTimeline([
      ev("b", "2026-03-01", [cashLine("-600"), posLine("6")]),
      ev("a", "2026-02-01", [cashLine("1000")]),
      ev("c", "2026-03-01", [cashLine("50")], "2026-03-01T11:00:00Z"),
      ev("d", "2026-03-05", [cashLine("20", "EUR")]),
      ev("e", "2026-03-05", [cashLine("7", "HUF", "B")]),
    ]);
    expect(t.get(cashKey("A", "HUF"))).toEqual([{ day: "2026-02-01", balance: "1000" }, { day: "2026-03-01", balance: "450" }]);
    expect(t.get(cashKey("A", "EUR"))).toEqual([{ day: "2026-03-05", balance: "20" }]);
    expect(t.get(cashKey("B", "HUF"))).toEqual([{ day: "2026-03-05", balance: "7" }]);
  });
});

describe("availableFrom: what a buy on a day may take", () => {
  const steps = [{ day: "2026-02-01", balance: "1000" }, { day: "2026-03-01", balance: "400" }, { day: "2026-04-01", balance: "900" }];

  it("the smallest end-of-day balance from the buy day on: later spending limits an earlier buy", () => {
    expect(availableFrom(steps, "2026-02-15").toString()).toBe("400");
    expect(availableFrom(steps, "2026-03-01").toString()).toBe("400");
    expect(availableFrom(steps, "2026-04-02").toString()).toBe("900");
  });

  it("nothing before the first cash, nothing without cash", () => {
    expect(availableFrom(steps, "2026-01-15").toString()).toBe("0");
    expect(availableFrom(undefined, "2026-02-15").toString()).toBe("0");
    expect(availableFrom([], "2026-02-15").toString()).toBe("0");
  });

  it("never below zero, even when the history dips under it", () => {
    expect(availableFrom([{ day: "2026-02-01", balance: "100" }, { day: "2026-02-10", balance: "-50" }], "2026-02-01").toString()).toBe("0");
  });
});

describe("cashBreaks: a change may not take away cash a later day relied on", () => {
  // A sale kept 600 on 03-01, a buy took all of it on 04-01.
  const sale = ev("s", "2026-03-01", [cashLine("600")]);
  const buy = ev("b", "2026-04-01", [cashLine("-600")]);

  it("deleting or shrinking the sale that paid for a later buy breaks it", () => {
    expect(cashBreaks([sale, buy], [buy])).toBe(true);
    expect(cashBreaks([sale, buy], [ev("s", "2026-03-01", [cashLine("400")]), buy])).toBe(true);
    // Moved after the buy: the buy's day would go below zero.
    expect(cashBreaks([sale, buy], [ev("s", "2026-04-02", [cashLine("600")]), buy])).toBe(true);
  });

  it("changes that leave every day at zero or above are fine, and so is deleting the buy", () => {
    expect(cashBreaks([sale, buy], [sale])).toBe(false);
    expect(cashBreaks([sale, buy], [ev("s", "2026-03-01", [cashLine("700")]), buy])).toBe(false);
    expect(cashBreaks([sale, buy], [sale, buy, ev("x", "2026-05-01", [cashLine("5", "EUR")])])).toBe(false);
  });

  it("sending back an interest payment whose money a later buy used breaks it; the payer's cash line counts (#35)", () => {
    // A FixMÁP paid 8700 on 06-19 (the cash line names the bond as its payer); a buy took 8000 of it on 07-01.
    const interest = { ...ev("i", "2026-06-19", [{ ...cashLine("8700"), role: "income" as const, instrumentId: "B" }]), type: "interest" as const };
    const later = ev("b2", "2026-07-01", [cashLine("-8000")]);
    expect(cashBreaks([interest, later], [later])).toBe(true);
    expect(cashBreaks([interest], [])).toBe(false);
  });

  it("a history already below zero is not the change's fault, but a day it newly pushes under is", () => {
    const old = [ev("w", "2026-02-01", [cashLine("-50")]), ev("d", "2026-02-10", [cashLine("100")])];
    expect(cashBreaks(old, [...old, ev("n", "2026-02-01", [cashLine("0.5")])])).toBe(false);
    expect(cashBreaks(old, [old[0]])).toBe(true);
  });
});
