import { DEMO_SEED } from "./seed";
import type { DemoTransaction } from "./types";
import { addDays, D, isWeekday, todayInBudapest, type Day, type Dec } from "@/lib/finance/money";
import type { LedgerEvent, Line } from "@/lib/finance/ledger";
import type { Loaded } from "@/lib/data/load";

const OWNER = "demo-owner";
const TRACKING_START = "2025-10-01" as Day;
const ENTRY_TIME = "T12:00:00.000Z";

function add<K>(map: Map<K, Dec>, key: K, value: Dec) {
  map.set(key, (map.get(key) ?? new D(0)).plus(value));
}

function event(id: string, type: LedgerEvent["type"], date: Day, lines: Line[]): LedgerEvent {
  return { id, type, date, createdAt: `${date}${ENTRY_TIME}`, correctionKind: null, splitRatio: null, note: null, lines };
}

function line(
  id: string,
  kind: Line["kind"],
  accountId: string,
  currency: string,
  amount: Dec,
  role: Line["role"],
  options: Pick<Line, "instrumentId" | "costAmount" | "costEstimated"> = { instrumentId: null, costAmount: null, costEstimated: false },
): Line {
  return { id, kind, accountId, currency, amount, role, costFxRefs: null, ...options };
}

function transactionEffects(tx: DemoTransaction) {
  const amount = tx.price === null ? new D(0) : new D(tx.price);
  const quantity = tx.units === null ? new D(0) : new D(tx.units);
  if (tx.action === "buy") return { cash: amount.times(quantity).negated(), units: quantity };
  if (tx.action === "sell") return { cash: amount.times(quantity), units: quantity.negated() };
  if (tx.action === "deposit") return { cash: tx.accountId === "account-bet" ? new D(1_000_000) : new D(0), units: new D(0) };
  return { cash: amount, units: new D(0) };
}

function transactionEvent(tx: DemoTransaction): LedgerEvent {
  const effects = transactionEffects(tx);
  const lines: Line[] = [];
  if (tx.action === "buy" || tx.action === "sell") {
    const units = new D(tx.units!);
    const price = new D(tx.price!);
    const isBuy = tx.action === "buy";
    lines.push(line(`${tx.id}-position`, "position", tx.accountId, tx.currency, isBuy ? units : units.negated(), "trade", {
      instrumentId: tx.assetId,
      costAmount: isBuy ? units.times(price) : null,
      costEstimated: false,
    }));
    lines.push(line(`${tx.id}-cash`, "cash", tx.accountId, tx.currency, effects.cash, "trade"));
  } else {
    lines.push(line(`${tx.id}-cash`, "cash", tx.accountId, tx.currency, effects.cash, tx.action === "deposit" ? "external" : "income", {
      instrumentId: tx.assetId,
      costAmount: null,
      costEstimated: false,
    }));
  }
  return event(tx.id, tx.action === "buy" || tx.action === "sell" ? tx.action : tx.action === "deposit" ? "deposit" : tx.action, tx.date as Day, lines);
}

