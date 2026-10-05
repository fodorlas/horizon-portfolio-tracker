import { describe, expect, it } from "vitest";
import { fxItems, type PlanInput, planRefresh } from "./plan";

const NOW = new Date("2026-09-28T10:00:00Z");
const base: PlanInput = {
  today: "2026-09-28",
  now: NOW,
  trackingStarts: ["2026-06-01"],
  currencies: ["HUF", "EUR"],
  fxCoverage: [],
  instruments: [],
  priceCoverage: [],
  recent: [],
  emptyHistory: [],
};
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const inst = { id: "i1", symbol: "VWCE.DE", currency: "EUR", name: "VWCE", firstDay: "2026-07-01", source: "yahoo" as const };

describe("FX items", () => {
  it("MNB quotes X→HUF, the ECB EUR→X: EUR and USD always, HUF only for the ECB", () => {
    expect(fxItems(["HUF", "JPY"])).toEqual({ MNB: ["EUR", "JPY", "USD"], ECB: ["HUF", "JPY", "USD"] });
  });
});

describe("planRefresh", () => {
  it("1. nothing stored: the whole wanted range, from the earliest tracking start − 10 days", () => {
    const { tasks } = planRefresh(base);
    expect(tasks).toContainEqual({ source: "MNB", item: "EUR", kind: "history", from: "2026-05-22", to: "2026-09-28" });
    expect(tasks).toContainEqual({ source: "ECB", item: "HUF", kind: "history", from: "2026-05-22", to: "2026-09-28" });
  });

  it("a new currency or instrument is fetched even right after a successful refresh", () => {
    const { tasks } = planRefresh({
      ...base,
      currencies: ["HUF", "EUR", "CHF"],
      fxCoverage: [
        { source: "MNB", currency: "EUR", firstDay: "2026-05-22", lastDay: "2026-09-25" },
        { source: "MNB", currency: "USD", firstDay: "2026-05-22", lastDay: "2026-09-25" },
      ],
      instruments: [inst],
      recent: [
        { source: "MNB", item: "EUR", kind: "tail", at: minutesAgo(2) },
        { source: "MNB", item: "USD", kind: "tail", at: minutesAgo(2) },
      ],
    });
    expect(tasks).toContainEqual({ source: "MNB", item: "CHF", kind: "history", from: "2026-05-22", to: "2026-09-28" });
    expect(tasks).toContainEqual({ source: "yahoo", item: "i1", kind: "history", from: "2026-06-21", to: "2026-09-28" });
    expect(tasks).toContainEqual({ source: "yahoo", item: "i1", kind: "live" });
    expect(tasks.some((t) => t.source === "MNB" && t.item === "EUR")).toBe(false);
  });

  it("2. a head gap (tracking start moved earlier) is fetched, never skipped", () => {
    const { tasks } = planRefresh({
      ...base,
      trackingStarts: ["2026-01-05"],
      fxCoverage: [{ source: "MNB", currency: "EUR", firstDay: "2026-05-22", lastDay: "2026-09-28" }],
      recent: [{ source: "MNB", item: "EUR", kind: "tail", at: minutesAgo(1) }],
    });
    expect(tasks).toContainEqual({ source: "MNB", item: "EUR", kind: "history", from: "2025-12-26", to: "2026-05-21" });
  });

  describe("2. a head range that came back empty before (#77)", () => {
    // VUAA.DE: bought 2024-08-25, Yahoo has data from 2024-12-30 only.
    const vuaa = { ...inst, symbol: "VUAA.DE", firstDay: "2024-08-25" };
    const stored = [{ instrumentId: "i1", source: "yahoo" as const, firstDay: "2024-12-30", lastDay: "2026-09-28" }];
    const empty = { source: "yahoo" as const, item: "i1", from: "2024-08-15", to: "2024-12-29" };

    it("is not asked again (the tail and the live quote still are)", () => {
      const { tasks, skipped } = planRefresh({ ...base, instruments: [vuaa], priceCoverage: stored, emptyHistory: [empty] });
      expect(tasks.filter((t) => t.item === "i1")).toEqual([{ source: "yahoo", item: "i1", kind: "live" }]);
      // No log row of its own: the log keeps the empty fetch, and takes known messages only.
      expect(skipped.filter((s) => s.item === "i1")).toEqual([]);
    });

    it("an earlier buy day widens the range: asked again", () => {
      const { tasks } = planRefresh({ ...base, instruments: [{ ...vuaa, firstDay: "2024-07-01" }], priceCoverage: stored, emptyHistory: [empty] });
      expect(tasks).toContainEqual({ source: "yahoo", item: "i1", kind: "history", from: "2024-06-21", to: "2024-12-29" });
    });

    it("another item's, another source's or a narrower empty range does not count", () => {
      for (const other of [{ ...empty, item: "i2" }, { ...empty, source: "bet" as const }, { ...empty, from: "2024-09-01" }]) {
        const { tasks } = planRefresh({ ...base, instruments: [vuaa], priceCoverage: stored, emptyHistory: [other] });
        expect(tasks).toContainEqual({ source: "yahoo", item: "i1", kind: "history", from: "2024-08-15", to: "2024-12-29" });
      }
    });

    it("FX heads too", () => {
      const fxEmpty = { source: "MNB" as const, item: "EUR", from: "2025-12-26", to: "2026-05-21" };
      const { tasks } = planRefresh({
        ...base,
        trackingStarts: ["2026-01-05"],
        fxCoverage: [{ source: "MNB", currency: "EUR", firstDay: "2026-05-22", lastDay: "2026-09-28" }],
        emptyHistory: [fxEmpty],
      });
      expect(tasks.some((t) => t.source === "MNB" && t.item === "EUR" && t.kind === "history")).toBe(false);
    });
  });

  it("2. up to 7 days' difference at the start is not a gap (weekends, holidays)", () => {
    const { tasks } = planRefresh({ ...base, fxCoverage: [{ source: "MNB", currency: "EUR", firstDay: "2026-05-29", lastDay: "2026-09-28" }] });
    expect(tasks.filter((t) => t.source === "MNB" && t.item === "EUR")).toEqual([]);
  });

  it("3. the tail from the day after the last stored one; skipped only after a recent success for the same item", () => {
    const stored = [
      { source: "MNB" as const, currency: "EUR", firstDay: "2026-05-22", lastDay: "2026-09-25" },
      { source: "MNB" as const, currency: "USD", firstDay: "2026-05-22", lastDay: "2026-09-25" },
    ];
    const { tasks, skipped } = planRefresh({
      ...base,
      fxCoverage: stored,
      recent: [
        { source: "MNB", item: "EUR", kind: "tail", at: minutesAgo(10) },
        { source: "MNB", item: "USD", kind: "tail", at: minutesAgo(16) },
      ],
    });
    expect(skipped).toContainEqual({ source: "MNB", item: "EUR", kind: "tail", reason: "recent" });
    expect(tasks).toContainEqual({ source: "MNB", item: "USD", kind: "tail", from: "2026-09-26", to: "2026-09-28" });
  });

  it("3. nothing to do when the stored range reaches today", () => {
    const { tasks, skipped } = planRefresh({ ...base, fxCoverage: [{ source: "MNB", currency: "EUR", firstDay: "2026-05-22", lastDay: "2026-09-28" }] });
    expect(tasks.some((t) => t.source === "MNB" && t.item === "EUR")).toBe(false);
    expect(skipped).toEqual([]);
  });

  it("4. live quote: skipped within 15 minutes of a successful one", () => {
    const covered = { instrumentId: "i1", source: "yahoo" as const, firstDay: "2026-06-21", lastDay: "2026-09-28" };
    const fresh = planRefresh({ ...base, instruments: [inst], priceCoverage: [covered], recent: [{ source: "yahoo", item: "i1", kind: "live", at: minutesAgo(5) }] });
    expect(fresh.tasks).toEqual(expect.not.arrayContaining([{ source: "yahoo", item: "i1", kind: "live" }]));
    expect(fresh.skipped).toContainEqual({ source: "yahoo", item: "i1", kind: "live", reason: "recent" });
    const stale = planRefresh({ ...base, instruments: [inst], priceCoverage: [covered], recent: [{ source: "yahoo", item: "i1", kind: "live", at: minutesAgo(20) }] });
    expect(stale.tasks).toContainEqual({ source: "yahoo", item: "i1", kind: "live" });
  });

  it("no account yet: no FX to fetch", () => {
    expect(planRefresh({ ...base, trackingStarts: [] }).tasks).toEqual([]);
  });
});

