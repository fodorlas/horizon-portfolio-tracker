/**
 * The database facts the entry builder needs (EntryContext), from what the
 * pages load. An edited entry is left out of its own context: its holding,
 * its total and its opening balance must not count against its new version.
 */
import type { Loaded } from "@/lib/data/load";
import { runLedger } from "@/lib/finance/ledger";
import { D, type Day } from "@/lib/finance/money";
import { type ManualValuation, selectValuation } from "@/lib/finance/prices";
import { fxFnFromRows } from "@/lib/finance/valuation";
import type { Locale } from "@/lib/prefs-shared";
import type { AkkRow } from "@/lib/providers/akk";
import type { SymbolInfo } from "@/lib/providers/symbols";
import type { EntryContext } from "./build";
import { availableFrom, cashKey, cashTimeline } from "./cash";

export function entryContext(
  data: Loaded,
  opts: {
    today: Day;
    symbols: Map<string, SymbolInfo | null>;
    betSymbols?: Map<string, SymbolInfo | null>;
    newId: () => string;
    entryId?: string;
    akk?: Map<string, AkkRow | null>;
    bondMaturity?: Map<string, Day>;
    /** The language the form was filled in (spec 2026-10-01 §2.5). */
    locale: Locale;
  },
): EntryContext {
  const { entryId } = opts;
  const events = data.events.filter((e) => entryId === undefined || data.eventEntries.get(e.id) !== entryId);
  const valuations: ManualValuation[] = data.logs.valuations
    .filter((v) => entryId === undefined || v.entry_id !== entryId)
    .map((v) => ({
      id: v.id, accountId: v.account_id, instrumentId: v.instrument_id, value: v.value, currency: v.currency, asOf: v.as_of,
      enteredAt: v.entered_at, source: v.source, status: "ok", supersedesId: v.supersedes_id,
    }));
  const fx = fxFnFromRows(data.fxRows);
  const timeline = cashTimeline(events);
  const opened = new Set(events.filter((e) => e.type === "opening_balance").flatMap((e) => e.lines.map((l) => l.accountId)));
  const matured = new Map(
    events.filter((e) => e.type === "maturity").flatMap((e) => e.lines.filter((l) => l.kind === "position").map((l) => [`${l.accountId}|${l.instrumentId}`, e.date] as const)),
  );

  return {
    today: opts.today,
    locale: opts.locale,
    institutions: new Set(data.institutions.map((i) => i.id)),
    accounts: new Map(data.accountMeta.map((a) => [a.id, { institutionId: a.institution_id, trackingStart: a.tracking_start_date, hasOpening: opened.has(a.id) }])),
    instruments: new Map(
      data.instrumentMeta.map((i) => [
        i.id,
        { name: i.name, currency: i.currency, valuation: i.valuation as "market" | "manual", priceSource: i.price_source, symbol: i.provider_symbol },
      ]),
    ),
    fxRows: data.fxRows,
    holding: (accountId, instrumentId, day) => runLedger(events, fx, day).positions.get(`${accountId}|${instrumentId}`)?.qty ?? new D(0),
    valueOn: (accountId, instrumentId, day) => {
      const v = selectValuation(valuations, accountId, instrumentId, day);
      return v ? new D(v.value) : null;
    },
    maturityBooked: (accountId, instrumentId) => matured.get(`${accountId}|${instrumentId}`) ?? null,
    availableCash: (accountId, currency, day) => availableFrom(timeline.get(cashKey(accountId, currency)), day),
    symbols: opts.symbols,
    betSymbols: opts.betSymbols ?? new Map(),
    akk: opts.akk,
    bondMaturity: opts.bondMaturity,
    newId: opts.newId,
    entryId,
  };
}
