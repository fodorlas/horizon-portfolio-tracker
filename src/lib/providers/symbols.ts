/**
 * What a Yahoo symbol search and lookup give the simple form (4c plan §2).
 * Plain strings, so a server action can hand them to the browser as they are.
 */
import type { AssetClass } from "@/lib/finance/valuation";
import type { Day } from "@/lib/finance/money";

/** `source`: where the hit came from – a Yahoo symbol or a BÉT code (spec 2026-09-28 §12/3). */
export type SearchHit = { symbol: string; name: string; exchange: string | null; assetClass: AssetClass; source: "yahoo" | "bet" };

export type SymbolInfo = {
  symbol: string;
  name: string;
  /** As Yahoo reports it: may be a non-ISO unit such as "GBp". */
  currency: string;
  assetClass: AssetClass;
  exchange: string | null;
  /** The last close on or before the asked day, if any. */
  close: { day: Day; price: string } | null;
};
