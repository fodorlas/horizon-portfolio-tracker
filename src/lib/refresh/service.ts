import "server-only";
/**
 * A refresh for the signed-in owner: gathers what is stored, plans per item,
 * runs against the real sources and writes through the owner's own session
 * (RLS applies to every read and write). See plan.ts and run.ts for the rules.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import YahooFinance from "yahoo-finance2";
import { loadBondFacts, syncProposals } from "@/lib/bonds/sync";
import { all, loadPortfolio } from "@/lib/data/load";
import { addDays, D, type Day, type Dec, todayInBudapest } from "@/lib/finance/money";
import { dayOf, priceSourceFilter, selectLogged } from "@/lib/finance/prices";
import { type AkkRate, createAkk } from "@/lib/providers/akk";
import { createBet, dailyBetLists } from "@/lib/providers/bet";
import { fetchEcb } from "@/lib/providers/ecb";
import { createBudget } from "@/lib/providers/http";
import { fetchMnb, type SourceRate } from "@/lib/providers/mnb";
import type { Split } from "@/lib/providers/splits";
import { createYahoo, type YahooApi } from "@/lib/providers/yahoo";
import type { Database } from "@/lib/supabase/database.types";
import { numeric } from "@/lib/supabase/numeric";
import { endOfDayBudapest } from "@/lib/tx/parse";
import { fakeAkk, fakeBet, fakeSources } from "./fake";
import { type PriceInstrument, type PriceSource, planRefresh, RECENT_MS, type Source } from "./plan";
import { type FxInsert, type LogRow, type QuoteInsert, type RefreshSummary, runRefresh } from "./run";

type Db = SupabaseClient<Database>;
const CHUNK = 1000;

/**
 * Real sources are opt-in for a self-hosted installation. The repository does
 * not contain a project reference; without an explicitly configured reference
 * the app uses invented/sample sources.
 */
export function realSources(supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): boolean {
  const projectRef = process.env.HORIZON_LIVE_PROJECT_REF ?? "";
  if (!/^[a-z0-9]{3,64}$/.test(projectRef)) return false;
  try {
    return new URL(supabaseUrl).hostname === `${projectRef}.supabase.co`;
  } catch {
    return false;
  }
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error || r.data === null) throw new Error(`refresh: ${what}: ${r.error?.message ?? "no data"}`);
  return r.data;
}

async function inChunks<T>(rows: T[], write: (chunk: T[]) => Promise<number>): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK) n += await write(rows.slice(i, i + CHUNK));
  return n;
}

