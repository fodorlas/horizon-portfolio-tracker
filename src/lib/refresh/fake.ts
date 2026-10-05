/**
 * Invented sources for every project but production (service.ts,
 * realSources): local runs, previews, CI and e2e. FX sources return nothing:
 * fx_rates rows belong to no user, so nothing may be left behind in the dev
 * database. Yahoo answers only for symbols starting with "FAKE": a price for
 * every weekday, 100 + the day of the month / 10. The invented BÉT answers
 * BETFAKE… codes (fakeBet), so a FAKE… search still reaches the invented Yahoo.
 */
import { accruedPercent, addMonths, type BondKind, historyPeriods, periodOn, steppedPeriods } from "@/lib/bonds/rules";
import { addDays, D, type Day, isWeekday } from "@/lib/finance/money";
import type { AkkRate, AkkRow, AkkSource, AkkTab } from "@/lib/providers/akk";
import { type BetSource, codeKey } from "@/lib/providers/bet";
import { ProviderError } from "@/lib/providers/http";
import type { SearchHit, SymbolInfo } from "@/lib/providers/symbols";
import type { History, LiveQuote } from "@/lib/providers/yahoo";

const known = (symbol: string) => {
  if (!symbol.startsWith("FAKE")) throw new ProviderError("symbol_not_found");
};
const priceOn = (day: Day) => new D(100).plus(new D(Number(day.slice(8, 10))).div(10));

export function fakeSources(today: Day, now: () => Date = () => new Date()) {
  return {
    fetchMnb: async () => [],
    fetchEcb: async () => [],
    yahoo: {
      async history(symbol: string, from: Day, to: Day): Promise<History> {
        known(symbol);
        const bars = [];
        for (let d = from; d <= to && d < today; d = addDays(d, 1)) if (isWeekday(d)) bars.push({ day: d, close: priceOn(d) });
        return { currency: "EUR", bars, splits: [] };
      },
      splitsSince: async () => [],
      async quotes(symbols: string[]): Promise<Map<string, LiveQuote>> {
        const at = new Date(Math.floor(now().getTime() / 60_000) * 60_000).toISOString();
        return new Map(symbols.filter((s) => s.startsWith("FAKE")).map((s) => [s, { symbol: s, price: priceOn(today).plus(1), currency: "EUR", asOf: at }]));
      },
    },
  };
}

/** The invented Yahoo search and lookup (4c): the same FAKE… symbols, named after themselves. */
export function fakeSymbols(today: Day, now: () => Date = () => new Date()) {
  const { yahoo } = fakeSources(today, now);
  const hit = (symbol: string) => ({ symbol, name: `${symbol} Fake Corp`, exchange: "FAKE", assetClass: "stock" as const, source: "yahoo" as const });
  return {
    async search(query: string): Promise<SearchHit[]> {
      const q = query.trim().toUpperCase();
      return q.startsWith("FAKE") ? [hit(q)] : [];
    },
    async info(symbol: string, day: Day, opts: { close?: boolean } = {}): Promise<SymbolInfo | null> {
      const s = symbol.trim().toUpperCase();
      if (!s.startsWith("FAKE")) return null;
      const last = opts.close === false ? undefined : (await yahoo.history(s, addDays(day, -10), day)).bars.at(-1);
      const { symbol: sym, name, exchange, assetClass } = hit(s);
      return { symbol: sym, name, exchange, assetClass, currency: "EUR", close: last ? { day: last.day, price: last.close.toFixed() } : null };
    },
  };
}

/**
 * Invented ÁKK series (spec §2.5), laid out around `today` so the e2e tests
 * always find the same situations. The last letter says what a series is:
 * …/M a MÁP Plusz maturing today, …/F a FixMÁP paying quarterly, …/B a BMÁP
 * with a quarterly history at 7%. FAKE/M, FAKE/F and FAKE/B are always
 * listed; any other FAKE…/M|F|B asked for is listed too, so tests running side
 * by side on one owner each have their own series (one instrument per series).
 * The FixMÁP and the BMÁP pay quarterly on the day 10 days before today's
 * date, so today is never their interest day (a reading on one decides
 * nothing) and two past interest days lie within half a year. The accrued interest follows the
 * Horizon's own rules, so each one verifies.
 */
export function fakeAkk(today: Day, wanted: string[] = []): AkkSource {
  const names = [...new Set(["FAKE/M", "FAKE/F", "FAKE/B", ...wanted.map((w) => w.trim().toUpperCase()).filter((w) => /^FAKE[A-Z0-9]*\/[MFB]$/.test(w))])];
  const bmap = { issue: addMonths(today, -12), maturity: addDays(addMonths(today, 24), -10) };
  const history: AkkRate[] = names
    .filter((n) => n.endsWith("/B"))
    .flatMap((series) =>
      steppedPeriods(bmap.issue, bmap.maturity, "fixmap")
        .filter((p) => p.start <= today)
        .map((p) => ({ series, start: p.start, end: p.end, rate: new D(7) })),
    );
  const row = (series: string, securityType: string, kind: BondKind, tab: AkkTab, issue: Day, maturity: Day, coupon: number | null): AkkRow => {
    const annual = coupon === null ? new D(7) : new D(coupon);
    const periods =
      kind === "bmap" ? historyPeriods(issue, history.filter((h) => h.series === series)) : steppedPeriods(issue, maturity, kind === "fixmap" ? "fixmap" : "mapp");
    const start = periodOn(periods, today)?.start ?? periods.at(-1)?.start ?? issue;
    const accrued = accruedPercent(kind, annual, start, today, maturity).toDecimalPlaces(4, D.ROUND_HALF_UP);
    return {
      series, securityType, kind, tab, issue, maturity, settle: today,
      bid: new D(99), ask: new D(100), accrued, coupon: coupon === null ? null : new D(coupon),
    };
  };
  const rows = names.map((n) =>
    n.endsWith("/M")
      ? row(n, "MÁPP_T", "mapp", "MAPP", addDays(today, -400), today, 6)
      : n.endsWith("/F")
        ? row(n, "FixMÁP", "fixmap", "MAP", addDays(today, -200), addDays(addMonths(today, 36), -10), 6)
        : row(n, "BMÁP", "bmap", "MAP", bmap.issue, bmap.maturity, null),
  );
  return {
    prices: async (tab) => rows.filter((r) => r.tab === tab),
    rates: async () => history,
  };
}

/**
 * Invented BÉT papers (spec 2026-09-28 §2.6): BETFAKE is always listed, and
 * any other BETFAKE… code asked for too, so tests running side by side each
 * have their own (one instrument per code). HUF, a close for every weekday
 * before today: 1000 + the day of the month.
 */
export function fakeBet(today: Day, wanted: string[] = []): BetSource {
  const codes = [...new Set(["BETFAKE", ...wanted.map(codeKey).filter((c) => /^BETFAKE[A-Z0-9]*$/.test(c))])];
  return {
    papers: async () => codes.map((code, i) => ({ id: 900_000 + i, code, category: "W_RESZVENYA", assetClass: "stock" as const })),
    async history(code, from, to) {
      if (!codes.includes(codeKey(code))) throw new ProviderError("symbol_not_found");
      const bars = [];
      for (let d = from; d <= to && d < today; d = addDays(d, 1)) if (isWeekday(d)) bars.push({ day: d, close: new D(1000 + Number(d.slice(8, 10))), currency: "HUF" });
      return { currency: bars.length > 0 ? "HUF" : null, bars };
    },
  };
}
