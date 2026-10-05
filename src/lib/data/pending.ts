import "server-only";
/**
 * The owner's proposals (spec 2026-09-28 §6), through their own session (RLS).
 * Approved ones are the ledger's now and are left out.
 */
import type { Basis, ProposalKind } from "@/lib/bonds/proposals";
import type { PendingRow, PendingStatus } from "@/lib/views/pending";
import { D } from "@/lib/finance/money";
import { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

export async function loadPending(db?: Db): Promise<PendingRow[]> {
  const client = db ?? (await createClient());
  const { data, error } = await client
    .from("pending_events")
    .select("id, instrument_id, account_id, kind, due_date, nominal::text, percent::text, amount::text, basis, status, edited")
    .neq("status", "approved")
    .order("due_date");
  if (error) throw new Error(`pending_events: ${error.message}`);
  // numeric(28, 10) reads as "8700.0000000000"; the cards show and edit "8700".
  const plain = (v: string | null) => (v === null ? null : new D(v).toFixed());
  return (data ?? []).map((r) => ({
    id: r.id, instrumentId: r.instrument_id, accountId: r.account_id, kind: r.kind as ProposalKind, due: r.due_date,
    nominal: plain(r.nominal)!, percent: plain(r.percent), amount: plain(r.amount), basis: r.basis as unknown as Basis, status: r.status as PendingStatus, edited: r.edited,
  }));
}
