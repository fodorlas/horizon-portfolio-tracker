/**
 * The refresh run with fake sources and an in-memory store (phase 4 plan §2–§4).
 */
import { describe, expect, it, vi } from "vitest";
import { D, type Day } from "@/lib/finance/money";
import { createBudget, ProviderError } from "@/lib/providers/http";
import type { SourceRate } from "@/lib/providers/mnb";
import type { Priced, Split } from "@/lib/providers/splits";
import type { History, LiveQuote } from "@/lib/providers/yahoo";
import type { PriceInstrument, Task } from "./plan";
import { type FxInsert, type LogRow, type QuoteInsert, type RefreshDeps, runRefresh } from "./run";

const TODAY = "2026-09-28";
const inst = (id: string, symbol = `${id.toUpperCase()}.DE`): PriceInstrument => ({ id, symbol, currency: "EUR", name: `Eszköz ${id}`, firstDay: "2026-09-01", source: "yahoo" });
const betInst = (id: string): PriceInstrument => ({ id, symbol: `BET${id.toUpperCase()}`, currency: "EUR", name: `BÉT ${id}`, firstDay: "2026-09-01", source: "bet" });
const rate = (base: string, quote: string, r: string, day: Day): SourceRate => ({ base, quote, rate: new D(r), rawUnit: 1, rateDate: day });

function store() {
  const fx = new Map<string, FxInsert>();
  const quotes = new Map<string, QuoteInsert>();
  const logs: LogRow[] = [];
  return {
    fx, quotes, logs,
    recordFx: async (rows: FxInsert[]) => rows.filter((r) => {
      const k = `${r.base}${r.quote}${r.rateDate}${r.source}`;
      return fx.has(k) ? false : (fx.set(k, r), true);
    }).length,
    recordQuotes: async (rows: QuoteInsert[]) => rows.filter((r) => {
      const k = `${r.instrumentId}${r.asOf}`;
      return quotes.has(k) ? false : (quotes.set(k, r), true);
    }).length,
    log: async (rows: LogRow[]) => void logs.push(...rows),
  };
}

function deps(over: Partial<RefreshDeps> & { instruments?: PriceInstrument[] } = {}, s = store()): RefreshDeps {
  return {
    runId: "run-1",
    budget: createBudget(45_000, () => 0, async () => {}),
    today: TODAY,
    instruments: [],
    ledgerSplits: () => [],
    fetchMnb: async () => [rate("EUR", "HUF", "400", "2026-09-25"), rate("USD", "HUF", "320", "2026-09-25")],
    fetchEcb: async () => [rate("EUR", "HUF", "400", "2026-09-25"), rate("EUR", "USD", "1.25", "2026-09-25")],
    yahoo: {
      history: async (): Promise<History> => ({ currency: "EUR", bars: [{ day: "2026-09-25", close: new D("100") }], splits: [] }),
      splitsSince: async () => [],
      quotes: async (symbols) => new Map(symbols.map((sy): [string, LiveQuote] => [sy, { symbol: sy, price: new D("101"), currency: "EUR", asOf: "2026-09-28T09:00:00.000Z" }])),
    },
    bet: { history: async () => ({ currency: "EUR", bars: [{ day: "2026-09-25", close: new D("21.575"), currency: "EUR" }] }) },
    storedEcb: async () => [],
    priceBefore: async () => null,
    recordFx: s.recordFx,
    recordQuotes: s.recordQuotes,
    log: s.log,
    ...over,
  };
}

const fxTasks: Task[] = [
  { source: "ECB", item: "HUF", kind: "tail", from: "2026-09-25", to: TODAY },
  { source: "ECB", item: "USD", kind: "tail", from: "2026-09-25", to: TODAY },
  { source: "MNB", item: "EUR", kind: "tail", from: "2026-09-25", to: TODAY },
  { source: "MNB", item: "USD", kind: "tail", from: "2026-09-25", to: TODAY },
];
const priceTasks = (...ids: string[]): Task[] =>
  ids.flatMap((id): Task[] => [{ source: "yahoo", item: id, kind: "tail", from: "2026-09-25", to: TODAY }, { source: "yahoo", item: id, kind: "live" }]);

