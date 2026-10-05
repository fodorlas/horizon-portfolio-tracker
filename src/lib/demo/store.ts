import { z } from "zod";
import { DEMO_SEED } from "@/demo/seed";
import type { DemoCurrency, DemoState } from "@/demo/types";
import { D, isDay, todayInBudapest, type Dec } from "@/lib/finance/money";

export const DEMO_STORAGE_KEY = "horizon.demo.v1";

export type DemoStorage = Pick<Storage, "getItem" | "setItem">;
export type DemoTradeInput = {
  action: "buy" | "sell";
  accountId: string;
  assetId: string;
  units: string;
  price?: string;
  date?: string;
};

export type DemoTradeErrorCode = "invalid_trade" | "missing_account" | "missing_asset" | "missing_cash" | "insufficient_cash" | "insufficient_units";

export class DemoTradeError extends Error {
  constructor(readonly code: DemoTradeErrorCode) {
    super(code);
    this.name = "DemoTradeError";
  }
}

export type DemoSessionSnapshot = { state: DemoState; storageAvailable: boolean };
export type DemoSessionStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => DemoSessionSnapshot;
  getServerSnapshot: () => DemoSessionSnapshot;
  hydrate: (storage: DemoStorage | null) => void;
  update: (state: DemoState, storage: DemoStorage | null) => void;
  reset: (storage: DemoStorage | null) => void;
};

const SERVER_SNAPSHOT: DemoSessionSnapshot = { state: DEMO_SEED, storageAvailable: true };

/** A per-render session store; it keeps no visitor state in server module scope. */
export function createDemoSessionStore(): DemoSessionStore {
  let snapshot: DemoSessionSnapshot = { state: copySeed(), storageAvailable: true };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_SNAPSHOT,
    hydrate(storage) {
      snapshot = { state: readDemoState(storage), storageAvailable: storage !== null };
      notify();
    },
    update(state, storage) {
      snapshot = { state, storageAvailable: writeDemoState(storage, state) };
      notify();
    },
    reset(storage) {
      const state = copySeed();
      snapshot = { state, storageAvailable: writeDemoState(storage, state) };
      notify();
    },
  };
}

const currency = z.enum(["HUF", "EUR", "USD"]);
const numericText = z.string().refine((value) => {
  try {
    return value.trim() !== "" && new D(value).isFinite();
  } catch {
    return false;
  }
});
const schema = z.object({
  version: z.literal(1),
  locale: z.enum(["en", "hu"]),
  displayCurrency: currency,
  ratesToHuf: z.object({ HUF: numericText, EUR: numericText, USD: numericText }),
  institutions: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
  accounts: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), institutionId: z.string().min(1) })),
  assets: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), ticker: z.string().min(1),
    kind: z.enum(["stock", "etf", "bond", "other"]), currency, marketPrice: numericText,
  })),
  cash: z.array(z.object({ accountId: z.string().min(1), currency, amount: numericText })),
  positions: z.array(z.object({ accountId: z.string().min(1), assetId: z.string().min(1), units: numericText })),
  transactions: z.array(z.object({
    id: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    action: z.enum(["buy", "sell", "deposit", "dividend", "interest"]),
    accountId: z.string().min(1), assetId: z.string().nullable(), units: numericText.nullable(), price: numericText.nullable(), currency,
  })),
  history: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), totalHuf: numericText })),
});

function copySeed(): DemoState {
  return structuredClone(DEMO_SEED);
}

function parseState(value: unknown): DemoState | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return null;
  const state = parsed.data as DemoState;
  const institutionIds = new Set(state.institutions.map((row) => row.id));
  const accountIds = new Set(state.accounts.map((row) => row.id));
  const assetIds = new Set(state.assets.map((row) => row.id));
  const cashKeys = state.cash.map((row) => `${row.accountId}:${row.currency}`);
  const positionKeys = state.positions.map((row) => `${row.accountId}:${row.assetId}`);
  if (institutionIds.size !== state.institutions.length || accountIds.size !== state.accounts.length || assetIds.size !== state.assets.length) return null;
  if (state.accounts.some((row) => !institutionIds.has(row.institutionId))) return null;
  if (new Set(cashKeys).size !== cashKeys.length || state.cash.some((row) => !accountIds.has(row.accountId) || new D(row.amount).lt(0))) return null;
  if (new Set(positionKeys).size !== positionKeys.length || state.positions.some((row) => !accountIds.has(row.accountId) || !assetIds.has(row.assetId) || new D(row.units).lte(0))) return null;
  if (state.transactions.some((row) => !isDay(row.date) || !accountIds.has(row.accountId) || (row.assetId !== null && !assetIds.has(row.assetId)))) return null;
  if (state.assets.some((row) => new D(row.marketPrice).lte(0))) return null;
  if (Object.values(state.ratesToHuf).some((rate) => new D(rate).lte(0))) return null;
  if (state.history.some((row) => !isDay(row.date))) return null;
  return state;
}

