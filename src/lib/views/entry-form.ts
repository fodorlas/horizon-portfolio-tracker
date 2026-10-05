/**
 * What the simple form offers (4c plan §2): brokers, accounts, instruments
 * (with the Yahoo symbol when Yahoo prices them, so a search hit can be
 * matched), today's holdings for the sale tab, the cash a buy may take and
 * the currencies to pick.
 */
import type { Loaded } from "@/lib/data/load";
import { cashTimeline } from "@/lib/entry/cash";
import { type LedgerEvent, runLedger } from "@/lib/finance/ledger";
import type { Day } from "@/lib/finance/money";
import { selectValuation } from "@/lib/finance/prices";
import { fxFnFromRows } from "@/lib/finance/valuation";

/** Common currencies first; any currency already in use is offered too. */
export const COMMON_CURRENCIES = ["HUF", "EUR", "USD", "GBP", "CHF", "PLN", "CZK", "SEK", "NOK", "DKK", "JPY", "CAD", "AUD"];

export function currenciesOf(data: Pick<Loaded, "instrumentMeta" | "events">): string[] {
  const used = [...data.instrumentMeta.map((i) => i.currency), ...data.events.flatMap((e) => e.lines.map((l) => l.currency))];
  return [...new Set([...COMMON_CURRENCIES, ...used])];
}

export function entryFormData(data: Loaded, today: Day, entryId?: string) {
  // The cash a buy may take (cash.ts): an edited entry does not count against its new version.
  const own = (e: LedgerEvent) => entryId !== undefined && data.eventEntries.get(e.id) === entryId;
  const timeline = cashTimeline(data.events.filter((e) => !own(e)));
  const valuation = new Map(data.instrumentMeta.map((i) => [i.id, i.valuation]));
  const positions = runLedger(data.events, fxFnFromRows(data.fxRows), today).positions;
  return {
    institutions: data.institutions.map((i) => ({ id: i.id, name: i.name })),
    accounts: data.accountMeta.map((a) => ({ id: a.id, institutionId: a.institution_id, name: a.name, trackingStart: a.tracking_start_date })),
    instruments: data.instrumentMeta.map((i) => ({
      id: i.id,
      name: i.name,
      label: i.ticker ? `${i.name} (${i.ticker})` : i.name,
      currency: i.currency,
      valuation: i.valuation as "market" | "manual",
      symbol: i.price_source === "yahoo" || i.price_source === "bet" || i.price_source === "akk" ? i.provider_symbol : null,
      source: i.price_source,
    })),
    holdings: [...positions.values()]
      .filter((p) => !p.qty.isZero())
      .map((p) => ({
        accountId: p.accountId,
        instrumentId: p.instrumentId,
        quantity: p.qty.toFixed(),
        value: valuation.get(p.instrumentId) === "manual" ? (selectValuation(data.valuations, p.accountId, p.instrumentId, today)?.value.toString() ?? null) : null,
      })),
    cash: [...timeline].map(([key, steps]) => {
      const [accountId, currency] = key.split("|");
      return { accountId, currency, steps };
    }),
    currencies: currenciesOf(data),
    today,
  };
}