describe("runRefresh", () => {
  it("saves every source, logs one row per item, and a second run adds nothing", async () => {
    const s = store();
    const d = deps({ instruments: [inst("a")] }, s);
    const first = await runRefresh([...fxTasks, ...priceTasks("a")], [], d);
    expect(first.sources.map((x) => [x.source, x.inserted, x.errors])).toEqual([["MNB", 2, 0], ["ECB", 2, 0], ["yahoo", 2, 0]]);
    expect(s.logs.map((l) => `${l.source}/${l.item}/${l.kind}/${l.status}`)).toEqual([
      "ECB/HUF/tail/ok", "ECB/USD/tail/ok", "MNB/EUR/tail/ok", "MNB/USD/tail/ok", "yahoo/a/tail/ok", "yahoo/a/live/ok",
    ]);
    const second = await runRefresh([...fxTasks, ...priceTasks("a")], [], d);
    expect(second.sources.every((x) => x.inserted === 0)).toBe(true);
  });

  it("one source failing does not stop the others; the MNB is then unchecked, not suspect", async () => {
    const s = store();
    const r = await runRefresh(fxTasks, [], deps({ fetchEcb: async () => { throw new ProviderError("timeout"); } }, s));
    expect(r.errors.map((e) => `${e.source}/${e.item}/${e.message}`)).toEqual(["ECB/HUF/timeout", "ECB/USD/timeout"]);
    expect(r.sources.find((x) => x.source === "MNB")).toMatchObject({ inserted: 2, unchecked: 2, suspect: 0 });
  });

  it("an MNB rate more than 1% off the ECB is stored as suspect", async () => {
    const s = store();
    await runRefresh(fxTasks, [], deps({ fetchMnb: async () => [rate("EUR", "HUF", "410", "2026-09-25")] }, s));
    expect([...s.fx.values()].find((r) => r.source === "MNB")!.status).toBe("suspect");
  });

  it("two 429s in a row: the remaining Yahoo items wait for the next refresh", async () => {
    const s = store();
    const history = vi.fn(async (): Promise<History> => { throw new ProviderError("http_429"); });
    const quotes = vi.fn();
    const r = await runRefresh(priceTasks("a", "b", "c"), [], deps({ instruments: [inst("a"), inst("b"), inst("c")], yahoo: { history, splitsSince: async () => [], quotes } }, s));
    expect(history).toHaveBeenCalledTimes(2);
    expect(quotes).not.toHaveBeenCalled();
    expect(s.logs.filter((l) => l.message === "rate_limited").map((l) => `${l.item}/${l.kind}`)).toEqual(["c/tail", "a/live", "b/live", "c/live"]);
    expect(r.continued).toBe(4);
  });

  it("the work budget: what is fetched stays, the rest is marked to continue", async () => {
    let t = 0;
    const budget = createBudget(45_000, () => t, async () => {});
    const s = store();
    const history = vi.fn<(symbol: string, from: Day, to: Day) => Promise<History>>(async () => {
      t += 50_000; // the first instrument uses up the budget
      return { currency: "EUR", bars: [{ day: "2026-09-25", close: new D("100") }], splits: [] };
    });
    const guarded = async <T>(fn: () => Promise<T>) => {
      if (t >= 45_000) throw new ProviderError("budget");
      return fn();
    };
    const r = await runRefresh(priceTasks("a", "b"), [], deps({
      budget,
      instruments: [inst("a"), inst("b")],
      yahoo: {
        history: (sy, f, to) => guarded(() => history(sy, f, to)),
        splitsSince: async () => [],
        quotes: (syms) => guarded(async () => new Map<string, LiveQuote>(syms.map((sy) => [sy, { symbol: sy, price: new D(1), currency: "EUR", asOf: "2026-09-28T09:00:00Z" }]))),
      },
    }, s));
    expect(s.quotes.size).toBe(1);
    expect(s.logs.filter((l) => l.message === "budget").map((l) => `${l.item}/${l.kind}`)).toEqual(["b/tail", "a/live", "b/live"]);
    expect(r.continued).toBe(3);
    expect(r.errors).toEqual([]);
  });

  it("a split in the fetched history: nothing suspect, and a warning when the ledger lacks it", async () => {
    const s = store();
    const history = async (): Promise<History> => ({
      currency: "EUR",
      bars: [{ day: "2026-09-10", close: new D("1000") }, { day: "2026-09-11", close: new D("100.5") }],
      splits: [{ day: "2026-09-11", ratio: new D(10) }],
    });
    const r = await runRefresh(
      [{ source: "yahoo", item: "a", kind: "history", from: "2026-08-22", to: TODAY }, { source: "yahoo", item: "a", kind: "live" }],
      [],
      deps({
        instruments: [inst("a")],
        yahoo: { history, splitsSince: async () => [], quotes: async (sy) => new Map([[sy[0], { symbol: sy[0], price: new D("101"), currency: "EUR", asOf: "2026-09-28T09:00:00.000Z" }]]) },
        priceBefore: async (_id, day) => (day > "2026-09-11" ? { day: "2026-09-11", price: new D("100.5") } : null),
      }, s),
    );
    expect([...s.quotes.values()].every((q) => q.status === "ok")).toBe(true);
    expect(r.splitWarnings).toEqual([{ instrumentId: "a", name: "Eszköz a", day: "2026-09-11", ratio: "10" }]);
  });

  it("a live quote after a split this run has not seen: reads the splits, stays ok", async () => {
    const s = store();
    const splitsSince = vi.fn(async (): Promise<Split[]> => [{ day: "2026-09-28", ratio: new D(4) }]);
    const before: Priced = { day: "2026-09-25", price: new D("400") };
    await runRefresh([{ source: "yahoo", item: "a", kind: "live" }], [], deps({
      instruments: [inst("a")],
      yahoo: { history: vi.fn(), splitsSince, quotes: async (sy) => new Map([[sy[0], { symbol: sy[0], price: new D("101"), currency: "EUR", asOf: "2026-09-28T09:00:00.000Z" }]]) },
      priceBefore: async () => before,
    }, s));
    expect(splitsSince).toHaveBeenCalledWith("A.DE", "2026-09-25");
    expect([...s.quotes.values()][0].status).toBe("ok");
  });

  it("a range Yahoo has no data for (not even the currency) is logged as empty, not as an error", async () => {
    const s = store();
    const summary = await runRefresh(
      [{ source: "yahoo", item: "a", kind: "history", from: "2024-08-26", to: "2024-09-05" }],
      [],
      deps({ instruments: [inst("a")], yahoo: { history: async () => ({ currency: null, bars: [], splits: [] }), splitsSince: async () => [], quotes: async () => new Map() } }, s),
    );
    expect(s.logs.map((l) => [l.item, l.status, l.inserted, l.message])).toEqual([["a", "empty", 0, null]]);
    expect(summary.errors).toEqual([]);
  });

  it("an unknown symbol and a skipped item are logged; the log carries error classes only", async () => {
    const s = store();
    await runRefresh(
      [{ source: "yahoo", item: "a", kind: "live" }],
      [{ source: "MNB", item: "EUR", kind: "tail", reason: "recent" }],
      deps({ instruments: [inst("a")], yahoo: { history: vi.fn(), splitsSince: async () => [], quotes: async () => new Map() } }, s),
    );
    expect(s.logs.map((l) => [l.item, l.status, l.message])).toEqual([["a", "error", "symbol_not_found"], ["EUR", "skipped", null]]);
    const allowed = new Set([null, "timeout", "http_429", "http_5xx", "http_4xx", "symbol_not_found", "network", "parse", "budget", "rate_limited"]);
    expect(s.logs.every((l) => allowed.has(l.message))).toBe(true);
  });
});

