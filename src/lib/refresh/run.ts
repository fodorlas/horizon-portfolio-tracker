/**
 * Runs a refresh plan (phase 4 plan §2–§4). One request at a time, inside the
 * work budget; every item is saved and logged on its own, so what was fetched
 * stays even if later items fail or the budget runs out – the next refresh
 * continues from the stored coverage.
 *
 * Order: ECB first (the MNB check needs it), then MNB, then Yahoo and BÉT
 * history and tails per instrument, then the Yahoo live quotes in one batch,
 * then the ÁKK: its interest history and each tab's list (spec 2026-09-28
 * §4.1). The BÉT has closes only (spec §2.6).
 */
import { type BondTerms, type Observation, observe } from "@/lib/bonds/observe";
import { addDays, type Day, type Dec } from "@/lib/finance/money";
import type { AkkRate, AkkRow, AkkSource, AkkTab } from "@/lib/providers/akk";
import type { BetHistory } from "@/lib/providers/bet";
import { dayOf, type QuoteStatus } from "@/lib/finance/prices";
import { crossCheckMnb } from "@/lib/providers/fx-check";
import { type Budget, classify, type ErrorClass, ProviderError } from "@/lib/providers/http";
import type { SourceRate } from "@/lib/providers/mnb";
import { classifySeries, mergeSplits, type Priced, type Split, unrecordedSplits } from "@/lib/providers/splits";
import { asOfForDay, type History, type LiveQuote } from "@/lib/providers/yahoo";
import type { AkkTask, FxSource, FxTask, Kind, LiveTask, PriceInstrument, PriceTask, Skip, Source, Task } from "./plan";

export type FxInsert = { base: string; quote: string; rate: string; rateDate: Day; source: FxSource; rawUnit: number; status: QuoteStatus };
export type QuoteInsert = { instrumentId: string; price: string; currency: string; asOf: string; source: "yahoo" | "bet" | "akk"; status: QuoteStatus };
/** A log message: a fetch's error class, or what the ÁKK check found (spec 2026-09-28 §5.4, §4.1). */
export type LogMessage = ErrorClass | "rule_mismatch" | "not_listed";
export type LogRow = {
  runId: string;
  source: Source;
  item: string;
  kind: Kind;
  rangeFrom: Day | null;
  rangeTo: Day | null;
  status: "ok" | "empty" | "error" | "skipped";
  inserted: number;
  suspect: number;
  unchecked: number;
  message: LogMessage | null;
};

export type CheckUpdate = { instrumentId: string; status: "verified" | "mismatch" | "unknown"; day: Day };
/** The ÁKK part of a refresh (spec 2026-09-28 §4.1): the source, the owner's instruments and where things are saved. */
export type AkkDeps = {
  source: AkkSource;
  bonds: BondTerms[];
  /** The stored BMÁP/PMÁP history of these series, for when today's fetch is not made or fails. */
  storedRates: (series: string[]) => Promise<AkkRate[]>;
  recordRates: (rows: AkkRate[]) => Promise<number>;
  recordObservations: (rows: Observation[]) => Promise<number>;
  setChecks: (rows: CheckUpdate[]) => Promise<void>;
};

export type RefreshDeps = {
  runId: string;
  budget: Budget;
  today: Day;
  instruments: PriceInstrument[];
  ledgerSplits: (instrumentId: string) => Split[];
  fetchMnb: (from: Day, to: Day, currencies: string[]) => Promise<SourceRate[]>;
  fetchEcb: (from: Day, to: Day, currencies: string[]) => Promise<SourceRate[]>;
  yahoo: {
    history: (symbol: string, from: Day, to: Day) => Promise<History>;
    splitsSince: (symbol: string, from: Day) => Promise<Split[]>;
    quotes: (symbols: string[]) => Promise<Map<string, LiveQuote>>;
  };
  /** The BÉT's daily closes of one paper (spec 2026-09-28 §2.6). */
  bet: { history: (code: string, from: Day, to: Day) => Promise<BetHistory> };
  /** ECB rows already stored for [from, to] (for the MNB check). */
  storedEcb: (from: Day, to: Day) => Promise<SourceRate[]>;
  /** The price that wins just before `day` (any source), or null. */
  priceBefore: (instrumentId: string, day: Day) => Promise<Priced | null>;
  recordFx: (rows: FxInsert[]) => Promise<number>;
  recordQuotes: (rows: QuoteInsert[]) => Promise<number>;
  log: (rows: LogRow[]) => Promise<void>;
  akk?: AkkDeps;
};

