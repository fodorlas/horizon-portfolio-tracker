import { describe, expect, it } from "vitest";
import type { FxRow } from "@/lib/finance/fx";
import type { LedgerEvent, Line } from "@/lib/finance/ledger";
import { D } from "@/lib/finance/money";
import type { ManualValuation, PriceQuote } from "@/lib/finance/prices";
import type { PortfolioData } from "@/lib/finance/valuation";
import { fxPanel, overview, parsePeriod, PERIODS, periodStart, positions, sampleDays } from "./portfolio";

let n = 0;
const L = (p: Omit<Partial<Line>, "amount"> & Pick<Line, "kind" | "accountId" | "currency" | "role"> & { amount: string }): Line => ({
  id: `l${++n}`, instrumentId: null, costAmount: null, costEstimated: false, costFxRefs: null, ...p, amount: new D(p.amount),
});
const E = (type: LedgerEvent["type"], date: string, lines: Line[], extra: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: `e${++n}`, type, date, createdAt: `${date}T10:00:00Z`, correctionKind: null, splitRatio: null, note: null, lines, ...extra,
});
const fx = (id: string, base: string, rate: string, day: string): FxRow => ({
  id, base, quote: "HUF", rate, rateDate: day, source: "MNB", status: "ok", supersedesId: null, fetchedAt: `${day}T11:00:00Z`,
});
const quote = (id: string, price: string, day: string): PriceQuote => ({
  id, instrumentId: "AAPL", price, currency: "USD", asOf: `${day}T20:00:00Z`, enteredAt: `${day}T21:00:00Z`, source: "yahoo", status: "ok", supersedesId: null,
});
const hold = (id: string, value: string, day: string): ManualValuation => ({
  id, accountId: "A2", instrumentId: "HOLD", value, currency: "HUF", asOf: `${day}T10:00:00Z`, enteredAt: `${day}T10:00:00Z`, source: "manual", status: "ok", supersedesId: null,
});

const data: PortfolioData = {
  accounts: [{ id: "A1", trackingStart: "2026-01-01" }, { id: "A2", trackingStart: "2026-03-01" }],
  instruments: [
    { id: "AAPL", name: "Apple", assetClass: "stock", currency: "USD", valuation: "market", priceSource: "yahoo", staleAfterDays: null },
    { id: "HOLD", name: "Hold portfólió", assetClass: "managed", currency: "HUF", valuation: "manual", priceSource: "manual", staleAfterDays: null },
  ],
  events: [
    E("deposit", "2026-01-05", [L({ kind: "cash", accountId: "A1", currency: "USD", amount: "10000", role: "external" })]),
    E("buy", "2026-01-10", [
      L({ kind: "position", accountId: "A1", instrumentId: "AAPL", currency: "USD", amount: "10", role: "trade", costAmount: new D(2000) }),
      L({ kind: "cash", accountId: "A1", currency: "USD", amount: "-2000", role: "trade" }),
    ]),
    E("opening_balance", "2026-03-01", [
      L({ kind: "position", accountId: "A2", instrumentId: "HOLD", currency: "HUF", amount: "1", role: "opening", costAmount: new D(5_000_000), costEstimated: true }),
    ]),
    E("correction", "2026-03-15", [L({ kind: "cash", accountId: "A1", currency: "USD", amount: "-1", role: "correction" })], { correctionKind: "reconciliation", note: "x" }),
  ],
  quotes: [quote("q1", "210", "2026-02-27"), quote("q2", "220", "2026-03-31")],
  valuations: [hold("v1", "5000000", "2026-03-01"), hold("v2", "5100000", "2026-03-31")],
  fxRows: [fx("f0", "USD", "340", "2026-01-05"), fx("f1", "USD", "350", "2026-02-27"), fx("f2", "USD", "360", "2026-03-31")],
};

describe("periods", () => {
  it("five years sit between one year and all (the owner's request, 2026-09-30)", () => {
    expect(PERIODS).toEqual(["1w", "1m", "6m", "1y", "5y", "all"]);
  });
  it("unknown values fall back to one month", () => {
    expect(parsePeriod("1y")).toBe("1y");
    expect(parsePeriod("5y")).toBe("5y");
    expect(parsePeriod("10y")).toBe("1m");
    expect(parsePeriod(undefined)).toBe("1m");
  });
  it("periods end today, both ends included; 'all' starts the day after the tracking start", () => {
    expect(periodStart("1w", "2026-03-31", "2026-01-01")).toBe("2026-03-25");
    expect(periodStart("1m", "2026-03-31", "2026-01-01")).toBe("2026-03-02");
    expect(periodStart("5y", "2026-03-31", "2020-01-01")).toBe("2021-04-01");
    expect(periodStart("all", "2026-03-31", "2026-01-01")).toBe("2026-01-02");
  });
  it("samples at most the given number of days, keeping both ends", () => {
    expect(sampleDays("2026-01-01", "2026-01-03")).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    const long = sampleDays("2020-01-01", "2026-01-01", 90);
    expect(long).toHaveLength(90);
    expect([long[0], long.at(-1)]).toEqual(["2020-01-01", "2026-01-01"]);
    expect(sampleDays("2026-01-02", "2026-01-01")).toEqual([]);
  });
});

