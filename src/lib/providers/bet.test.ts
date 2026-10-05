import { describe, expect, it } from "vitest";
import { D } from "@/lib/finance/money";
import { betDay, type BetSource, betLookup, codeKey, createBet, parseHistory, parsePapers, parseSession, toBetDay } from "./bet";
import { createBudget, ProviderError } from "./http";

// Invented rows in the BÉT's DETAILED layout (spec §2.6); not real BÉT data.
const HEAD = "﻿Név,Dátum,Utolsó ár,Forgalom (db),Forgalom (HUF érték),Forgalom (EUR érték),Kötések száma,Nyitó ár,Minimum ár,Maximum ár,Deviza,Átlag ár,Kapitalizáció";
const csv = (...rows: string[]) => [HEAD, ...rows].join("\r\n");
const row = (code: string, day: string, price: string, ccy = "EUR") =>
  price ? `${code},${day},${price},100.0,1.0E6,2500.0,3,${price},${price},${price},${ccy},${price},1.0E9` : `${code},${day},,,,,,,,,,,`;
/** A listed paper's day without a trade: no price, but the currency is there (seen 2026-09-30, #43). */
const noTrade = (code: string, day: string, ccy = "HUF") => [code, day, "", "", "", "", "", "", "", "", ccy, "", ""].join(",");

describe("BÉT text formats", () => {
  it("days and codes", () => {
    expect(betDay("2026.09.25.")).toBe("2026-09-25");
    expect(() => betDay("2026-09-25")).toThrow(ProviderError);
    expect(toBetDay("2026-09-25")).toBe("2026.09.25.");
    expect(codeKey(" etf cetop.otp ")).toBe("ETFCETOPOTP");
  });

  it("the session: the csrf token, its header name and the download portlet", () => {
    const html = `<meta name="_csrf" content="tok-1"/><meta name="_csrf_header" content="X-SECURITY"/>
      <div data-url="/oldalak/adatletoltes/$rspid0x117390x12/$rihistoricalGenerator"></div>`;
    expect(parseSession(html)).toEqual({ token: "tok-1", header: "X-SECURITY", portlet: "$rspid0x117390x12" });
    expect(() => parseSession(`<meta name="_csrf" content="tok-1"/>/$rspid0x1x2/$rihistoricalGenerator`)).toThrow(ProviderError);
    expect(() => parseSession("<html></html>")).toThrow(ProviderError);
  });

  it("a paper list: id and code, the kind from the category; anything else is a parse error", () => {
    expect(parsePapers([{ id: 7, code: "TESZTETF" }], "W_ETF")).toEqual([{ id: 7, code: "TESZTETF", category: "W_ETF", assetClass: "etf" }]);
    expect(() => parsePapers({ id: 7 }, "W_ETF")).toThrow(ProviderError);
    expect(() => parsePapers([{ id: "7", code: "X" }], "W_ETF")).toThrow(ProviderError);
  });
});

