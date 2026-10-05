/**
 * The ledger events of an approved proposal (spec 2026-09-28 §7): a MÁP Plusz
 * interest credited in papers, an interest paid in cash, or a maturity. The
 * money stays on the account unless the owner says it was taken out; then a
 * withdrawal of the same amount goes in on the same day. Pure; the server
 * passes the holding and records the result with the proposal's id.
 */
import type { FxRow } from "@/lib/finance/fx";
import type { Day, Dec } from "@/lib/finance/money";
import type { EntryEvent } from "@/lib/entry/build";
import { cash, costRefs, type Inst, position } from "@/lib/tx/build";
import type { ProposalKind } from "./proposals";

export type Decision = { amount: Dec | null; date: Day; note: string | null; payout: "keep" | "withdraw" };
export type ApprovalResult = { ok: true; entry: { id: string; events: EntryEvent[] } } | { ok: false; error: "amountRequired" | "noHolding" };

export function approvalEntry(
  p: { kind: ProposalKind; instrumentId: string; accountId: string; nominal: Dec },
  d: Decision,
  ctx: { held: Dec; newId: () => string; entryId?: string; fxRows: FxRow[] },
): ApprovalResult {
  const inst: Inst = { id: p.instrumentId, currency: "HUF", valuation: "market" };
  const acc = p.accountId;
  const ev = (type: EntryEvent["type"], lines: EntryEvent["lines"], note: string | null = null): EntryEvent => ({ type, date: d.date, note, lines, quotes: [], valuations: [] });
  const out = (amount: Dec): EntryEvent[] => (d.payout === "withdraw" && amount.gt(0) ? [ev("withdrawal", [cash(acc, "HUF", amount.neg(), "external")])] : []);
  const entry = (events: EntryEvent[]): ApprovalResult => ({ ok: true, entry: { id: ctx.entryId ?? ctx.newId(), events } });

  if (p.kind === "maturity") {
    if (ctx.held.lte(0)) return { ok: false, error: "noHolding" };
    if (d.amount === null || d.amount.lt(0)) return { ok: false, error: "amountRequired" };
    const interest = d.amount.gt(0) ? [cash(acc, "HUF", d.amount, "income", p.instrumentId)] : [];
    return entry([
      ev("maturity", [position(acc, inst, ctx.held.neg(), "trade"), cash(acc, "HUF", ctx.held, "trade"), ...interest], d.note),
      ...out(ctx.held.plus(d.amount)),
    ]);
  }
  if (d.amount === null || d.amount.lte(0)) return { ok: false, error: "amountRequired" };
  if (p.kind === "interest") return entry([ev("interest", [cash(acc, "HUF", d.amount, "income", p.instrumentId)], d.note), ...out(d.amount)]);
  // One unit is 1 Ft nominal: the credited forints are the new units and their cost.
  return entry([
    ev(
      "interest_reinvest",
      [
        cash(acc, "HUF", d.amount, "income", p.instrumentId),
        cash(acc, "HUF", d.amount.neg(), "trade"),
        position(acc, inst, d.amount, "trade", { amount: d.amount, estimated: false, refs: costRefs(ctx, "HUF", d.date) }),
      ],
      d.note,
    ),
  ]);
}
