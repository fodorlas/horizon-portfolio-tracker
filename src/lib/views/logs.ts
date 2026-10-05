/**
 * Labels for rows of the append-only logs (plan §3.3): which rows are
 * superseded, suspect, bound to a transaction, of a source the instrument no
 * longer uses (#39), or the one used today.
 */
export type LogStatus = "current" | "ok" | "superseded" | "suspect" | "broker" | "unused";
type LogRow = { id: string; status: string; source: string; supersedes_id: string | null };

/** Same rule as the selection: only a valid manual row supersedes another. */
export function supersededIds(rows: LogRow[]): Set<string> {
  return new Set(rows.filter((r) => r.supersedes_id && r.status === "ok" && r.source === "manual").map((r) => r.supersedes_id!));
}

/** `usable`: whether the selection may use a row's source at all (prices: priceSourceFilter of its instrument). */
export function logStatuses<R extends LogRow>(rows: R[], current: Set<string> = new Set(), usable: (r: R) => boolean = () => true): Map<string, LogStatus> {
  const superseded = supersededIds(rows);
  const status = (r: R): LogStatus => {
    if (r.source === "broker") return "broker";
    if (r.status === "suspect") return "suspect";
    if (superseded.has(r.id)) return "superseded";
    if (!usable(r)) return "unused";
    return current.has(r.id) ? "current" : "ok";
  };
  return new Map(rows.map((r): [string, LogStatus] => [r.id, status(r)]));
}