describe("planRefresh: the ÁKK (spec 2026-09-28 §4.1)", () => {
  it("nothing without ÁKK instruments", () => {
    expect(planRefresh(base).tasks.some((t) => t.source === "akk")).toBe(false);
  });

  it("one live task per tab; within 15 minutes only when a paper on it has no fresh price yet", () => {
    const bonds = [{ instrumentId: "m5", tab: "MAPP" as const }, { instrumentId: "m9", tab: "MAPP" as const }, { instrumentId: "q4", tab: "MAP" as const }];
    const akk = { bonds, needsRates: false, ratesFetchedToday: false };
    expect(planRefresh({ ...base, akk }).tasks.filter((t) => t.source === "akk")).toEqual([
      { source: "akk", item: "MAP", kind: "live" },
      { source: "akk", item: "MAPP", kind: "live" },
    ]);
    const fresh = (id: string) => ({ source: "akk" as const, item: id, kind: "live" as const, at: minutesAgo(5) });
    // Both MAPP papers priced 5 minutes ago: MAPP waits.
    const r = planRefresh({ ...base, akk, recent: [fresh("m5"), fresh("m9")] });
    expect(r.tasks.filter((t) => t.source === "akk")).toEqual([{ source: "akk", item: "MAP", kind: "live" }]);
    expect(r.skipped).toContainEqual({ source: "akk", item: "MAPP", kind: "live", reason: "recent" });
    // A paper added since then (m9 has no fresh price): MAPP is asked again.
    const added = planRefresh({ ...base, akk, recent: [fresh("m5")] });
    expect(added.tasks.filter((t) => t.source === "akk").map((t) => t.item)).toEqual(["MAP", "MAPP"]);
  });

  it("the interest history once a day, and only when a BMÁP or PMÁP needs it", () => {
    const tasks = (needsRates: boolean, ratesFetchedToday: boolean) =>
      planRefresh({ ...base, akk: { bonds: [{ instrumentId: "n", tab: "MAP" }], needsRates, ratesFetchedToday } }).tasks.filter((t) => t.item === "rates");
    expect(tasks(true, false)).toEqual([{ source: "akk", item: "rates", kind: "history" }]);
    expect(tasks(true, true)).toEqual([]);
    expect(tasks(false, false)).toEqual([]);
  });
});

