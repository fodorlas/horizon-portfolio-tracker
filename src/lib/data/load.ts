import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FxRow } from "@/lib/finance/fx";
import type { CostFxRefs, LedgerEvent, Line } from "@/lib/finance/ledger";
import { D, type Day } from "@/lib/finance/money";
import type { ManualValuation, PriceQuote } from "@/lib/finance/prices";
import type { AssetClass, Instrument, PortfolioData } from "@/lib/finance/valuation";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Loads everything the pages need, through the user's own session (RLS), and
 * maps it onto the finance core's types. Pages then compute on the server.
 */

type Db = SupabaseClient<Database>;
type Tables = Database["public"]["Tables"];

export type InstitutionMeta = Tables["institutions"]["Row"];
export type AccountMeta = Tables["accounts"]["Row"];
export type InstrumentMeta = Tables["instruments"]["Row"];
type Text<T, K extends keyof T> = Omit<T, K> & { [P in K]: string };
export type QuoteRow = Text<Tables["price_quotes"]["Row"], "price">;
export type ValuationRow = Text<Tables["manual_valuations"]["Row"], "value">;
export type FxRateRow = Text<Tables["fx_rates"]["Row"], "rate">;

export type Loaded = PortfolioData & {
  institutions: InstitutionMeta[];
  accountMeta: AccountMeta[];
  instrumentMeta: InstrumentMeta[];
  /** The logs as stored (notes, entry times) for the price and FX pages. */
  logs: { quotes: QuoteRow[]; valuations: ValuationRow[]; fx: FxRateRow[] };
  /** Event id → entry id, for the events the simple form recorded (4c). */
  eventEntries: Map<string, string>;
  /**
   * When the read behind this view began (ISO): what changed after it, such as a
   * send-back in another tab, is not in it. The proposal sync keeps those (#92).
   */
  readAt: string;
};

const PAGE = 1000; // PostgREST max_rows

/** Fetches every row of a query, page by page. */
export async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

const QUOTE_COLUMNS = "id, owner_id, instrument_id, price::text, currency, as_of, entered_at, source, status, supersedes_id, note, entry_id";

export type LoadOptions = {
  /**
   * Prices are needed from this day on only: that window plus the price that
   * wins just before it per instrument (public.price_quotes_from). Daily
   * closes add up to years of rows; the choice for any day from `pricesFrom`
   * on is the same as with the full log (tests/rls/refresh.test.ts). FX rows
   * are always loaded in full: the ledger converts old sales at their own day.
   */
  pricesFrom?: Day;
};

/**
 * Each table is its own request, so a save or a delete made meanwhile (another
 * tab, another device) can land between two reads: an event without its lines,
 * a line of an account not read. The finance core cannot work on such a view
 * (it read `lines[0]` of an empty event: a 500, #92), so it is read again.
 */
export const READ_ATTEMPTS = 3;

type GapRows = {
  accounts: { id: string }[];
  instruments: { id: string }[];
  events: { id: string }[];
  lines: { event_id: string; account_id: string; instrument_id: string | null }[];
  valuations: { account_id: string; instrument_id: string }[];
};

/** Why the rows of separate reads do not fit together, or null. A committed state always fits. */
export function readGap(r: GapRows): string | null {
  const events = new Set(r.events.map((e) => e.id));
  const accounts = new Set(r.accounts.map((a) => a.id));
  const instruments = new Set(r.instruments.map((i) => i.id));
  const withLines = new Set<string>();
  for (const l of r.lines) {
    if (!events.has(l.event_id)) return "a line of an event not read";
    if (!accounts.has(l.account_id)) return "a line of an account not read";
    if (l.instrument_id !== null && !instruments.has(l.instrument_id)) return "a line of an instrument not read";
    withLines.add(l.event_id);
  }
  if (r.events.some((e) => !withLines.has(e.id))) return "an event without lines";
  for (const v of r.valuations) {
    if (!accounts.has(v.account_id)) return "a value of an account not read";
    if (!instruments.has(v.instrument_id)) return "a value of an instrument not read";
  }
  return null;
}

/** Reads until the view fits together, at most READ_ATTEMPTS times. */
export async function consistentRead<T>(read: () => Promise<T>, gap: (rows: T) => string | null): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const rows = await read();
    const problem = gap(rows);
    if (problem === null) return rows;
    if (attempt === READ_ATTEMPTS) throw new Error(`loadPortfolio: inconsistent read after ${READ_ATTEMPTS} attempts (${problem})`);
    console.warn(`loadPortfolio: read again (${problem})`);
  }
}

export async function loadPortfolio(db: Db, opts: LoadOptions = {}): Promise<Loaded> {
  return assemble(await consistentRead(async () => ({ readAt: new Date().toISOString(), ...(await readRows(db, opts)) }), readGap));
}

