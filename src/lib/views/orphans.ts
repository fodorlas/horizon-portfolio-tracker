import type { LedgerEvent } from "@/lib/finance/ledger";

/**
 * The instruments that deleting `removed` leaves without any line: the
 * database deletes them too, with their prices and values
 * (drop_orphan_instrument). Any line naming the instrument keeps it.
 */
export function orphanedBy(events: readonly LedgerEvent[], removed: ReadonlySet<string>): string[] {
  const used = (keep: boolean) =>
    new Set(events.filter((e) => removed.has(e.id) !== keep).flatMap((e) => e.lines.flatMap((l) => (l.instrumentId ? [l.instrumentId] : []))));
  const kept = used(true);
  return [...used(false)].filter((id) => !kept.has(id));
}
