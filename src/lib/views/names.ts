import type { Loaded } from "@/lib/data/load";

/** Display names for ids: "Institution · Account", "Name (TICKER)". */
export function nameMaps(data: Pick<Loaded, "institutions" | "accountMeta" | "instrumentMeta">) {
  const institution = new Map(data.institutions.map((i) => [i.id, i.name]));
  const account = new Map(data.accountMeta.map((a) => [a.id, `${institution.get(a.institution_id) ?? "?"} · ${a.name}`]));
  const instrument = new Map(data.instrumentMeta.map((i) => [i.id, i.ticker ? `${i.name} (${i.ticker})` : i.name]));
  return { account, instrument };
}
export type Names = ReturnType<typeof nameMaps>;