/** Read tab-scoped state; malformed or unavailable storage safely falls back to fictional seed data. */
export function readDemoState(storage: DemoStorage | null): DemoState {
  if (!storage) return copySeed();
  try {
    const raw = storage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return copySeed();
    const parsed: unknown = JSON.parse(raw);
    return parseState(parsed) ?? copySeed();
  } catch {
    return copySeed();
  }
}

/** Persist to sessionStorage when available. Storage errors do not interrupt the in-memory demo. */
export function writeDemoState(storage: DemoStorage | null, state: DemoState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // The UI can continue with its in-memory state when browser storage is blocked or full.
    return false;
  }
}

/** Restore the deterministic seed and persist it for the remainder of this tab session. */
export function resetDemoState(storage: DemoStorage | null): DemoState {
  const state = copySeed();
  writeDemoState(storage, state);
  return state;
}

/** Portfolio value in the selected display currency, using only bundled sample rates and prices. */
export function portfolioValue(state: DemoState, displayCurrency: DemoCurrency) {
  const targetRate = new D(state.ratesToHuf[displayCurrency]);
  let totalHuf = new D(0);
  for (const row of state.cash) totalHuf = totalHuf.plus(new D(row.amount).times(state.ratesToHuf[row.currency]));
  for (const row of state.positions) {
    const asset = state.assets.find((item) => item.id === row.assetId);
    if (asset) totalHuf = totalHuf.plus(new D(row.units).times(asset.marketPrice).times(state.ratesToHuf[asset.currency]));
  }
  return totalHuf.div(targetRate);
}

/** Apply a fictional trade immutably and enforce the account's cash and position limits. */
export function executeDemoTrade(state: DemoState, trade: DemoTradeInput): DemoState {
  const account = state.accounts.find((row) => row.id === trade.accountId);
  if (!account) throw new DemoTradeError("missing_account");
  const asset = state.assets.find((row) => row.id === trade.assetId);
  if (!asset) throw new DemoTradeError("missing_asset");
  let units: Dec;
  let price: Dec;
  try {
    units = new D(trade.units);
    price = new D(trade.price ?? asset.marketPrice);
  } catch {
    throw new DemoTradeError("invalid_trade");
  }
  if (!units.isFinite() || !price.isFinite() || units.lte(0) || price.lte(0)) throw new DemoTradeError("invalid_trade");

  const cashIndex = state.cash.findIndex((row) => row.accountId === account.id && row.currency === asset.currency);
  if (cashIndex < 0) throw new DemoTradeError("missing_cash");
  const positionIndex = state.positions.findIndex((row) => row.accountId === account.id && row.assetId === asset.id);
  const currentUnits = new D(positionIndex < 0 ? "0" : state.positions[positionIndex].units);
  const currentCash = new D(state.cash[cashIndex].amount);
  const tradeValue = units.times(price);

  if (trade.action === "buy" && currentCash.lt(tradeValue)) throw new DemoTradeError("insufficient_cash");
  if (trade.action === "sell" && currentUnits.lt(units)) throw new DemoTradeError("insufficient_units");

  const next = copyState(state);
  const direction = trade.action === "buy" ? -1 : 1;
  next.cash[cashIndex].amount = currentCash.plus(tradeValue.times(direction)).toFixed();
  const updatedUnits = currentUnits.plus(trade.action === "buy" ? units : units.negated());
  if (positionIndex < 0 && trade.action === "buy") next.positions.push({ accountId: account.id, assetId: asset.id, units: updatedUnits.toFixed() });
  else if (positionIndex >= 0 && updatedUnits.isZero()) next.positions.splice(positionIndex, 1);
  else if (positionIndex >= 0) next.positions[positionIndex].units = updatedUnits.toFixed();

  next.transactions.unshift({
    id: `demo-${next.transactions.length + 1}`,
    date: trade.date ?? todayInBudapest(),
    action: trade.action,
    accountId: account.id,
    assetId: asset.id,
    units: units.toFixed(),
    price: price.toFixed(),
    currency: asset.currency,
  });
  return next;
}

function copyState(state: DemoState): DemoState {
  return structuredClone(state);
}