export type SourceSummary = { source: Source; items: number; inserted: number; suspect: number; unchecked: number; errors: number; skipped: number };
export type RefreshSummary = {
  runId: string;
  sources: SourceSummary[];
  /** Items left for the next refresh (work budget or Yahoo rate limit). */
  continued: number;
  errors: { source: Source; item: string; name: string; message: LogMessage }[];
  splitWarnings: { instrumentId: string; name: string; day: Day; ratio: string }[];
};

/** Two items in a row answered 429: the rest of Yahoo waits for the next refresh. */
export const RATE_LIMIT_TRIP = 2;

const inRange = (day: Day, t: { from: Day; to: Day }) => day >= t.from && day <= t.to;

export async function runRefresh(tasks: Task[], skipped: Skip[], deps: RefreshDeps): Promise<RefreshSummary> {
  const logs: LogRow[] = [];
  const names = new Map(deps.instruments.map((i) => [i.id, i]));
  const errors: RefreshSummary["errors"] = [];
  const splitWarnings: RefreshSummary["splitWarnings"] = [];
  const itemName = (source: string, item: string) => (source === "yahoo" || source === "bet" ? (names.get(item)?.name ?? item) : item);

  const base = (t: Task): Omit<LogRow, "status" | "inserted" | "suspect" | "unchecked" | "message"> => ({
    runId: deps.runId,
    source: t.source,
    item: t.item,
    kind: t.kind,
    rangeFrom: "from" in t ? t.from : deps.today,
    rangeTo: "to" in t ? t.to : deps.today,
  });
  const failed = (t: Task, e: unknown, report = true) => {
    const err = classify(e);
    const skip = err.errorClass === "budget" || err.errorClass === "rate_limited";
    logs.push({ ...base(t), status: skip ? "skipped" : "error", inserted: 0, suspect: 0, unchecked: 0, message: err.errorClass });
    if (!skip && report) errors.push({ source: t.source, item: t.item, name: itemName(t.source, t.item), message: err.errorClass });
    return err;
  };
  const done = (t: Task, fetched: number, inserted: number, suspect: number, unchecked = 0) =>
    logs.push({ ...base(t), status: fetched > 0 ? "ok" : "empty", inserted, suspect, unchecked, message: null });

  // FX: one fetch per source over the union of its items' ranges, then per item.
  const ecbRows: SourceRate[] = [];
  for (const source of ["ECB", "MNB"] as const) {
    const own = tasks.filter((t): t is FxTask => t.source === source);
    if (own.length === 0) continue;
    const from = own.map((t) => t.from).sort()[0];
    const to = own.map((t) => t.to).sort().at(-1)!;
    const currencies = [...new Set(own.map((t) => t.item))];
    let rows: SourceRate[];
    try {
      rows = source === "ECB" ? await deps.fetchEcb(from, to, currencies) : await deps.fetchMnb(from, to, currencies);
    } catch (e) {
      for (const t of own) failed(t, e);
      continue;
    }
    if (source === "ECB") ecbRows.push(...rows);
    const reference = source === "MNB" ? [...ecbRows, ...(await deps.storedEcb(from, to))] : [];
    for (const t of own) {
      const mine = rows.filter((r) => (source === "MNB" ? r.base : r.quote) === t.item && inRange(r.rateDate, t));
      const checked = source === "MNB" ? crossCheckMnb(mine, reference) : { rows: mine.map((r) => ({ ...r, status: "ok" as const })), suspect: 0, unchecked: 0 };
      try {
        const inserted = await deps.recordFx(
          checked.rows.map((r) => ({ base: r.base, quote: r.quote, rate: r.rate.toFixed(), rateDate: r.rateDate, source, rawUnit: r.rawUnit, status: r.status })),
        );
        done(t, mine.length, inserted, checked.suspect, checked.unchecked);
      } catch (e) {
        failed(t, e);
      }
    }
  }

  // Yahoo and the BÉT: history and tails, one instrument at a time. The BÉT
  // gives closes only, so its splits are the ledger's; Yahoo's rate limit
  // stops Yahoo alone.
  let rateLimitedInARow = 0;
  const tripped = () => rateLimitedInARow >= RATE_LIMIT_TRIP;
  const yahooSplits = new Map<string, Split[]>();
  for (const t of tasks.filter((x): x is PriceTask => (x.source === "yahoo" || x.source === "bet") && x.kind !== "live")) {
    const inst = names.get(t.item);
    if (!inst) continue;
    const yahoo = t.source === "yahoo";
    if (yahoo && tripped()) {
      failed(t, new ProviderError("rate_limited"));
      continue;
    }
    try {
      let currency: string | null;
      // A BÉT close carries its own currency (a paper may change it); Yahoo's all have the history's.
      let bars: { day: Day; close: Dec; currency?: string }[];
      let splits: Split[];
      if (yahoo) {
        const h = await deps.yahoo.history(inst.symbol, t.from, t.to);
        rateLimitedInARow = 0;
        const ledger = deps.ledgerSplits(inst.id);
        splits = mergeSplits(ledger, h.splits);
        yahooSplits.set(inst.id, splits);
        for (const s of unrecordedSplits(h.splits, ledger, inst.firstDay)) {
          splitWarnings.push({ instrumentId: inst.id, name: inst.name, day: s.day, ratio: s.ratio.toFixed() });
        }
        [currency, bars] = [h.currency, h.bars];
      } else {
        const h = await deps.bet.history(inst.symbol, t.from, t.to);
        splits = deps.ledgerSplits(inst.id);
        [currency, bars] = [h.currency, h.bars];
      }
      if (currency === null) {
        // No data at all for the range (a listing the source has only from a later day): empty, not an error.
        done(t, 0, 0, 0);
        continue;
      }
      const own = bars.filter((b) => inRange(b.day, t));
      const statuses = classifySeries(
        await deps.priceBefore(inst.id, t.from),
        own.map((b) => ({ day: b.day, price: b.close, currency: b.currency ?? currency })),
        splits,
        inst.currency,
      );
      const inserted = await deps.recordQuotes(
        own.map((b, i) => ({ instrumentId: inst.id, price: b.close.toFixed(), currency: b.currency ?? currency, asOf: asOfForDay(b.day), source: t.source, status: statuses[i] })),
      );
      done(t, own.length, inserted, statuses.filter((st) => st === "suspect").length);
    } catch (e) {
      const err = failed(t, e);
      if (yahoo) rateLimitedInARow = err.errorClass === "http_429" ? rateLimitedInARow + 1 : 0;
    }
  }

  // Yahoo: live quotes, one batch.
  const live = tasks.filter((x): x is LiveTask => x.source === "yahoo" && x.kind === "live" && names.has(x.item));
  if (live.length > 0) {
    let quotes: Map<string, LiveQuote> | null = null;
    if (tripped()) {
      for (const t of live) failed(t, new ProviderError("rate_limited"));
    } else {
      try {
        quotes = await deps.yahoo.quotes([...new Set(live.map((t) => names.get(t.item)!.symbol))]);
      } catch (e) {
        for (const t of live) failed(t, e);
      }
    }
    for (const t of quotes ? live : []) {
      const inst = names.get(t.item)!;
      const q = quotes!.get(inst.symbol);
      if (!q) {
        failed(t, new ProviderError("symbol_not_found"));
        continue;
      }
      try {
        const day = dayOf(q.asOf);
        const before = await deps.priceBefore(inst.id, addDays(day, 1));
        let splits = yahooSplits.get(inst.id) ?? deps.ledgerSplits(inst.id);
        let [status] = classifySeries(before, [{ day, price: q.price, currency: q.currency }], splits, inst.currency);
        if (status === "suspect" && before && !yahooSplits.has(inst.id)) {
          // A jump may be a split this run has not seen yet: read the splits since the last price.
          splits = mergeSplits(deps.ledgerSplits(inst.id), await deps.yahoo.splitsSince(inst.symbol, before.day));
          [status] = classifySeries(before, [{ day, price: q.price, currency: q.currency }], splits, inst.currency);
        }
        const inserted = await deps.recordQuotes([{ instrumentId: inst.id, price: q.price.toFixed(), currency: q.currency, asOf: q.asOf, source: "yahoo", status }]);
        done(t, 1, inserted, status === "suspect" ? 1 : 0);
      } catch (e) {
        failed(t, e);
      }
    }
  }

  // ÁKK: the interest history, then each tab's list and the instruments on it.
  const akk = deps.akk;
  const akkTasks = tasks.filter((x): x is AkkTask => x.source === "akk");
  if (akk && akkTasks.length > 0) {
    const historySeries = [...new Set(akk.bonds.filter((b) => b.kind === "bmap" || b.kind === "pmap").map((b) => b.series))];
    let rates: AkkRate[] | null = null;
    const ratesTask = akkTasks.find((x) => x.item === "rates");
    if (ratesTask) {
      try {
        // Every BMÁP/PMÁP series is kept (a few hundred rows): a series bought later today has its periods too.
        const fetched = await akk.source.rates();
        done(ratesTask, fetched.length, await akk.recordRates(fetched), 0);
        rates = fetched;
      } catch (e) {
        failed(ratesTask, e);
      }
    }
    // Without today's history the stored one is used. If that cannot be read either (a database
    // error), the refresh goes on, but the BMÁP/PMÁP checks are left as they are (#33).
    let historyUnread = false;
    if (rates === null && historySeries.length > 0) {
      try {
        rates = await akk.storedRates(historySeries);
      } catch (e) {
        console.error("refresh: stored ÁKK rates", e instanceof Error ? e.message : e);
        historyUnread = true;
      }
    }

    const bondLog = (b: BondTerms, status: LogRow["status"], inserted: number, message: LogMessage | null) => {
      logs.push({ runId: deps.runId, source: "akk", item: b.instrumentId, kind: "live", rangeFrom: deps.today, rangeTo: deps.today, status, inserted, suspect: 0, unchecked: 0, message });
      if (status === "error" && message) errors.push({ source: "akk", item: b.instrumentId, name: b.name, message });
    };
    for (const t of akkTasks.filter((x) => x.item !== "rates")) {
      const tab = t.item as AkkTab;
      let rows: Map<string, AkkRow> | null = null;
      let unreadable = new Set<string>();
      let failure: ErrorClass | null = null;
      try {
        const list = await akk.source.prices(tab);
        rows = new Map(list.map((r) => [r.series, r]));
        unreadable = new Set(list.broken);
        done(t, list.length, 0, 0);
      } catch (e) {
        // Reported once per instrument below, not for the tab.
        failure = failed(t, e, false).errorClass;
      }
      for (const b of akk.bonds.filter((x) => x.tab === tab)) {
        const matured = deps.today >= b.maturity;
        if (!rows && !matured) {
          if (failure !== "budget" && failure !== "rate_limited") bondLog(b, "error", 0, failure);
          continue;
        }
        // Its row was there but unreadable: a parse error, not "not listed".
        if (unreadable.has(b.series) && !matured) {
          bondLog(b, "error", 0, "parse");
          continue;
        }
        try {
          const o = observe(b, rows ?? new Map(), (rates ?? []).filter((r) => r.series === b.series), deps.today);
          const inserted = o.quote ? await deps.recordQuotes([{ ...o.quote, status: "ok" }]) : 0;
          if (o.observation) await akk.recordObservations([o.observation]);
          const needsHistory = b.kind === "bmap" || b.kind === "pmap";
          if (o.check && !(historyUnread && needsHistory)) await akk.setChecks([{ instrumentId: b.instrumentId, status: o.check, day: deps.today }]);
          if (o.log === "not_listed" || o.log === "rule_mismatch") bondLog(b, "error", inserted, o.log);
          else bondLog(b, "ok", inserted, null);
        } catch (e) {
          bondLog(b, "error", 0, classify(e).errorClass);
        }
      }
    }
  }

  for (const s of skipped) {
    logs.push({ runId: deps.runId, source: s.source, item: s.item, kind: s.kind, rangeFrom: null, rangeTo: null, status: "skipped", inserted: 0, suspect: 0, unchecked: 0, message: null });
  }
  await deps.log(logs);

  const sources = (["MNB", "ECB", "yahoo", "bet", "akk"] as const)
    .map((source): SourceSummary => {
      const mine = logs.filter((l) => l.source === source);
      // For the ÁKK "inserted" means prices; the history rows it saved show in the log.
      const counted = mine.filter((l) => !(l.source === "akk" && l.kind === "history"));
      const sum = (k: "inserted" | "suspect" | "unchecked") => counted.reduce((a, l) => a + l[k], 0);
      return {
        source,
        items: new Set(mine.map((l) => l.item)).size,
        inserted: sum("inserted"),
        suspect: sum("suspect"),
        unchecked: sum("unchecked"),
        errors: mine.filter((l) => l.status === "error").length,
        skipped: mine.filter((l) => l.status === "skipped").length,
      };
    })
    .filter((s) => s.items > 0);
  const continued = logs.filter((l) => l.status === "skipped" && (l.message === "budget" || l.message === "rate_limited")).length;
  return { runId: deps.runId, sources, continued, errors, splitWarnings };
}
