export type DemoCurrency = "HUF" | "EUR" | "USD";
export type DemoAssetKind = "stock" | "etf" | "bond" | "other";

export type DemoInstitution = { id: string; name: string };
export type DemoAccount = { id: string; name: string; institutionId: string };
export type DemoAsset = {
  id: string;
  name: string;
  ticker: string;
  kind: DemoAssetKind;
  currency: DemoCurrency;
  marketPrice: string;
};
export type DemoCash = { accountId: string; currency: DemoCurrency; amount: string };
export type DemoPosition = { accountId: string; assetId: string; units: string };
export type DemoTransaction = {
  id: string;
  date: string;
  action: "buy" | "sell" | "deposit" | "dividend" | "interest";
  accountId: string;
  assetId: string | null;
  units: string | null;
  price: string | null;
  currency: DemoCurrency;
};
export type DemoHistoryPoint = { date: string; totalHuf: string };

export type DemoState = {
  version: 1;
  locale: "en" | "hu";
  displayCurrency: DemoCurrency;
  ratesToHuf: Record<DemoCurrency, string>;
  institutions: DemoInstitution[];
  accounts: DemoAccount[];
  assets: DemoAsset[];
  cash: DemoCash[];
  positions: DemoPosition[];
  transactions: DemoTransaction[];
  history: DemoHistoryPoint[];
};