export async function refreshForOwner(db: Db, now = new Date()): Promise<RefreshSummary> {
  const today = todayInBudapest(now);
  const data = await loadPortfolio(db, { pricesFrom: today });

  // What the portfolio needs.
  const firstDayOf = new Map<string, Day>();
  const trackingStart = new Map(data.accounts.map((a) => [a.id, a.trackingStart]));
  const currencies = new Set(data.instruments.map((i) => i.currency));
  const ledgerSplits = new Map<string, Split[]>();
  for (const e of data.events) {
    for (const l of e.lines) {
      currencies.add(l.currency);
      if (!l.instrumentId) continue;
      const start = [e.date, trackingStart.get(l.accountId) ?? e.date].sort()[0];
      if (!firstDayOf.has(l.instrumentId) || start < firstDayOf.get(l.instrumentId)!) firstDayOf.set(l.instrumentId, start);
      if (e.type === "split" && e.splitRatio && l.role === "split") {
        const list = ledgerSplits.get(l.instrumentId) ?? [];
        if (!list.some((s) => s.day === e.date)) list.push({ day: e.date, ratio: e.splitRatio });
        ledgerSplits.set(l.instrumentId, list);
      }
    }
  }
  // Yahoo and BÉT papers (spec 2026-09-28 §2.6), each from its own source.
  const instruments: PriceInstrument[] = data.instrumentMeta
    .filter((i) => i.valuation === "market" && (i.price_source === "yahoo" || i.price_source === "bet") && i.provider_symbol)
    .map((i) => ({
      id: i.id, symbol: i.provider_symbol!, currency: i.currency, name: i.name, firstDay: firstDayOf.get(i.id) ?? today, source: i.price_source as PriceSource,
    }));
  const sourceOf = new Map(instruments.map((i) => [i.id, i.source]));

  // The ÁKK instruments with their series (spec 2026-09-28 §4.1).
  // Only the papers held today are asked for (spec §2.1); sold ones and repaid ones are not.
  const units = new Map<string, Dec>();
  for (const e of data.events) {
    if (e.date > today) continue;
    for (const l of e.lines) if (l.kind === "position" && l.instrumentId) units.set(l.instrumentId, (units.get(l.instrumentId) ?? new D(0)).plus(l.amount));
  }
  const allBonds = await loadBondFacts(db, data);
  const bonds = allBonds.filter((b) => units.get(b.instrumentId)?.gt(0));
  const needsRates = bonds.some((b) => b.kind === "bmap" || b.kind === "pmap");

  // What is stored.
  const [fxCov, priceCov, recent, ratesToday, emptyHistory] = await Promise.all([
    db.rpc("fx_coverage"),
    db.rpc("price_coverage"),
    db
      .from("refresh_log")
      .select("source, item, kind, at")
      .in("status", ["ok", "empty"])
      .in("kind", ["tail", "live"])
      .gte("at", new Date(now.getTime() - RECENT_MS).toISOString()),
    // The interest history is fetched at most once a day.
    db
      .from("refresh_log")
      .select("id")
      .eq("source", "akk")
      .eq("item", "rates")
      .in("status", ["ok", "empty"])
      .gt("at", endOfDayBudapest(addDays(today, -1)))
      .limit(1),
    // History ranges that came back empty: a head they cover is not asked again (#77).
    db
      .from("refresh_log")
      .select("source, item, range_from, range_to")
      .eq("kind", "history")
      .eq("status", "empty")
      .not("range_from", "is", null)
      .not("range_to", "is", null),
  ]);
  const plan = planRefresh({
    today,
    now,
    trackingStarts: data.accounts.map((a) => a.trackingStart),
    currencies: [...currencies],
    fxCoverage: must(fxCov, "fx_coverage").map((c) => ({ source: c.source as "MNB" | "ECB", currency: c.currency, firstDay: c.first_day, lastDay: c.last_day })),
    instruments,
    priceCoverage: must(priceCov, "price_coverage").map((c) => ({ instrumentId: c.instrument_id, source: c.source as PriceSource, firstDay: c.first_day, lastDay: c.last_day })),
    recent: must(recent, "refresh_log").map((r) => ({ source: r.source as Source, item: r.item, kind: r.kind as "tail" | "live", at: r.at })),
    emptyHistory: must(emptyHistory, "refresh_log").map((r) => ({ source: r.source as Source, item: r.item, from: r.range_from!, to: r.range_to! })),
    akk: bonds.length > 0 ? { bonds, needsRates, ratesFetchedToday: must(ratesToday, "refresh_log").length > 0 } : undefined,
  });

  const budget = createBudget();
  const sources = realSources()
    ? {
        fetchMnb: (from: Day, to: Day, c: string[]) => fetchMnb(from, to, c, budget),
        fetchEcb: (from: Day, to: Day, c: string[]) => fetchEcb(from, to, c, budget),
        yahoo: createYahoo(new YahooFinance({ suppressNotices: ["yahooSurvey"] }) as unknown as YahooApi, budget),
      }
    : fakeSources(today, () => now);

  const summary = await runRefresh(plan.tasks, plan.skipped, {
    runId: randomUUID(),
    budget,
    today,
    instruments,
    ledgerSplits: (id) => ledgerSplits.get(id) ?? [],
    ...sources,
    bet: realSources() ? createBet(budget, today, fetch, undefined, dailyBetLists) : fakeBet(today, instruments.filter((i) => i.source === "bet").map((i) => i.symbol)),
    storedEcb: async (from, to) => {
      const rows = await all((a, b) =>
        db.from("fx_rates").select("base, quote, rate::text, rate_date, raw_unit").eq("source", "ECB").gte("rate_date", from).lte("rate_date", to).order("id").range(a, b),
      );
      return rows.map((r): SourceRate => ({ base: r.base, quote: r.quote, rate: new D(r.rate), rawUnit: r.raw_unit, rateDate: r.rate_date }));
    },
    priceBefore: async (instrumentId, day) => {
      // Corrections share the as_of of the row they replace, so the latest rows are enough.
      const r = await db
        .from("price_quotes")
        .select("id, price::text, currency, as_of, entered_at, source, status, supersedes_id")
        .eq("instrument_id", instrumentId)
        .lte("as_of", endOfDayBudapest(addDays(day, -1)))
        .order("as_of", { ascending: false })
        .limit(50);
      const rows = must(r, "price_quotes").map((q) => ({
        id: q.id, instrumentId, price: q.price, currency: q.currency, asOf: q.as_of, enteredAt: q.entered_at,
        source: q.source, status: q.status as "ok" | "suspect", supersedesId: q.supersedes_id,
      }));
      // The reference for a suspect jump comes from the paper's own source too (prices.ts).
      const best = selectLogged(rows, addDays(day, -1), priceSourceFilter(sourceOf.get(instrumentId) ?? "manual"));
      return best ? { day: dayOf(best.asOf), price: new D(best.price) } : null;
    },
    recordFx: (rows: FxInsert[]) => inChunks(rows, async (c) => must(await db.rpc("record_fx_rates", { p_rows: c }), "record_fx_rates")),
    recordQuotes: (rows: QuoteInsert[]) => inChunks(rows, async (c) => must(await db.rpc("record_quotes", { p_rows: c }), "record_quotes")),
    akk: {
      source: realSources() ? createAkk(budget) : fakeAkk(today, bonds.map((b) => b.series)),
      bonds,
      storedRates: async (series) => {
        const rows = must(await db.from("bond_rates").select("series, period_start, period_end, rate::text").in("series", series), "bond_rates");
        return rows.map((r): AkkRate => ({ series: r.series, start: r.period_start, end: r.period_end, rate: new D(r.rate) }));
      },
      recordRates: (rows) =>
        inChunks(rows, async (c) => {
          const r = await db
            .from("bond_rates")
            .upsert(c.map((x) => ({ series: x.series, period_start: x.start, period_end: x.end, rate: numeric(x.rate.toFixed()) })), { onConflict: "owner_id,series,period_start", ignoreDuplicates: true })
            .select("id");
          return must(r, "bond_rates").length;
        }),
      recordObservations: async (rows) => {
        const r = await db
          .from("bond_observations")
          .upsert(
            rows.map((o) => ({
              instrument_id: o.instrumentId, day: o.day, bid: numeric(o.bid), ask: o.ask === null ? null : numeric(o.ask),
              accrued: numeric(o.accrued), coupon: o.coupon === null ? null : numeric(o.coupon), settle_date: o.settleDate, check_result: o.checkResult,
            })),
            { onConflict: "instrument_id,day", ignoreDuplicates: true },
          )
          .select("id");
        return must(r, "bond_observations").length;
      },
      setChecks: async (rows) => {
        for (const c of rows) {
          const r = await db.from("bond_terms").update({ check_status: c.status, checked_on: c.day }).eq("instrument_id", c.instrumentId);
          if (r.error) throw new Error(`refresh: bond_terms: ${r.error.message}`);
        }
      },
    },
    log: async (rows: LogRow[]) => {
      await inChunks(rows, async (c) => {
        const r = await db.from("refresh_log").insert(
          c.map((l) => ({
            run_id: l.runId, source: l.source, item: l.item, kind: l.kind, range_from: l.rangeFrom, range_to: l.rangeTo,
            status: l.status, inserted: l.inserted, suspect: l.suspect, unchecked: l.unchecked, message: l.message,
          })),
          { defaultToNull: false },
        );
        if (r.error) throw new Error(`refresh: refresh_log: ${r.error.message}`);
        return c.length;
      });
    },
  });
  if (allBonds.length > 0) {
    // The proposals follow the prices; a failure here leaves the refresh's own results in place.
    try {
      await syncProposals(db, data, today);
    } catch (e) {
      console.error("refresh: proposals", e instanceof Error ? e.message : e);
    }
  }
  return summary;
}
