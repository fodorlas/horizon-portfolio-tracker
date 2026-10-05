/**
 * The overview for a long period must render well inside the page's time
 * (maxDuration 60 s on Vercel). On 2026-09-30 the owner's 6-month view timed
 * out: every price row's day and every FX lookup was recomputed from scratch
 * for each position on each day of the chart. Invented data of about the
 * owner's size, two years back.
 */
import { describe, expect, it } from "vitest";
import type { FxRow } from "@/lib/finance/fx";
import type { LedgerEvent, Line } from "@/lib/finance/ledger";
import { addDays, D } from "@/lib/finance/money";
import type { PriceQuote } from "@/lib/finance/prices";
import type { Instrument, PortfolioData } from "@/lib/finance/valuation";
import { overview, type PeriodKey } from "./portfolio";

const TODAY = "2026-09-30";
const START = "2024-08-01";
const CURRENCIES = ["USD", "EUR", "HUF"];

function ownerSized(): PortfolioData {
  const accounts = Array.from({ length: 7 }, (_, i) => ({ id: `A${i}`, trackingStart: addDays(START, -1) }));
  const instruments: Instrument[] = Array.from({ length: 20 }, (_, i) => ({
    id: `I${i}`, name: `I${i}`, assetClass: "stock", currency: CURRENCIES[i % 3], valuation: "market", priceSource: "yahoo", staleAfterDays: null,
  }));
  let n = 0;
  const line = (p: Pick<Line, "kind" | "role" | "accountId" | "currency"> & Partial<Line>): Line => ({
    id: `l${n++}`, instrumentId: null, costAmount: null, costEstimated: false, costFxRefs: null, amount: new D(0), ...p,
  });
  const event = (id: string, type: LedgerEvent["type"], date: string, lines: Line[]): LedgerEvent => ({
    id, type, date, createdAt: `${date}T10:00:00Z`, correctionKind: null, splitRatio: null, note: null, lines,
  });
  const events: LedgerEvent[] = [];
  instruments.forEach((inst, i) => {
    events.push(event(`o${i}`, "opening_balance", addDays(START, i * 30), [
      line({ kind: "position", role: "opening", accountId: `A${i % 7}`, instrumentId: inst.id, currency: inst.currency, amount: new D(10), costAmount: new D(1000) }),
    ]));
  });
  for (let i = 0; i < 40; i++) {
    events.push(event(`d${i}`, "deposit", addDays(START, i * 14), [line({ kind: "cash", role: "external", accountId: `A${i % 7}`, currency: CURRENCIES[i % 3], amount: new D(500) })]));
  }
  const fxRows: FxRow[] = [];
  const quotes: PriceQuote[] = [];
  for (let d = START; d <= TODAY; d = addDays(d, 1)) {
    for (const [source, base, quote, rate] of [["MNB", "EUR", "HUF", "390"], ["MNB", "USD", "HUF", "350"], ["ECB", "EUR", "USD", "1.1"], ["ECB", "EUR", "HUF", "391"]] as const) {
      fxRows.push({ id: `f${fxRows.length}`, base, quote, rate, rateDate: d, source, status: "ok", supersedesId: null, fetchedAt: `${d}T16:00:00Z` });
    }
    for (const i of instruments) {
      quotes.push({ id: `q${quotes.length}`, instrumentId: i.id, price: "100", currency: i.currency, asOf: `${d}T20:00:00Z`, enteredAt: `${d}T21:00:00Z`, source: "yahoo", status: "ok", supersedesId: null });
    }
  }
  return { accounts, instruments, events, quotes, valuations: [], fxRows };
}

describe("overview speed", () => {
  const data = ownerSized();

  // On a laptop: about 1 s each after the fix, 45–65 s before it (the limit catches that, not a slower CI machine).
  for (const period of ["6m", "1y", "all"] as PeriodKey[]) {
    it(`${period}: well inside the page's time`, () => {
      const t0 = performance.now();
      const o = overview(data, TODAY, "HUF", period);
      const ms = performance.now() - t0;
      expect(o.series.length).toBeGreaterThan(80);
      expect(ms).toBeLessThan(5_000);
    }, 120_000);
  }
});
