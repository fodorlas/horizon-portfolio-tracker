/**
 * "Ellenőrzésre vár" (spec 2026-09-28 §6.3–§6.4): the proposals as cards,
 * oldest first. Of one paper on one account only the earliest open or snoozed
 * proposal can be approved; a later one names the one to settle first. Plain
 * strings only: the cards are client components.
 */
import type { Basis, ProposalKind } from "@/lib/bonds/proposals";
import type { Day } from "@/lib/finance/money";
import type { Names } from "./names";

export type PendingStatus = "open" | "snoozed" | "approved" | "dismissed";
export type PendingRow = {
  id: string;
  instrumentId: string;
  accountId: string;
  kind: ProposalKind;
  due: Day;
  nominal: string;
  percent: string | null;
  amount: string | null;
  basis: Basis;
  status: PendingStatus;
  edited: boolean;
};
export type PendingCard = Omit<PendingRow, "instrumentId" | "accountId" | "status"> & {
  instrumentName: string;
  accountName: string;
  status: "open" | "snoozed" | "dismissed";
  blockedBy: { due: Day; kind: ProposalKind } | null;
};

/** What a card showed (day, nominal, amount): an approval of different figures is refused, not booked. */
export const seenKey = (r: Pick<PendingRow, "due" | "nominal" | "amount">) => `${r.due}|${r.nominal}|${r.amount ?? ""}`;

const live = (r: Pick<PendingRow, "status">) => r.status === "open" || r.status === "snoozed";
const order = (a: PendingRow, b: PendingRow) => a.due.localeCompare(b.due) || a.instrumentId.localeCompare(b.instrumentId) || a.accountId.localeCompare(b.accountId);

/** The earliest open or snoozed proposal of the same paper and account before `row`, or null. */
export function earlierPending<T extends Pick<PendingRow, "id" | "instrumentId" | "accountId" | "due" | "status">>(rows: T[], row: T): T | null {
  return (
    rows
      .filter((r) => r.id !== row.id && live(r) && r.instrumentId === row.instrumentId && r.accountId === row.accountId && r.due < row.due)
      .sort((a, b) => a.due.localeCompare(b.due))[0] ?? null
  );
}

export function pendingModel(rows: PendingRow[], names: Names): { cards: PendingCard[]; dismissed: PendingCard[] } {
  const card = (r: PendingRow): PendingCard => {
    const first = live(r) ? earlierPending(rows, r) : null;
    const { instrumentId, accountId, status, ...rest } = r;
    return {
      ...rest,
      instrumentName: names.instrument.get(instrumentId) ?? "",
      accountName: names.account.get(accountId) ?? "",
      status: status === "approved" ? "open" : status,
      blockedBy: first ? { due: first.due, kind: first.kind } : null,
    };
  };
  const sorted = [...rows].sort(order);
  return { cards: sorted.filter(live).map(card), dismissed: sorted.filter((r) => r.status === "dismissed").map(card) };
}

export type BondFlag = "matured" | "pending" | "incomplete" | "unverified";

/**
 * Per held position ("account|instrument"): matured and still held (the
 * maturity waits for approval, §4.3), proposals waiting (§6.5), a dismissed
 * crediting in papers – the holding is likely smaller than the real one
 * (§6.4) – and a series whose check does not match (§5.4).
 */
export function bondFlags(input: {
  today: Day;
  bonds: { instrumentId: string; maturity: Day; check: string }[];
  positions: { accountId: string; instrumentId: string }[];
  rows: Pick<PendingRow, "instrumentId" | "accountId" | "kind" | "status">[];
}): Map<string, BondFlag[]> {
  const bonds = new Map(input.bonds.map((b) => [b.instrumentId, b]));
  const out = new Map<string, BondFlag[]>();
  for (const p of input.positions) {
    const b = bonds.get(p.instrumentId);
    if (!b) continue;
    const mine = input.rows.filter((r) => r.instrumentId === p.instrumentId && r.accountId === p.accountId);
    const flags: BondFlag[] = [];
    if (b.maturity <= input.today) flags.push("matured");
    if (mine.some(live)) flags.push("pending");
    if (mine.some((r) => r.status === "dismissed" && r.kind === "interest_reinvest")) flags.push("incomplete");
    if (b.check === "mismatch") flags.push("unverified");
    out.set(`${p.accountId}|${p.instrumentId}`, flags);
  }
  return out;
}
