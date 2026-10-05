import { describe, expect, it } from "vitest";
import { D } from "@/lib/finance/money";
import { approvalEntry, type Decision } from "./approve";

let n = 0;
const ctx = (held: string) => ({ held: new D(held), newId: () => `id${++n}`, fxRows: [] });
const decide = (over: Partial<Decision> = {}): Decision => ({ amount: new D(61100), date: "2026-09-25", note: null, payout: "keep", ...over });
const lines = (r: ReturnType<typeof approvalEntry>) =>
  r.ok ? r.entry.events.map((e) => [e.type, e.date, e.lines.map((l) => [l.kind, l.instrumentId, l.amount, l.role, l.costAmount])]) : r.error;

describe("approvalEntry: the ledger events of an approved proposal (spec §7)", () => {
  it("interest in papers: income, the same amount spent, as many forints of nominal at that cost", () => {
    expect(lines(approvalEntry({ kind: "interest_reinvest", instrumentId: "M9", accountId: "A", nominal: new D(1000000) }, decide(), ctx("1000000")))).toEqual([
      ["interest_reinvest", "2026-09-25", [["cash", "M9", "61100", "income", null], ["cash", null, "-61100", "trade", null], ["position", "M9", "61100", "trade", "61100"]]],
    ]);
  });

  it("interest in cash stays on the account, or a withdrawal takes it out the same day", () => {
    const p = { kind: "interest" as const, instrumentId: "BN", accountId: "A", nominal: new D(500000) };
    expect(lines(approvalEntry(p, decide({ amount: new D(8700), date: "2026-11-26" }), ctx("500000")))).toEqual([
      ["interest", "2026-11-26", [["cash", "BN", "8700", "income", null]]],
    ]);
    expect(lines(approvalEntry(p, decide({ amount: new D(8700), date: "2026-11-26", payout: "withdraw" }), ctx("500000")))).toEqual([
      ["interest", "2026-11-26", [["cash", "BN", "8700", "income", null]]],
      ["withdrawal", "2026-11-26", [["cash", null, "-8700", "external", null]]],
    ]);
  });

  it("a maturity repays everything held, with the last interest; without interest no income line", () => {
    const p = { kind: "maturity" as const, instrumentId: "S", accountId: "A", nominal: new D(200000) };
    expect(lines(approvalEntry(p, decide({ amount: new D(3000), date: "2026-09-20", payout: "withdraw" }), ctx("200000")))).toEqual([
      ["maturity", "2026-09-20", [["position", "S", "-200000", "trade", null], ["cash", null, "200000", "trade", null], ["cash", "S", "3000", "income", null]]],
      ["withdrawal", "2026-09-20", [["cash", null, "-203000", "external", null]]],
    ]);
    expect(lines(approvalEntry(p, decide({ amount: new D(0), date: "2026-09-20" }), ctx("200000")))).toEqual([
      ["maturity", "2026-09-20", [["position", "S", "-200000", "trade", null], ["cash", null, "200000", "trade", null]]],
    ]);
  });

  it("an interest without an amount, or nothing held, is refused", () => {
    const p = { kind: "interest_reinvest" as const, instrumentId: "M9", accountId: "A", nominal: new D(1000000) };
    expect(lines(approvalEntry(p, decide({ amount: null }), ctx("1000000")))).toBe("amountRequired");
    expect(lines(approvalEntry(p, decide({ amount: new D(0) }), ctx("1000000")))).toBe("amountRequired");
    expect(lines(approvalEntry({ ...p, kind: "maturity" }, decide({ amount: null }), ctx("0")))).toBe("noHolding");
  });

  it("keeps the given entry id (an approval sent back and approved again gets a new one otherwise)", () => {
    const r = approvalEntry({ kind: "interest", instrumentId: "BN", accountId: "A", nominal: new D(1) }, decide({ amount: new D(1) }), { ...ctx("1"), entryId: "keep-me" });
    expect(r.ok && r.entry.id).toBe("keep-me");
  });
});