describe("planRefresh: the BÉT (spec 2026-09-28 §2.6)", () => {
  const bet = { id: "b1", symbol: "ETFCETOPOTP", currency: "EUR", name: "CETOP", firstDay: "2026-07-01", source: "bet" as const };

  it("nothing stored: the history from 10 days before the first day, and no live quote (the BÉT publishes closes only)", () => {
    const { tasks } = planRefresh({ ...base, instruments: [bet] });
    expect(tasks.filter((t) => t.item === "b1")).toEqual([{ source: "bet", item: "b1", kind: "history", from: "2026-06-21", to: "2026-09-28" }]);
  });

  it("switched from Yahoo: the Yahoo coverage does not count, the BÉT history is fetched", () => {
    const { tasks } = planRefresh({ ...base, instruments: [bet], priceCoverage: [{ instrumentId: "b1", source: "yahoo", firstDay: "2026-06-21", lastDay: "2026-09-28" }] });
    expect(tasks).toContainEqual({ source: "bet", item: "b1", kind: "history", from: "2026-06-21", to: "2026-09-28" });
  });

  it("the tail from the day after the last BÉT close; skipped within 15 minutes of a successful one", () => {
    const covered = [{ instrumentId: "b1", source: "bet" as const, firstDay: "2026-06-21", lastDay: "2026-09-25" }];
    expect(planRefresh({ ...base, instruments: [bet], priceCoverage: covered }).tasks).toContainEqual({ source: "bet", item: "b1", kind: "tail", from: "2026-09-26", to: "2026-09-28" });
    const r = planRefresh({ ...base, instruments: [bet], priceCoverage: covered, recent: [{ source: "bet", item: "b1", kind: "tail", at: minutesAgo(5) }] });
    expect(r.tasks.some((t) => t.item === "b1")).toBe(false);
    expect(r.skipped).toContainEqual({ source: "bet", item: "b1", kind: "tail", reason: "recent" });
  });
});