async function readRows(db: Db, opts: LoadOptions) {
  // numeric columns are read as text: JSON numbers would round beyond ~15 digits.
  const [institutions, accounts, instruments, events, lines, quotes, valuations, fx] = await Promise.all([
    all((a, b) => db.from("institutions").select("*").order("name").range(a, b)),
    all((a, b) => db.from("accounts").select("*").order("name").range(a, b)),
    all((a, b) => db.from("instruments").select("*").order("name").range(a, b)),
    all((a, b) =>
      db
        .from("events")
        .select("id, owner_id, event_type, event_date, correction_kind, split_ratio::text, note, created_at, entry_id")
        .order("event_date")
        .order("created_at")
        .order("id")
        .range(a, b),
    ),
    all((a, b) =>
      db
        .from("lines")
        .select("id, event_id, account_id, instrument_id, kind, currency, amount::text, role, cost_amount::text, cost_estimated, cost_fx_refs")
        .order("id")
        .range(a, b),
    ),
    all((a, b) =>
      (opts.pricesFrom
        ? db.rpc("price_quotes_from", { p_from: opts.pricesFrom }).select(QUOTE_COLUMNS)
        : db.from("price_quotes").select(QUOTE_COLUMNS)
      )
        .order("as_of")
        .order("id")
        .range(a, b),
    ),
    all((a, b) =>
      db
        .from("manual_valuations")
        .select("id, owner_id, account_id, instrument_id, value::text, currency, as_of, entered_at, source, status, supersedes_id, note, entry_id")
        .order("as_of")
        .range(a, b),
    ),
    all((a, b) =>
      db
        .from("fx_rates")
        .select("id, base, quote, rate::text, rate_date, source, raw_unit, status, supersedes_id, note, fetched_at, event_id")
        .order("rate_date")
        .range(a, b),
    ),
  ]);
  return { institutions, accounts, instruments, events, lines, quotes, valuations, fx };
}

function assemble({ readAt, institutions, accounts, instruments, events, lines, quotes, valuations, fx }: Awaited<ReturnType<typeof readRows>> & { readAt: string }): Loaded {

  const linesByEvent = new Map<string, Line[]>();
  for (const l of lines) {
    const list = linesByEvent.get(l.event_id) ?? [];
    list.push({
      id: l.id,
      kind: l.kind as Line["kind"],
      accountId: l.account_id,
      instrumentId: l.instrument_id,
      currency: l.currency,
      amount: new D(l.amount),
      role: l.role as Line["role"],
      costAmount: l.cost_amount === null ? null : new D(l.cost_amount),
      costEstimated: l.cost_estimated,
      costFxRefs: (l.cost_fx_refs as CostFxRefs | null) ?? null,
    });
    linesByEvent.set(l.event_id, list);
  }

  const ledger: LedgerEvent[] = events.map((e) => ({
    id: e.id,
    type: e.event_type as LedgerEvent["type"],
    date: e.event_date,
    createdAt: e.created_at,
    correctionKind: e.correction_kind as LedgerEvent["correctionKind"],
    splitRatio: e.split_ratio === null ? null : new D(e.split_ratio),
    note: e.note,
    lines: linesByEvent.get(e.id) ?? [],
  }));

  const instrumentList: Instrument[] = instruments.map((i) => ({
    id: i.id,
    name: i.name,
    assetClass: i.asset_class as AssetClass,
    currency: i.currency,
    valuation: i.valuation as Instrument["valuation"],
    priceSource: i.price_source,
    staleAfterDays: i.stale_after_days,
  }));

  const priceQuotes: PriceQuote[] = quotes.map((q) => ({
    id: q.id, instrumentId: q.instrument_id, price: q.price, currency: q.currency, asOf: q.as_of,
    enteredAt: q.entered_at, source: q.source, status: q.status as PriceQuote["status"], supersedesId: q.supersedes_id,
  }));

  const manual: ManualValuation[] = valuations.map((v) => ({
    id: v.id, accountId: v.account_id, instrumentId: v.instrument_id, value: v.value, currency: v.currency, asOf: v.as_of,
    enteredAt: v.entered_at, source: v.source, status: "ok", supersedesId: v.supersedes_id,
  }));

  const fxRows: FxRow[] = fx.map((r) => ({
    id: r.id, base: r.base, quote: r.quote, rate: r.rate, rateDate: r.rate_date, source: r.source as FxRow["source"],
    status: r.status as FxRow["status"], supersedesId: r.supersedes_id, fetchedAt: r.fetched_at,
  }));

  return {
    accounts: accounts.map((a) => ({ id: a.id, trackingStart: a.tracking_start_date })),
    instruments: instrumentList,
    events: ledger,
    quotes: priceQuotes,
    valuations: manual,
    fxRows,
    institutions,
    accountMeta: accounts,
    instrumentMeta: instruments,
    logs: { quotes, valuations, fx },
    eventEntries: new Map(events.flatMap((e) => (e.entry_id ? [[e.id, e.entry_id] as const] : []))),
    readAt,
  };
}
