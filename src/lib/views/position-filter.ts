/**
 * The Positions page's filter (the owner's request, 2026-09-30): by account,
 * kind, currency and a part of the name or code, applied on the Szűrés
 * button (a GET form, as on the Tételek page). The Accounts page links here
 * with one account chosen.
 */
import { ASSET_CLASSES } from "@/lib/actions/schemas";
import { D, type Dec } from "@/lib/finance/money";
import type { CashRow, PositionRow, PositionsModel } from "./portfolio";

/** The kinds offered: the asset classes, and the money on the accounts. */
export const POSITION_TYPES = [...ASSET_CLASSES, "cash"] as const;
export type PositionType = (typeof POSITION_TYPES)[number];

export type PositionFilter = { account: string; type: PositionType | ""; currency: string; q: string };

const MAX_QUERY = 64;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");

export function parsePositionFilter(sp: Record<string, string | string[] | undefined>): PositionFilter {
  const type = one(sp.type);
  const currency = one(sp.currency);
  return {
    account: one(sp.account),
    type: (POSITION_TYPES as readonly string[]).includes(type) ? (type as PositionType) : "",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "",
    q: one(sp.q).slice(0, MAX_QUERY),
  };
}

export const isFiltered = (f: PositionFilter) => Boolean(f.account || f.type || f.currency || f.q);

/** Lower case, without accents: "Állampapír" is found by "allampapir". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("hu");

export function filterPositions(
  model: PositionsModel,
  f: PositionFilter,
  instrument: (id: string) => { assetClass: string; name: string } | undefined,
): { positions: PositionRow[]; cash: CashRow[]; total: Dec; complete: boolean } {
  const q = fold(f.q);
  const positions = model.positions.filter((p) => {
    const i = instrument(p.instrumentId);
    return (
      (!f.account || p.accountId === f.account) &&
      (!f.type || i?.assetClass === f.type) &&
      (!f.currency || p.currency === f.currency) &&
      (!q || fold(i?.name ?? "").includes(q))
    );
  });
  // Cash has no kind but its own and no name: a kind other than cash, or a search, leaves it out.
  const cash = model.cash.filter(
    (c) => (!f.account || c.accountId === f.account) && (!f.type || f.type === "cash") && (!f.currency || c.currency === f.currency) && !q,
  );
  const values = [...positions.map((p) => p.display), ...cash.map((c) => c.display)];
  return {
    positions,
    cash,
    total: values.reduce<Dec>((a, v) => (v === null ? a : a.plus(v)), new D(0)),
    complete: values.every((v) => v !== null),
  };
}
