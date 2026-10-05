import "server-only";
/**
 * Saves the owner's current proposals (spec 2026-09-28 §6.2) through their own
 * session: the refresh calls it after the prices, and an approval after it
 * is recorded, so later proposals follow the grown holding at once.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Loaded } from "@/lib/data/load";
import { D, type Day } from "@/lib/finance/money";
import type { AkkTab } from "@/lib/providers/akk";
import type { Database } from "@/lib/supabase/database.types";
import { type BondFacts, type Observed, proposalsFor } from "./proposals";
import { bondKind, type RateRow } from "./rules";

type Db = SupabaseClient<Database>;

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error || r.data === null) throw new Error(`proposals: ${what}: ${r.error?.message ?? "no data"}`);
  return r.data;
}

/** The owner's ÁKK instruments with their series and check. */
export async function loadBondFacts(db: Db, data: Pick<Loaded, "instrumentMeta">): Promise<BondFacts[]> {
  const terms = must(await db.from("bond_terms").select("instrument_id, series, security_type, tab, issue_date, maturity_date, check_status"), "bond_terms");
  const names = new Map(data.instrumentMeta.map((i) => [i.id, i.name]));
  return terms.flatMap((t) => {
    const kind = bondKind(t.security_type);
    return kind && names.has(t.instrument_id)
      ? [{
          instrumentId: t.instrument_id, name: names.get(t.instrument_id)!, series: t.series, kind, tab: t.tab as AkkTab,
          issue: t.issue_date, maturity: t.maturity_date, check: t.check_status as BondFacts["check"],
        }]
      : [];
  });
}

/**
 * Proposals are computed from `data`; an open one it does not list is removed,
 * unless it changed after `data.readAt` (a send-back meanwhile, #92).
 */
export async function syncProposals(db: Db, data: Pick<Loaded, "instrumentMeta" | "events" | "readAt">, today: Day): Promise<number> {
  const bonds = await loadBondFacts(db, data);
  const [rates, observations] = await Promise.all([
    db.from("bond_rates").select("series, period_start, period_end, rate::text"),
    db.from("bond_observations").select("instrument_id, settle_date, coupon::text, check_result"),
  ]);
  const bySeries = new Map<string, RateRow[]>();
  for (const r of must(rates, "bond_rates")) bySeries.set(r.series, [...(bySeries.get(r.series) ?? []), { start: r.period_start, end: r.period_end, rate: new D(r.rate) }]);
  const byInstrument = new Map<string, Observed[]>();
  for (const o of must(observations, "bond_observations")) {
    const seen: Observed = { settle: o.settle_date, coupon: o.coupon === null ? null : new D(o.coupon), checkResult: o.check_result as Observed["checkResult"] };
    byInstrument.set(o.instrument_id, [...(byInstrument.get(o.instrument_id) ?? []), seen]);
  }
  const list = proposalsFor({ bonds, events: data.events, rates: bySeries, observations: byInstrument, today });
  const rows = list.map((p) => ({
    instrumentId: p.instrumentId, accountId: p.accountId, kind: p.kind, due: p.due, nominal: p.nominal.toFixed(),
    percent: p.percent?.toFixed() ?? null, amount: p.amount?.toFixed() ?? null, basis: p.basis,
  }));
  return must(await db.rpc("sync_pending_events", { p_rows: rows, p_read_at: data.readAt }), "sync_pending_events");
}