describe("runRefresh: the ÁKK (spec 2026-09-28 §4.1, §4.3, §5.4, §9)", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { parsePrices, parseRates } = await import("@/lib/providers/akk");
  const dir = path.join(process.cwd(), "src/lib/providers/__fixtures__");
  const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as unknown;
  const tabs = { MAP: parsePrices("MAP", read("akk-full-map.json")), MAPP: parsePrices("MAPP", read("akk-full-mapp.json")) };
  const history = parseRates(read("akk-full-rates.json")).filter((r) => r.series === "2027/N");
  const m5 = { instrumentId: "m5", name: "MÁP Plusz 2031/M5", series: "2031/M5", kind: "mapp" as const, tab: "MAPP" as const, issue: "2026-07-20", maturity: "2031-08-21" };
  const n27 = { instrumentId: "n27", name: "BMÁP 2027/N", series: "2027/N", kind: "bmap" as const, tab: "MAP" as const, issue: "2023-11-09", maturity: "2027-05-26" };
  const old = { ...m5, instrumentId: "old", name: "MÁP Plusz lejárt", series: "N2026/01", maturity: "2026-09-01" };

  function akkDeps(over: Partial<NonNullable<RefreshDeps["akk"]>> = {}) {
    const saved = { observations: [] as unknown[], checks: [] as { instrumentId: string; status: string }[], rates: [] as unknown[] };
    const akk: NonNullable<RefreshDeps["akk"]> = {
      source: { prices: async (tab) => tabs[tab], rates: async () => history },
      bonds: [m5, n27, old],
      storedRates: async () => [],
      recordRates: async (rows) => (saved.rates.push(...rows), rows.length),
      recordObservations: async (rows) => (saved.observations.push(...rows), rows.length),
      setChecks: async (rows) => void saved.checks.push(...rows),
      ...over,
    };
    return { akk, saved };
  }
  const akkTasks: Task[] = [{ source: "akk", item: "rates", kind: "history" }, { source: "akk", item: "MAP", kind: "live" }, { source: "akk", item: "MAPP", kind: "live" }];

  it("prices, readings and checks per instrument; the matured one at 100% on its day", async () => {
    const s = store();
    const { akk, saved } = akkDeps();
    const r = await runRefresh(akkTasks, [], deps({ akk }, s));
    // The MAP tab first (2027/N), then MAPP (2031/M5 and the matured one).
    expect([...s.quotes.values()].filter((q) => q.source === "akk").map((q) => [q.instrumentId, q.price, q.asOf])).toEqual([
      ["n27", "0.996233", "2026-09-28T21:59:59.000Z"],
      ["m5", "0.999589", "2026-09-28T21:59:59.000Z"],
      ["old", "1", "2026-09-01T21:59:59.000Z"],
    ]);
    expect(saved.checks).toEqual(expect.arrayContaining([
      { instrumentId: "m5", status: "verified", day: TODAY },
      { instrumentId: "n27", status: "verified", day: TODAY },
    ]));
    expect(saved.observations).toHaveLength(2);
    expect(saved.rates).toHaveLength(history.length);
    expect(s.logs.filter((l) => l.source === "akk").map((l) => `${l.item}/${l.kind}/${l.status}`)).toEqual([
      "rates/history/ok", "MAP/live/ok", "n27/live/ok", "MAPP/live/ok", "m5/live/ok", "old/live/ok",
    ]);
    expect(r.sources.find((x) => x.source === "akk")?.inserted).toBe(3);
    expect(r.errors).toEqual([]);
  });

  it("a failing tab: its instruments log the error, keep their last price, and change no check; the rest goes on", async () => {
    const s = store();
    const { akk, saved } = akkDeps({
      source: { prices: async (tab) => { if (tab === "MAPP") throw new ProviderError("http_5xx"); return tabs[tab]; }, rates: async () => history },
    });
    const r = await runRefresh([...akkTasks, ...priceTasks("a")], [], deps({ akk, instruments: [inst("a")] }, s));
    expect([...s.quotes.values()].some((q) => q.instrumentId === "m5")).toBe(false);
    expect(saved.checks.some((c) => c.instrumentId === "m5")).toBe(false);
    expect([...s.quotes.values()].some((q) => q.instrumentId === "old" && q.price === "1")).toBe(true);
    expect(r.errors).toEqual([{ source: "akk", item: "m5", name: "MÁP Plusz 2031/M5", message: "http_5xx" }]);
    expect(s.logs.find((l) => l.source === "yahoo" && l.kind === "live")?.status).toBe("ok");
  });

  it("a failing history: the stored one is used for the check", async () => {
    const { akk, saved } = akkDeps({
      source: { prices: async (tab) => tabs[tab], rates: async () => { throw new ProviderError("timeout"); } },
      storedRates: async () => history,
    });
    const s = store();
    const r = await runRefresh(akkTasks, [], deps({ akk }, s));
    expect(saved.checks).toContainEqual({ instrumentId: "n27", status: "verified", day: TODAY });
    expect(r.errors).toEqual([{ source: "akk", item: "rates", name: "rates", message: "timeout" }]);
  });

  it("a failing stored history (a database error) does not stop the refresh or turn a checked BMÁP unknown (#33)", async () => {
    const { akk, saved } = akkDeps({
      source: { prices: async (tab) => tabs[tab], rates: async () => { throw new ProviderError("timeout"); } },
      storedRates: async () => { throw new Error("refresh: bond_rates: connection reset"); },
    });
    const s = store();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runRefresh(akkTasks, [], deps({ akk }, s));
    expect(logged).toHaveBeenCalledWith("refresh: stored ÁKK rates", "refresh: bond_rates: connection reset");
    logged.mockRestore();
    // Prices and readings still go in, and the log is saved.
    expect([...s.quotes.values()].filter((q) => q.source === "akk").map((q) => q.instrumentId)).toEqual(["n27", "m5", "old"]);
    expect(s.logs.filter((l) => l.source === "akk").map((l) => `${l.item}/${l.status}`)).toEqual(["rates/error", "MAP/ok", "n27/ok", "MAPP/ok", "m5/ok", "old/ok"]);
    // The BMÁP's check is left as it was; the MÁP Plusz, which needs no history, is checked.
    expect(saved.checks.map((c) => c.instrumentId)).toEqual(["m5"]);
    expect(r.errors).toEqual([{ source: "akk", item: "rates", name: "rates", message: "timeout" }]);
  });

  it("the whole BMÁP/PMÁP history is stored, so a series added later today has its periods", async () => {
    const other = { series: "2099/Z", start: "2026-08-01", end: "2026-11-01", rate: new D("7") };
    const { akk, saved } = akkDeps({ source: { prices: async (tab) => tabs[tab], rates: async () => [...history, other] } });
    await runRefresh(akkTasks, [], deps({ akk }));
    expect(saved.rates).toContainEqual(other);
  });

  it("an unreadable row fails only its own instrument, not the tab", async () => {
    const s = store();
    const unreadable = Object.assign(tabs.MAPP.filter((row) => row.series !== "2031/M5"), { broken: ["2031/M5"] });
    const { akk } = akkDeps({ source: { prices: async (tab) => (tab === "MAPP" ? unreadable : tabs[tab]), rates: async () => history } });
    const r = await runRefresh(akkTasks, [], deps({ akk }, s));
    expect(r.errors).toEqual([{ source: "akk", item: "m5", name: "MÁP Plusz 2031/M5", message: "parse" }]);
    expect([...s.quotes.values()].map((q) => q.instrumentId)).toEqual(["n27", "old"]);
  });

  it("a rule mismatch and a missing series are reported, not failed", async () => {
    const s = store();
    const wrong = tabs.MAPP.map((row) => (row.series === "2031/M5" ? { ...row, coupon: new D("5.25") } : row));
    const gone = { ...m5, instrumentId: "gone", name: "Nincs a listán", series: "2099/X" };
    const { akk, saved } = akkDeps({ source: { prices: async (tab) => (tab === "MAPP" ? wrong : tabs[tab]), rates: async () => history }, bonds: [m5, gone] });
    const r = await runRefresh(akkTasks.slice(2), [], deps({ akk }, s));
    expect(saved.checks).toEqual([{ instrumentId: "m5", status: "mismatch", day: TODAY }]);
    expect(r.errors.map((e) => [e.item, e.message])).toEqual([["m5", "rule_mismatch"], ["gone", "not_listed"]]);
    expect([...s.quotes.values()].map((q) => q.instrumentId)).toEqual(["m5"]);
  });
});

