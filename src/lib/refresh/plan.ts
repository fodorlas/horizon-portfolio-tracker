/**
 * What a refresh fetches (phase 4 plan §2), decided per item, never per
 * source: an FX item is (MNB | ECB, currency), a price item is one instrument
 * priced by Yahoo or the BÉT (its own source; coverage counts per source).
 *
 *  1. nothing stored (a new instrument or currency) → the whole wanted range
 *  2. the stored range starts > 7 days after the wanted start → the head gap
 *  3. the last stored day is before today → the tail, unless the same item's
 *     tail was fetched successfully in the last 15 minutes
 *  4. Yahoo items: the live quote, unless one was fetched successfully in the
 *     last 15 minutes; BÉT items have none (the BÉT publishes closes only)
 * 1 is never skipped; 2 is left out when an earlier fetch of that range came
 * back empty (a paper the source has no older data for, #77), without a log
 * row: the log keeps that empty fetch, and its message column takes known
 * values only. An earlier buy day widens the range and asks again. Gaps inside the stored range are not
 * refetched: sources publish nothing on holidays, which cannot be told from a gap.
 */
import { addDays, type Day } from "@/lib/finance/money";
import type { AkkTab } from "@/lib/providers/akk";

export const LOOKBACK_DAYS = 10;
export const HEAD_SLACK_DAYS = 7;
export const RECENT_MS = 15 * 60_000;

export type FxSource = "MNB" | "ECB";
export type Kind = "history" | "tail" | "live";

export type FxTask = { source: FxSource; item: string; kind: "history" | "tail"; from: Day; to: Day };
/** The instrument price sources a refresh fetches history and tails from. */
export type PriceSource = "yahoo" | "bet";
export type PriceTask = { source: PriceSource; item: string; kind: "history" | "tail"; from: Day; to: Day };
export type LiveTask = { source: "yahoo"; item: string; kind: "live" };
/** The ÁKK (spec 2026-09-28 §4.1): today's list per tab, and the BMÁP/PMÁP interest history once a day. */
export type AkkTask = { source: "akk"; item: AkkTab; kind: "live" } | { source: "akk"; item: "rates"; kind: "history" };
export type Task = FxTask | PriceTask | LiveTask | AkkTask;
export type Source = FxSource | PriceSource | "akk";
export type Skip = { source: Source; item: string; kind: Kind; reason: "recent" };

export type PriceInstrument = { id: string; symbol: string; currency: string; name: string; firstDay: Day; source: PriceSource };

export type PlanInput = {
  today: Day;
  now: Date;
  /** Tracking start of every account. */
  trackingStarts: Day[];
  /** Every currency the portfolio uses (instruments and lines). */
  currencies: string[];
  fxCoverage: { source: FxSource; currency: string; firstDay: Day; lastDay: Day }[];
  instruments: PriceInstrument[];
  /** Per instrument and source: a paper switched to another source has no coverage there yet. */
  priceCoverage: { instrumentId: string; source: PriceSource; firstDay: Day; lastDay: Day }[];
  /** Successful ("ok" or "empty") tail and live fetches of the last 15 minutes. */
  recent: { source: Source; item: string; kind: Kind; at: string }[];
  /** History fetches that came back empty, at any time (#77). */
  emptyHistory: { source: Source; item: string; from: Day; to: Day }[];
  /** The ÁKK instruments the owner holds, with their tabs, and whether a BMÁP or PMÁP needs the history not yet fetched today. */
  akk?: { bonds: { instrumentId: string; tab: AkkTab }[]; needsRates: boolean; ratesFetchedToday: boolean };
};

/** MNB publishes X→HUF, the ECB EUR→X: which items each needs. */
export function fxItems(currencies: string[]): { MNB: string[]; ECB: string[] } {
  const all = [...new Set(["EUR", "USD", ...currencies])].filter((c) => c !== "HUF").sort();
  return { MNB: all, ECB: [...new Set([...all, "HUF"])].filter((c) => c !== "EUR").sort() };
}