/** A stable view of the existing Horizon pages, backed only by the fictional seed. */
export function demoPortfolio(today: Day = todayInBudapest()): Loaded {
  const institutionMeta = DEMO_SEED.institutions.map((institution) => ({
    id: institution.id, owner_id: OWNER, name: institution.name, created_at: `${TRACKING_START}T00:00:00.000Z`,
  }));
  const accountMeta = DEMO_SEED.accounts.map((account) => ({
    id: account.id,
    owner_id: OWNER,
    institution_id: account.institutionId,
    name: account.name,
    account_type: "normal",
    tracking_start_date: TRACKING_START,
    created_at: `${TRACKING_START}T00:00:00.000Z`,
  }));
  const instrumentMeta = DEMO_SEED.assets.map((asset) => ({
    id: asset.id,
    owner_id: OWNER,
    name: asset.name,
    ticker: asset.ticker,
    isin: null,
    exchange: null,
    asset_class: asset.kind,
    currency: asset.currency,
    valuation: asset.kind === "other" ? "manual" : "market",
    price_source: "manual",
    provider_symbol: null,
    stale_after_days: null,
    created_at: `${TRACKING_START}T00:00:00.000Z`,
  }));

  const cashEffects = new Map<string, Dec>();
  const unitEffects = new Map<string, Dec>();
  for (const tx of DEMO_SEED.transactions) {
    const effects = transactionEffects(tx);
    add(cashEffects, `${tx.accountId}|${tx.currency}`, effects.cash);
    if (tx.assetId) add(unitEffects, `${tx.accountId}|${tx.assetId}`, effects.units);
  }

  const openingLinesByAccount = new Map<string, Line[]>();
  let lineNumber = 0;
  const openingLines = (accountId: string) => {
    const rows = openingLinesByAccount.get(accountId) ?? [];
    openingLinesByAccount.set(accountId, rows);
    return rows;
  };
  const targetCash = new Map(DEMO_SEED.cash.map((row) => [`${row.accountId}|${row.currency}`, new D(row.amount)]));
  for (const [key, amount] of targetCash) {
    const [accountId, currency] = key.split("|");
    const openingAmount = amount.minus(cashEffects.get(key) ?? new D(0));
    if (openingAmount.gt(0)) openingLines(accountId).push(line(`demo-opening-${++lineNumber}`, "cash", accountId, currency, openingAmount, "opening"));
  }

  const targetUnits = new Map(DEMO_SEED.positions.map((row) => [`${row.accountId}|${row.assetId}`, new D(row.units)]));
  const assets = new Map(DEMO_SEED.assets.map((asset) => [asset.id, asset]));
  for (const [key, quantity] of targetUnits) {
    const [accountId, assetId] = key.split("|");
    const asset = assets.get(assetId)!;
    const openingQuantity = quantity.minus(unitEffects.get(key) ?? new D(0));
    if (openingQuantity.gt(0)) openingLines(accountId).push(line(`demo-opening-${++lineNumber}`, "position", accountId, asset.currency, openingQuantity, "opening", {
      instrumentId: assetId,
      costAmount: openingQuantity.times(new D(asset.marketPrice)),
      costEstimated: true,
    }));
  }

  const events = [
    ...DEMO_SEED.accounts.map((account) => event(`demo-opening-${account.id}`, "opening_balance", TRACKING_START, openingLines(account.id))),
    ...DEMO_SEED.transactions.map(transactionEvent),
  ];
  const eventEntries = new Map(DEMO_SEED.transactions
    .filter((tx) => tx.action === "buy" || tx.action === "sell")
    .map((tx) => [tx.id, tx.id] as const));

  const history = DEMO_SEED.history;
  const lastHistory = new D(history.at(-1)!.totalHuf);
  const historyScale = (day: Day) => {
    const nextIndex = history.findIndex((point) => point.date >= day);
    if (nextIndex === 0) return new D(history[0].totalHuf).div(lastHistory);
    if (nextIndex === -1) return new D(1);
    const before = history[nextIndex - 1];
    const after = history[nextIndex];
    const days = Math.max(1, Date.parse(`${after.date}T00:00:00Z`) - Date.parse(`${before.date}T00:00:00Z`));
    const elapsed = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${before.date}T00:00:00Z`);
    const progress = new D(elapsed).div(days);
    return new D(before.totalHuf).plus(new D(after.totalHuf).minus(before.totalHuf).times(progress)).div(lastHistory);
  };
  const sampleScale = (day: Day) => {
    const elapsed = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${TRACKING_START}T00:00:00Z`);
    const index = elapsed / 86_400_000;
    const movement = 1 + Math.sin(index / 2.6) * 0.0012 + Math.sin(index / 8.3) * 0.0015;
    return historyScale(day).times(movement);
  };
  const quoteDates: Day[] = [];
  for (let day = TRACKING_START; day <= today; day = addDays(day, 1)) {
    if (isWeekday(day) || day === today) quoteDates.push(day);
  }
  const quoteRows: Loaded["logs"]["quotes"] = [];
  const valuationRows: Loaded["logs"]["valuations"] = [];
  for (const asset of DEMO_SEED.assets) {
    for (const day of quoteDates) {
      const value = new D(asset.marketPrice).times(day === today ? 1 : sampleScale(day)).toFixed();
      const id = `demo-price-${asset.id}-${day}`;
      if (asset.kind === "other") {
        valuationRows.push({
          id, owner_id: OWNER, account_id: "account-bank", instrument_id: asset.id, value,
          currency: asset.currency, as_of: `${day}T12:00:00.000Z`, entered_at: `${day}T12:00:00.000Z`,
          source: "manual", status: "ok", supersedes_id: null, note: null, entry_id: null,
        });
      } else {
        quoteRows.push({
          id, owner_id: OWNER, instrument_id: asset.id, price: value, currency: asset.currency,
          as_of: `${day}T12:00:00.000Z`, entered_at: `${day}T12:00:00.000Z`,
          source: "manual", status: "ok", supersedes_id: null, note: null, entry_id: null,
        });
      }
    }
  }

  const fxRows: Loaded["logs"]["fx"] = [];
  for (const date of quoteDates) {
    for (const [base, rate] of [["EUR", DEMO_SEED.ratesToHuf.EUR], ["USD", DEMO_SEED.ratesToHuf.USD]] as const) {
      fxRows.push({
        id: `demo-fx-${base}-${date}`, base, quote: "HUF", rate, rate_date: date,
        source: "manual", raw_unit: 1, status: "ok", supersedes_id: null, note: null,
        fetched_at: `${date}T12:00:00.000Z`, event_id: null,
      });
    }
  }

  return {
    accounts: DEMO_SEED.accounts.map((account) => ({ id: account.id, trackingStart: TRACKING_START })),
    instruments: DEMO_SEED.assets.map((asset) => ({
      id: asset.id, name: asset.name, assetClass: asset.kind, currency: asset.currency,
      valuation: asset.kind === "other" ? "manual" : "market", priceSource: "manual", staleAfterDays: null,
    })),
    events,
    quotes: quoteRows.map((row) => ({ id: row.id, instrumentId: row.instrument_id, price: row.price, currency: row.currency, asOf: row.as_of, enteredAt: row.entered_at, source: row.source, status: "ok", supersedesId: row.supersedes_id })),
    valuations: valuationRows.map((row) => ({ id: row.id, accountId: row.account_id, instrumentId: row.instrument_id, value: row.value, currency: row.currency, asOf: row.as_of, enteredAt: row.entered_at, source: row.source, status: "ok", supersedesId: row.supersedes_id })),
    fxRows: fxRows.map((row) => ({ id: row.id, base: row.base, quote: row.quote, rate: row.rate, rateDate: row.rate_date as Day, source: "manual", status: "ok", supersedesId: row.supersedes_id, fetchedAt: row.fetched_at })),
    institutions: institutionMeta,
    accountMeta,
    instrumentMeta,
    logs: { quotes: quoteRows, valuations: valuationRows, fx: fxRows },
    eventEntries,
    readAt: `${today}T12:00:00.000Z`,
  };
}