describe("overview", () => {
  const m = overview(data, "2026-03-31", "HUF", "all");

  it("today's value and allocation, largest first, with shares", () => {
    expect(m.now.total.toString()).toBe(String(10 * 220 * 360 + 7999 * 360 + 5_100_000));
    expect(m.allocation.assetClass.map((s) => [s.key, s.value.toString()])).toEqual([
      ["managed", "5100000"],
      ["cash", String(7999 * 360)],
      ["stock", "792000"],
    ]);
    const shares = m.allocation.assetClass.reduce((a, s) => a.plus(s.share), new D(0));
    expect(shares.toDecimalPlaces(10).toString()).toBe("1");
    expect(m.missingCount).toBe(0);
  });

  it("the series starts at V(S − 1) and marks tracking starts and corrections", () => {
    expect(m.figures?.start).toBe("2026-01-02");
    expect(m.series[0].day).toBe("2026-01-01");
    expect(m.series.at(-1)).toEqual({ day: "2026-03-31", value: m.now.total.toFixed(), complete: true });
    expect(m.markers).toEqual([
      { day: "2026-01-01", kind: "tracking_start" },
      { day: "2026-03-01", kind: "tracking_start" },
      { day: "2026-03-15", kind: "correction" },
    ]);
  });

  it("recent items, newest first; an entry's events are one item", () => {
    const day = (i: (typeof m.recent)[number]) => (i.kind === "entry" ? i.entry.date : i.event.date);
    expect(m.recent.map(day)).toEqual(["2026-03-15", "2026-03-01", "2026-01-10", "2026-01-05"]);
    // The deposit and the buy of January recorded as one entry.
    const [deposit, buy] = data.events;
    const grouped = overview(data, "2026-03-31", "HUF", "1m", new Map([[deposit.id, "E1"], [buy.id, "E1"]]));
    expect(grouped.recent.map((i) => (i.kind === "entry" ? `entry:${i.entry.kind}` : `event:${i.event.type}`))).toEqual([
      "event:correction", "event:opening_balance", "entry:buy",
    ]);
  });

  it("an empty portfolio has no figures and no series", () => {
    const empty = overview({ ...data, accounts: [], events: [] }, "2026-03-31", "HUF", "1m");
    expect([empty.figures, empty.series, empty.now.total.toString()]).toEqual([null, [], "0"]);
  });
});

describe("FX panel", () => {
  it("shows the selected rate with its date; missing pairs stay missing; old rates are stale", () => {
    const [eur, usd, eurusd] = fxPanel(data, "2026-03-31");
    expect(eur.selection.kind).toBe("missing");
    expect(usd.selection).toMatchObject({ kind: "rate", source: "MNB", rateDate: "2026-03-31" });
    expect(usd.stale).toBe(false);
    expect(eurusd.selection.kind).toBe("missing");
    expect(fxPanel(data, "2026-04-06")[1].stale).toBe(true); // Tue → Mon: 4 business days
  });
});

describe("positions", () => {
  it("value in own and display currency, price source and age, cost and unrealised result", () => {
    const m = positions(data, "2026-03-31", "HUF");
    const aapl = m.positions.find((p) => p.instrumentId === "AAPL")!;
    expect({
      qty: aapl.quantity.toString(), price: aapl.price?.toString(), native: aapl.native?.toString(), display: aapl.display?.toString(),
      cost: aapl.cost.toString(), unrealized: aapl.unrealized?.toString(), rate: aapl.unrealizedRate?.toString(),
      source: aapl.valueSource, asOf: aapl.valueAsOf, stale: aapl.stale,
    }).toEqual({ qty: "10", price: "220", native: "2200", display: "792000", cost: "2000", unrealized: "200", rate: "0.1", source: "yahoo", asOf: "2026-03-31", stale: false });

    const holdRow = m.positions.find((p) => p.instrumentId === "HOLD")!;
    expect([holdRow.price, holdRow.native?.toString(), holdRow.costEstimated, holdRow.valueSource]).toEqual([null, "5100000", true, "manual"]);
    expect(m.cash.map((c) => [c.accountId, c.currency, c.amount.toString(), c.display?.toString()])).toEqual([["A1", "USD", "7999", String(7999 * 360)]]);
    expect(m.total.toString()).toBe(overview(data, "2026-03-31", "HUF", "1m").now.total.toString());
    expect(m.positions[0].instrumentId).toBe("HOLD"); // largest first
  });

  it("realised result (FIFO) and net income per position; an old price is stale", () => {
    const d: PortfolioData = {
      ...data,
      events: [
        ...data.events.slice(0, 2),
        E("sell", "2026-02-10", [
          L({ kind: "position", accountId: "A1", instrumentId: "AAPL", currency: "USD", amount: "-4", role: "trade" }),
          L({ kind: "cash", accountId: "A1", currency: "USD", amount: "1000", role: "trade" }),
          L({ kind: "cash", accountId: "A1", currency: "USD", amount: "-2", role: "fee" }),
        ]),
        E("dividend", "2026-02-15", [
          L({ kind: "cash", accountId: "A1", instrumentId: "AAPL", currency: "USD", amount: "10", role: "income" }),
          L({ kind: "cash", accountId: "A1", currency: "USD", amount: "-1.5", role: "tax" }),
        ]),
      ],
    };
    const row = positions(d, "2026-03-10", "HUF").positions[0];
    expect([row.quantity.toString(), row.realized.toString(), row.incomeNet.toString(), row.cost.toString()]).toEqual(["6", "198", "8.5", "1200"]);
    expect([row.valueAsOf, row.ageDays, row.stale]).toEqual(["2026-02-27", 11, true]);
  });

  it("a missing FX rate leaves the display value empty and the model incomplete", () => {
    const m = positions(data, "2026-03-31", "EUR");
    expect(m.complete).toBe(false);
    expect(m.positions.every((p) => p.display === null)).toBe(true);
  });
});