describe("parseHistory", () => {
  it("the paper's own rows with a price, in day order, with their currency", () => {
    const h = parseHistory(csv(row("TESZTETF", "2026.09.24.", "21.5"), row("TESZTETF", "2026.09.23.", "21.55"), row("MASIK", "2026.09.24.", "9", "HUF")), "TESZTETF");
    expect(h.currency).toBe("EUR");
    expect(h.bars.map((b) => [b.day, b.close.toFixed()])).toEqual([["2026-09-23", "21.55"], ["2026-09-24", "21.5"]]);
  });

  it("a day without a price is not a price; no price at all: no currency", () => {
    expect(parseHistory(csv(row("TESZTETF", "2026.09.21.", ""), row("TESZTETF", "2026.09.22.", "21.775")), "TESZTETF").bars).toHaveLength(1);
    expect(parseHistory(csv(row("TESZTETF", "2026.09.21.", "")), "TESZTETF")).toEqual({ currency: null, bars: [] });
  });

  it("a day without a trade still names the paper's currency: no price, but the currency (#43)", () => {
    expect(parseHistory(csv(noTrade("TESZTSME", "2026.09.21."), noTrade("TESZTSME", "2026.09.22.")), "TESZTSME")).toEqual({ currency: "HUF", bars: [] });
    // The latest day's currency is the paper's, traded or not (#41).
    const h = parseHistory(csv(noTrade("TESZTETF", "2026.09.22.", "EUR"), row("TESZTETF", "2026.09.21.", "8000", "HUF")), "TESZTETF");
    expect(h.currency).toBe("EUR");
    expect(h.bars.map((b) => [b.day, b.currency])).toEqual([["2026-09-21", "HUF"]]);
    expect(() => parseHistory(csv(noTrade("TESZTSME", "2026.09.22.", "huf")), "TESZTSME")).toThrow(ProviderError);
  });

  it("a changed layout or a bad number is a parse error, never a guess", () => {
    expect(() => parseHistory("Név,Dátum,Ár\r\nTESZTETF,2026.09.22.,1", "TESZTETF")).toThrow(ProviderError);
    expect(() => parseHistory(csv(row("TESZTETF", "2026.09.22.", "21,5")), "TESZTETF")).toThrow(ProviderError);
    expect(() => parseHistory(csv(row("TESZTETF", "2026.09.22.", "0")), "TESZTETF")).toThrow(ProviderError);
    expect(() => parseHistory(csv(row("TESZTETF", "2026.09.22.", "1", "")), "TESZTETF")).toThrow(ProviderError);
  });

  it("a paper that changes its currency: every close keeps its own, the latest is the paper's (#41)", () => {
    const h = parseHistory(csv(row("TESZTETF", "2026.09.23.", "8100", "HUF"), row("TESZTETF", "2026.09.22.", "8000", "HUF"), row("TESZTETF", "2026.09.24.", "21.5")), "TESZTETF");
    expect(h.bars.map((b) => [b.day, b.close.toFixed(), b.currency])).toEqual([["2026-09-22", "8000", "HUF"], ["2026-09-23", "8100", "HUF"], ["2026-09-24", "21.5", "EUR"]]);
    expect(h.currency).toBe("EUR");
  });

  it("rows, but none for the paper asked for, is a changed format, not a day without trades", () => {
    expect(() => parseHistory(csv(row("MASIK", "2026.09.22.", "1")), "TESZTETF")).toThrow(ProviderError);
    expect(parseHistory(csv(), "TESZTETF")).toEqual({ currency: null, bars: [] }); // a weekend: the header only
  });
});

describe("betLookup: search and one paper's facts", () => {
  const papers = [
    { id: 1, code: "TESZTETF", category: "W_ETF", assetClass: "etf" as const },
    { id: 2, code: "TESZT", category: "W_RESZVENYA", assetClass: "stock" as const },
    { id: 3, code: "ALTESZT", category: "W_RESZVENYB", assetClass: "stock" as const },
    { id: 4, code: "RITKA", category: "W_CERTI", assetClass: "other" as const },
  ];
  const source = (bars: Record<string, [string, string][]>): BetSource => ({
    papers: async () => papers,
    history: async (code, from, to) => {
      const own = (bars[code] ?? []).filter(([d]) => d >= from && d <= to);
      return { currency: own.length ? "EUR" : null, bars: own.map(([day, p]) => ({ day, close: new D(p), currency: "EUR" })) };
    },
  });

  it("search: exact code first, then codes starting with it, then the rest; marked as BÉT", async () => {
    const hits = await betLookup(source({})).search("teszt");
    expect(hits.map((h) => h.symbol)).toEqual(["TESZT", "TESZTETF", "ALTESZT"]);
    expect(hits[1]).toEqual({ symbol: "TESZTETF", name: "TESZTETF", exchange: "BÉT", assetClass: "etf", source: "bet" });
    expect(await betLookup(source({})).search("  ")).toEqual([]);
  });

  it("search by name words too: the BÉT lists codes only, so each word of three or more letters is tried", async () => {
    const named = [
      { id: 1, code: "ETFCETOPOTP", category: "W_ETF", assetClass: "etf" as const },
      { id: 2, code: "OTP", category: "W_RESZVENYA", assetClass: "stock" as const },
      { id: 3, code: "ETFBUXOTP", category: "W_ETF", assetClass: "etf" as const },
      { id: 4, code: "MTELEKOM", category: "W_RESZVENYA", assetClass: "stock" as const },
    ];
    const s: BetSource = { papers: async () => named, history: async () => ({ currency: null, bars: [] }) };
    const codes = async (q: string) => (await betLookup(s).search(q)).map((h) => h.symbol);
    expect(await codes("cetop etf")).toEqual(["ETFCETOPOTP"]);
    expect((await codes("OTP CETOP"))[0]).toBe("ETFCETOPOTP");
    expect((await codes("OTP Bank"))[0]).toBe("OTP");
    expect(await codes("Magyar Telekom")).toEqual(["MTELEKOM"]);
    expect(await codes("Apple Inc")).toEqual([]);
  });

  it("info: currency, kind and the last close on or before the day", async () => {
    const s = source({ TESZTETF: [["2026-09-24", "21.5"], ["2026-09-25", "21.575"], ["2026-09-28", "22"]] });
    expect(await betLookup(s).info("tesztetf", "2026-09-27")).toEqual({
      symbol: "TESZTETF", name: "TESZTETF", currency: "EUR", assetClass: "etf", exchange: "BÉT", close: { day: "2026-09-25", price: "21.575" },
    });
    expect(await betLookup(s).info("NINCS", "2026-09-27")).toBeNull();
  });

  it("an illiquid paper: the currency from the last year, no close", async () => {
    const s = source({ RITKA: [["2026-03-02", "5"]] });
    expect(await betLookup(s).info("RITKA", "2026-09-27")).toMatchObject({ currency: "EUR", close: null });
  });
});

