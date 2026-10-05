import { describe, expect, it } from "vitest";
import type { Basis } from "@/lib/bonds/proposals";
import { bondFlags, earlierPending, type PendingRow, pendingModel, seenKey } from "./pending";

const basis: Basis = { start: "2026-05-26", end: "2026-08-26", days: 92, annual: "7.38", rateSource: "history", method: "act_360", uncertain: false, missing: null };
const row = (id: string, due: string, over: Partial<PendingRow> = {}): PendingRow => ({
  id, instrumentId: "BN", accountId: "A", kind: "interest", due, nominal: "500000", percent: "1.89", amount: "9450", basis, status: "open", edited: false, ...over,
});
const names = { account: new Map([["A", "Kincstár · Értékpapír"], ["B", "Bank · TBSZ"]]), instrument: new Map([["BN", "BMÁP 2027/N"], ["M9", "MÁP Plusz N2030/M9"]]) };

describe("pendingModel: the cards of Ellenőrzésre vár (spec §6.3–§6.4)", () => {
  it("oldest first; a later one of the same paper and account waits for the earlier one", () => {
    const { cards, dismissed } = pendingModel([row("b", "2026-08-26"), row("a", "2026-05-26")], names);
    expect(cards.map((c) => [c.id, c.blockedBy])).toEqual([["a", null], ["b", { due: "2026-05-26", kind: "interest" }]]);
    expect(cards[0]).toMatchObject({ instrumentName: "BMÁP 2027/N", accountName: "Kincstár · Értékpapír", amount: "9450" });
    expect(dismissed).toEqual([]);
  });

  it("another account or another paper does not block; a snoozed one does; a dismissed one does not", () => {
    const rows = [
      row("a", "2026-05-26", { status: "snoozed" }),
      row("b", "2026-08-26"),
      row("c", "2026-08-26", { accountId: "B" }),
      row("d", "2026-09-25", { instrumentId: "M9", kind: "interest_reinvest" }),
      row("e", "2026-02-26", { accountId: "B", status: "dismissed" }),
    ];
    const { cards, dismissed } = pendingModel(rows, names);
    expect(Object.fromEntries(cards.map((c) => [c.id, c.blockedBy?.due ?? null]))).toEqual({ a: null, b: "2026-05-26", c: null, d: null });
    expect(dismissed.map((c) => c.id)).toEqual(["e"]);
  });
});

describe("earlierPending: the server's own check before an approval", () => {
  it("names the earliest open or snoozed proposal of the same paper and account", () => {
    const rows = [row("a", "2026-05-26", { status: "snoozed" }), row("b", "2026-08-26"), row("x", "2026-02-26", { status: "dismissed" })];
    expect(earlierPending(rows, rows[1])?.id).toBe("a");
    expect(earlierPending(rows, rows[0])).toBeNull();
  });
});

describe("bondFlags: what the Pozíciók page says next to a government security (spec §4.3, §6.4–§6.5)", () => {
  it("matured and still held, waiting proposals, a dismissed crediting, an unverified series", () => {
    const flags = bondFlags({
      today: "2026-09-28",
      bonds: [
        { instrumentId: "OLD", maturity: "2026-09-20", check: "verified" },
        { instrumentId: "M9", maturity: "2030-09-25", check: "mismatch" },
        { instrumentId: "BN", maturity: "2027-05-26", check: "verified" },
      ],
      positions: [{ accountId: "A", instrumentId: "OLD" }, { accountId: "A", instrumentId: "M9" }, { accountId: "A", instrumentId: "BN" }],
      rows: [
        row("p", "2026-09-20", { instrumentId: "OLD", kind: "maturity" }),
        row("d", "2026-09-25", { instrumentId: "M9", kind: "interest_reinvest", status: "dismissed" }),
        row("x", "2026-08-26", { status: "dismissed" }),
      ],
    });
    expect(flags.get("A|OLD")).toEqual(["matured", "pending"]);
    expect(flags.get("A|M9")).toEqual(["incomplete", "unverified"]);
    expect(flags.get("A|BN")).toEqual([]); // a dismissed cash interest leaves the holding whole
  });
});

describe("seenKey: what the card showed, so the server can tell a changed proposal", () => {
  it("changes with the nominal, the amount and the day, not with the status", () => {
    const a = row("a", "2026-08-26");
    const snoozed: PendingRow = { ...a, status: "snoozed" };
    expect(seenKey(a)).toBe(seenKey(snoozed));
    expect(seenKey(a)).not.toBe(seenKey({ ...a, amount: "9500" }));
    expect(seenKey(a)).not.toBe(seenKey({ ...a, nominal: "600000" }));
    expect(seenKey(a)).not.toBe(seenKey({ ...a, amount: null }));
  });
});