describe("runRefresh: the BÉT (spec 2026-09-28 §2.6)", () => {
  const betTail = (id: string): Task => ({ source: "bet", item: id, kind: "tail", from: "2026-09-25", to: TODAY });

  it("a paper that changed its currency: its own currency's closes count, the others are kept as suspect, no error (#41)", async () => {
    const s = store();
    const history = vi.fn(async () => ({
      currency: "EUR",
      bars: [{ day: "2026-09-25", close: new D("8000"), currency: "HUF" }, { day: "2026-09-28", close: new D("21.5"), currency: "EUR" }],
    }));
    const r = await runRefresh([{ source: "bet", item: "x", kind: "tail", from: "2026-09-25", to: TODAY }], [], deps({ instruments: [betInst("x")], bet: { history } }, s));
    expect([...s.quotes.values()].map((q) => [q.price, q.currency, q.status])).toEqual([["8000", "HUF", "suspect"], ["21.5", "EUR", "ok"]]);
    expect(s.logs.map((l) => `${l.item}/${l.status}`)).toEqual(["x/ok"]);
    expect(r.errors).toEqual([]);
  });

  it("closes are saved as BÉT prices, one log row per paper, and there is no live quote", async () => {
    const s = store();
    const history = vi.fn(async () => ({ currency: "EUR", bars: [{ day: "2026-09-25", close: new D("21.575"), currency: "EUR" }] }));
    const r = await runRefresh([betTail("x")], [], deps({ instruments: [betInst("x")], bet: { history } }, s));
    expect(history).toHaveBeenCalledWith("BETX", "2026-09-25", TODAY);
    expect([...s.quotes.values()]).toEqual([{ instrumentId: "x", price: "21.575", currency: "EUR", asOf: "2026-09-25T21:59:59.000Z", source: "bet", status: "ok" }]);
    expect(s.logs.map((l) => `${l.source}/${l.item}/${l.kind}/${l.status}`)).toEqual(["bet/x/tail/ok"]);
    expect(r.sources).toEqual([{ source: "bet", items: 1, inserted: 1, suspect: 0, unchecked: 0, errors: 0, skipped: 0 }]);
  });

  it("the BÉT failing is an error row with the paper's name; Yahoo runs on", async () => {
    const s = store();
    const r = await runRefresh([betTail("x"), ...priceTasks("a")], [], deps({
      instruments: [betInst("x"), inst("a")],
      bet: { history: async () => { throw new ProviderError("http_5xx"); } },
    }, s));
    expect(r.errors).toEqual([{ source: "bet", item: "x", name: "BÉT x", message: "http_5xx" }]);
    expect(s.logs.map((l) => `${l.source}/${l.item}/${l.kind}/${l.status}`)).toEqual(["bet/x/tail/error", "yahoo/a/tail/ok", "yahoo/a/live/ok"]);
  });

  it("no close in the range is empty, not an error", async () => {
    const s = store();
    const r = await runRefresh([betTail("x")], [], deps({ instruments: [betInst("x")], bet: { history: async () => ({ currency: null, bars: [] }) } }, s));
    expect(s.logs.map((l) => l.status)).toEqual(["empty"]);
    expect(r.errors).toEqual([]);
  });

  it("a paper with its currency but no trade in the range is empty too: no price, no error (#43)", async () => {
    const s = store();
    const r = await runRefresh([betTail("x")], [], deps({ instruments: [betInst("x")], bet: { history: async () => ({ currency: "EUR", bars: [] }) } }, s));
    expect(s.logs.map((l) => `${l.status}/${l.inserted}`)).toEqual(["empty/0"]);
    expect(s.quotes.size).toBe(0);
    expect(r.errors).toEqual([]);
  });

  it("another currency than the paper's: stored as suspect, never used", async () => {
    const s = store();
    await runRefresh([betTail("x")], [], deps({ instruments: [betInst("x")], bet: { history: async () => ({ currency: "HUF", bars: [{ day: "2026-09-25", close: new D("8000"), currency: "HUF" }] }) } }, s));
    expect([...s.quotes.values()].map((q) => q.status)).toEqual(["suspect"]);
    expect(s.logs[0]).toMatchObject({ status: "ok", suspect: 1 });
  });

  it("Yahoo stopped by its rate limit: the BÉT still runs", async () => {
    const s = store();
    const bet = vi.fn(async () => ({ currency: "EUR", bars: [{ day: "2026-09-25", close: new D("21.575"), currency: "EUR" }] }));
    await runRefresh([...priceTasks("a", "b", "c"), betTail("x")], [], deps({
      instruments: [inst("a"), inst("b"), inst("c"), betInst("x")],
      yahoo: { history: async (): Promise<History> => { throw new ProviderError("http_429"); }, splitsSince: async () => [], quotes: vi.fn() },
      bet: { history: bet },
    }, s));
    expect(bet).toHaveBeenCalledTimes(1);
    expect(s.logs.find((l) => l.source === "bet")).toMatchObject({ status: "ok", inserted: 1 });
  });
});