describe("createBet: one session, then the page's own calls", () => {
  const page = `<meta name="_csrf" content="tok-1"/><meta name="_csrf_header" content="X-SECURITY"/>/oldalak/adatletoltes/$rspid0x1x2/$rihistoricalGenerator`;
  function fakeFetch() {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/oldalak/adatletoltes")) return new Response(page, { headers: { "set-cookie": "JSESSIONID=abc; Path=/; HttpOnly" } });
      if (url.includes("$riinstrument")) return new Response(JSON.stringify(url.includes("groupId=W_ETF") ? [{ id: 7, code: "TESZTETF" }] : []));
      if (url.includes("$rihistoricalGenerator")) return new Response(csv(row("TESZTETF", "2026.09.25.", "21.575")));
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    return { calls, impl };
  }

  it("reads the list once over the last year, posts with the token and the cookie, and finds the paper by its id", async () => {
    const f = fakeFetch();
    const bet = createBet(createBudget(), "2026-09-28", f.impl);
    expect((await bet.history("TESZTETF", "2026-09-20", "2026-09-28")).bars).toHaveLength(1);
    await bet.history("TESZTETF", "2026-09-20", "2026-09-28");
    expect(f.calls.filter((c) => c.url.endsWith("/oldalak/adatletoltes"))).toHaveLength(1);
    const lists = f.calls.filter((c) => c.url.includes("$riinstrument"));
    expect(lists).toHaveLength(7);
    expect(lists[0].url).toContain("startDate=2025.09.28.&endDate=2026.09.28.");
    const post = f.calls.find((c) => c.url.includes("$rihistoricalGenerator"))!;
    expect(post.url).toContain("/$rspid0x1x2/$rihistoricalGenerator?_csrf=tok-1");
    expect(post.init?.headers).toMatchObject({ "X-SECURITY": "tok-1", Cookie: "JSESSIONID=abc", "Content-Type": "application/json" });
    expect(JSON.parse(String(post.init?.body))).toMatchObject({
      startingValue: "2026.09.20.", endingValue: "2026.09.28.", type: "DETAILED", format: "CSV", market: "PROMPT",
      selectionList: [{ category: "W_ETF", selectedInstruments: [{ id: 7, code: "TESZTETF" }] }],
    });
  });

  it("today's row is left out, as with Yahoo: it may not be the final close yet", async () => {
    const f = fakeFetch();
    const impl = (async (url: string, init?: RequestInit) =>
      url.includes("$rihistoricalGenerator") ? new Response(csv(row("TESZTETF", "2026.09.25.", "21.575"), row("TESZTETF", "2026.09.28.", "21.33"))) : f.impl(url, init)) as unknown as typeof fetch;
    const h = await createBet(createBudget(), "2026-09-28", impl).history("TESZTETF", "2026-09-20", "2026-09-28");
    expect(h.bars.map((b) => b.day)).toEqual(["2026-09-25"]);
  });

  it("a BÉT that cannot be reached is tried once per instance: later papers fail at once, not after another wait", async () => {
    let pages = 0;
    const impl = (async (url: string) => {
      if (url.endsWith("/oldalak/adatletoltes")) pages++;
      return new Response("", { status: 503 });
    }) as unknown as typeof fetch;
    const bet = createBet(createBudget(45_000, () => 0, async () => {}), "2026-09-28", impl);
    await expect(bet.history("TESZTETF", "2026-09-20", "2026-09-28")).rejects.toMatchObject({ errorClass: "http_5xx" });
    const tried = pages;
    await expect(bet.history("MASIK", "2026-09-20", "2026-09-28")).rejects.toMatchObject({ errorClass: "http_5xx" });
    expect(pages).toBe(tried);
    expect(tried).toBeLessThanOrEqual(2); // the first try and one retry
  });

  it("a currency change between two yearly downloads is no error either (#41)", async () => {
    const f = fakeFetch();
    const impl = (async (url: string, init?: RequestInit) => {
      if (!url.includes("$rihistoricalGenerator")) return f.impl(url, init);
      const from = JSON.parse(String(init?.body)).startingValue as string;
      return new Response(from.startsWith("2025") ? csv(row("TESZTETF", "2025.12.30.", "8000", "HUF")) : csv(row("TESZTETF", "2026.09.25.", "21.575")));
    }) as unknown as typeof fetch;
    const h = await createBet(createBudget(), "2026-09-28", impl).history("TESZTETF", "2025-09-01", "2026-09-28");
    expect(h.bars.map((b) => [b.day, b.currency])).toEqual([["2025-12-30", "HUF"], ["2026-09-25", "EUR"]]);
    expect(h.currency).toBe("EUR");
  });

  it("with a day's list store, the list is read once a day across instances; a failed list is not kept (#42)", async () => {
    const lists = new Map();
    const f = fakeFetch();
    const listCalls = () => f.calls.filter((c) => c.url.includes("$riinstrument")).length;
    await createBet(createBudget(), "2026-09-28", f.impl, undefined, lists).history("TESZTETF", "2026-09-20", "2026-09-28");
    expect(listCalls()).toBe(7);
    // Another action the same day: a search needs no request at all, a download only the session and itself.
    const before = f.calls.length;
    expect(await betLookup(createBet(createBudget(), "2026-09-28", f.impl, undefined, lists)).search("tesztetf")).toHaveLength(1);
    expect(f.calls.length).toBe(before);
    await createBet(createBudget(), "2026-09-28", f.impl, undefined, lists).history("TESZTETF", "2026-09-20", "2026-09-28");
    expect(listCalls()).toBe(7);
    // The next day reads it again.
    await createBet(createBudget(), "2026-09-29", f.impl, undefined, lists).history("TESZTETF", "2026-09-20", "2026-09-28");
    expect(listCalls()).toBe(14);

    const down = new Map();
    const failing = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await expect(createBet(createBudget(45_000, () => 0, async () => {}), "2026-09-28", failing, undefined, down).papers()).rejects.toMatchObject({ errorClass: "http_5xx" });
    const g = fakeFetch();
    expect(await createBet(createBudget(), "2026-09-28", g.impl, undefined, down).papers()).toHaveLength(1);
    expect(g.calls.filter((c) => c.url.includes("$riinstrument"))).toHaveLength(7);
  });

  it("a listed paper without a trade in the last days is known by its currency, with no close (#43)", async () => {
    const f = fakeFetch();
    let downloads = 0;
    const impl = (async (url: string, init?: RequestInit) => {
      if (!url.includes("$rihistoricalGenerator")) return f.impl(url, init);
      downloads++;
      return new Response(csv(noTrade("TESZTETF", "2026.09.24."), noTrade("TESZTETF", "2026.09.25.")));
    }) as unknown as typeof fetch;
    expect(await betLookup(createBet(createBudget(), "2026-09-28", impl)).info("TESZTETF", "2026-09-27")).toMatchObject({ symbol: "TESZTETF", currency: "HUF", close: null });
    // The last days were enough: no year-long download for the currency.
    expect(downloads).toBe(1);
  });

  it("an unknown code is symbol_not_found; a long range goes year by year", async () => {
    const f = fakeFetch();
    const bet = createBet(createBudget(), "2026-09-28", f.impl);
    await expect(bet.history("NINCS", "2026-09-20", "2026-09-28")).rejects.toMatchObject({ errorClass: "symbol_not_found" });
    await bet.history("TESZTETF", "2024-04-01", "2026-09-28");
    expect(f.calls.filter((c) => c.url.includes("$rihistoricalGenerator"))).toHaveLength(3);
  });
});