function coverageTasks<T extends FxTask | PriceTask>(
  make: (kind: "history" | "tail", from: Day, to: Day) => T,
  start: Day,
  today: Day,
  stored: { firstDay: Day; lastDay: Day } | undefined,
  recentTail: boolean,
  skip: () => void,
  emptyBefore: (from: Day, to: Day) => boolean,
): T[] {
  if (!stored) return [make("history", start, today)];
  const out: T[] = [];
  if (addDays(start, HEAD_SLACK_DAYS) < stored.firstDay) {
    const to = addDays(stored.firstDay, -1);
    if (!emptyBefore(start, to)) out.push(make("history", start, to));
  }
  if (stored.lastDay < today) {
    if (recentTail) skip();
    else out.push(make("tail", addDays(stored.lastDay, 1), today));
  }
  return out;
}

export function planRefresh(input: PlanInput): { tasks: Task[]; skipped: Skip[] } {
  const tasks: Task[] = [];
  const skipped: Skip[] = [];
  const cutoff = input.now.getTime() - RECENT_MS;
  const isRecent = (source: string, item: string, kind: Kind) =>
    input.recent.some((r) => r.source === source && r.item === item && r.kind === kind && Date.parse(r.at) > cutoff);
  const emptyBefore = (source: Source, item: string) => (from: Day, to: Day) =>
    input.emptyHistory.some((e) => e.source === source && e.item === item && e.from <= from && e.to >= to);

  if (input.trackingStarts.length > 0) {
    const start = addDays([...input.trackingStarts].sort()[0], -LOOKBACK_DAYS);
    const items = fxItems(input.currencies);
    for (const source of ["ECB", "MNB"] as const) {
      for (const currency of items[source]) {
        const stored = input.fxCoverage.find((c) => c.source === source && c.currency === currency);
        tasks.push(
          ...coverageTasks<FxTask>(
            (kind, from, to) => ({ source, item: currency, kind, from, to }),
            start,
            input.today,
            stored,
            isRecent(source, currency, "tail"),
            () => skipped.push({ source, item: currency, kind: "tail", reason: "recent" }),
            emptyBefore(source, currency),
          ),
        );
      }
    }
  }

  for (const inst of input.instruments) {
    const source = inst.source;
    const stored = input.priceCoverage.find((c) => c.instrumentId === inst.id && c.source === source);
    tasks.push(
      ...coverageTasks<PriceTask>(
        (kind, from, to) => ({ source, item: inst.id, kind, from, to }),
        addDays(inst.firstDay, -LOOKBACK_DAYS),
        input.today,
        stored,
        isRecent(source, inst.id, "tail"),
        () => skipped.push({ source, item: inst.id, kind: "tail", reason: "recent" }),
        emptyBefore(source, inst.id),
      ),
    );
    if (source !== "yahoo") continue;
    if (isRecent("yahoo", inst.id, "live")) skipped.push({ source: "yahoo", item: inst.id, kind: "live", reason: "recent" });
    else tasks.push({ source: "yahoo", item: inst.id, kind: "live" });
  }

  if (input.akk) {
    if (input.akk.needsRates && !input.akk.ratesFetchedToday) tasks.push({ source: "akk", item: "rates", kind: "history" });
    // A tab waits only while every paper on it got a price in the last 15 minutes: a paper
    // just added gets its price at once.
    const bonds = input.akk.bonds;
    for (const tab of [...new Set(bonds.map((b) => b.tab))].sort()) {
      if (bonds.filter((b) => b.tab === tab).every((b) => isRecent("akk", b.instrumentId, "live"))) {
        skipped.push({ source: "akk", item: tab, kind: "live", reason: "recent" });
      } else tasks.push({ source: "akk", item: tab, kind: "live" });
    }
  }
  return { tasks, skipped };
}
