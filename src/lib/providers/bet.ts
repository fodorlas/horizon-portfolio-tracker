/**
 * The Budapest Stock Exchange's own data download (spec 2026-09-28 §2.6): the
 * listed papers per category and their daily closes as CSV. These are the
 * page's own calls, not a documented API: a changed format is a parse error,
 * never a guess. One session per instance, one request at a time inside the
 * work budget (http.ts); failures become error classes, never response content.
 */
import { z } from "zod";
import { addDays, D, type Day, type Dec } from "@/lib/finance/money";
import type { AssetClass } from "@/lib/finance/valuation";
import { type Budget, fetchText, ProviderError, requestSignal, withRetry, yearChunks } from "./http";
import type { SearchHit, SymbolInfo } from "./symbols";

const PAGE = "https://www.bet.hu/oldalak/adatletoltes";
const UA = "Mozilla/5.0 (compatible; horizon/1.0)";

/** The lists read, with the kind of paper on each; the bond lists are left out (percent prices; state bonds are the ÁKK's). */
export const BET_CATEGORIES: Record<string, AssetClass> = {
  W_RESZVENYA: "stock", W_RESZVENYB: "stock", W_RESZV_BA: "stock", W_SME: "stock",
  W_ETF: "etf", W_BEFJEGY: "fund", W_CERTI: "other",
};
/**
 * The list holds the papers listed in its window, traded or not (a window
 * without a trading day still returns them all, checked 2026-09-28); a year
 * keeps a recently delisted paper findable.
 */
export const LIST_DAYS = 365;
export const SEARCH_RESULTS = 8;
/** A close this many days before the asked day still counts (as for Yahoo). */
export const CLOSE_WINDOW_DAYS = 10;

export type BetPaper = { id: number; code: string; category: string; assetClass: AssetClass };
/** Closes in day order, each in its own currency (a paper may change it, #41); `currency` is the latest one. */
export type BetHistory = { currency: string | null; bars: { day: Day; close: Dec; currency: string }[] };
export type BetSource = { papers(): Promise<BetPaper[]>; history(code: string, from: Day, to: Day): Promise<BetHistory> };

/** "2026.09.25." → "2026-09-25". */
export function betDay(s: string): Day {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})\.$/.exec(s.trim());
  if (!m) throw new ProviderError("parse");
  return `${m[1]}-${m[2]}-${m[3]}`;
}
export const toBetDay = (d: Day): string => `${d.replaceAll("-", ".")}.`;

/** Codes compare without case, spaces and dots: "cetop" finds ETFCETOPOTP. */
export const codeKey = (s: string): string => s.toUpperCase().replace(/[\s.]/g, "");

/** The page's csrf token, the header it goes in, and the download portlet. */
export function parseSession(html: string): { token: string; header: string; portlet: string } {
  const token = /<meta name="_csrf" content="([^"]+)"/.exec(html)?.[1];
  const header = /<meta name="_csrf_header" content="([A-Za-z0-9-]+)"/.exec(html)?.[1];
  const portlet = /(\$rspid0x[0-9a-f]+x[0-9a-f]+)\/\$rihistoricalGenerator/.exec(html)?.[1];
  if (!token || !header || !portlet) throw new ProviderError("parse");
  return { token, header, portlet };
}

const paperList = z.array(z.object({ id: z.number().int().positive(), code: z.string().min(1).max(32) }));

export function parsePapers(json: unknown, category: string): BetPaper[] {
  const r = paperList.safeParse(json);
  const assetClass = BET_CATEGORIES[category];
  if (!r.success || !assetClass) throw new ProviderError("parse");
  return r.data.map((p) => ({ id: p.id, code: p.code, category, assetClass }));
}

/** One CSV line; the BÉT does not quote today, but a quoted field is read as one. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const PRICE = /^\d+(\.\d+)?$/;

/**
 * One paper's rows of a DETAILED download: the days with a price, each in its
 * currency. A listed paper's day without a trade has no price but still its
 * currency (#43), so the paper's currency is the latest day's, traded or not.
 */
export function parseHistory(csv: string, code: string): BetHistory {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new ProviderError("parse");
  const head = splitCsv(lines[0]).map((h) => h.trim());
  const col = (name: string) => {
    const i = head.indexOf(name);
    if (i < 0) throw new ProviderError("parse");
    return i;
  };
  const [cName, cDay, cPrice, cCcy] = [col("Név"), col("Dátum"), col("Utolsó ár"), col("Deviza")];
  const bars: BetHistory["bars"] = [];
  let own = 0;
  let latest: { day: Day; currency: string } | null = null;
  for (const line of lines.slice(1)) {
    const f = splitCsv(line).map((x) => x.trim());
    if (f[cName] !== code) continue;
    own++;
    const ccy = f[cCcy] ?? "";
    if (ccy && !/^[A-Z]{3}$/.test(ccy)) throw new ProviderError("parse");
    const day = betDay(f[cDay] ?? "");
    if (ccy && (!latest || day > latest.day)) latest = { day, currency: ccy };
    if (!f[cPrice]) continue; // no trade that day, or before the listing
    if (!PRICE.test(f[cPrice])) throw new ProviderError("parse");
    const close = new D(f[cPrice]);
    if (close.lte(0) || !ccy) throw new ProviderError("parse");
    bars.push({ day, close, currency: ccy });
  }
  // The download names the one paper asked for: rows for others only mean the format changed.
  if (lines.length > 1 && own === 0) throw new ProviderError("parse");
  bars.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return { currency: latest?.currency ?? null, bars };
}

/**
 * The real source: one session per instance, the paper list once, then one
 * download per year of the range. An instance lives for one refresh or one
 * action: a session or list that failed stays failed in it, so the other papers
 * fail at once instead of spending the work budget on the same wait again.
 */
/**
 * Paper lists kept across instances (#42): the list changes at most once a
 * day, and reading it costs a session and seven requests. Keyed by Budapest
 * day and window; only a list read in full is kept, and only today's.
 */
export type BetListStore = Map<string, BetPaper[]>;
/** The app's store, for the server's lifetime (a warm instance serves many actions). */
export const dailyBetLists: BetListStore = new Map();

/**
 * `listDays`: the paper list's window (the spike compares windows; the app keeps the default).
 * `lists`: a day's list store shared by instances (the app passes dailyBetLists; tests and the spike read afresh).
 */
export function createBet(budget: Budget, today: Day, fetchImpl: typeof fetch = fetch, listDays = LIST_DAYS, lists?: BetListStore): BetSource {
  let session: Promise<{ token: string; header: string; portlet: string; cookie: string }> | null = null;
  let list: Promise<BetPaper[]> | null = null;
  const open = () =>
    (session ??= withRetry(async () => {
      const res = await fetchImpl(PAGE, { headers: { "User-Agent": UA }, cache: "no-store", signal: requestSignal(budget) });
      if (res.status === 429) throw new ProviderError("http_429");
      if (!res.ok) throw new ProviderError(res.status >= 500 ? "http_5xx" : "http_4xx");
      const s = parseSession(await res.text());
      const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      return { ...s, cookie };
    }, budget));
  const base = (s: { cookie: string }) => ({ "User-Agent": UA, Cookie: s.cookie });

  const papers = () =>
    (list ??= (async () => {
      const key = `${today}|${listDays}`;
      const kept = lists?.get(key);
      if (kept) return kept;
      const s = await open();
      const from = toBetDay(addDays(today, -listDays));
      const out: BetPaper[] = [];
      for (const category of Object.keys(BET_CATEGORIES)) {
        const url = `${PAGE}/${s.portlet}/$riinstrument?marketType=prompt&groupId=${category}&startDate=${from}&endDate=${toBetDay(today)}&resolution=DAY_TO_DAY`;
        const raw = await withRetry(() => fetchText(url, { headers: base(s) }, budget, fetchImpl), budget);
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          throw new ProviderError("parse");
        }
        out.push(...parsePapers(json, category));
      }
      if (lists) {
        lists.clear();
        lists.set(key, out);
      }
      return out;
    })());

  return {
    papers,
    async history(code, from, to) {
      const paper = (await papers()).find((p) => codeKey(p.code) === codeKey(code));
      if (!paper) throw new ProviderError("symbol_not_found");
      const s = await open();
      let currency: string | null = null;
      const bars: BetHistory["bars"] = [];
      for (const chunk of yearChunks(from, to)) {
        const init: RequestInit = {
          method: "POST",
          headers: { ...base(s), "Content-Type": "application/json", [s.header]: s.token },
          body: JSON.stringify({
            startingValue: toBetDay(chunk.from), endingValue: toBetDay(chunk.to), resolution: "DAY_TO_DAY", market: "PROMPT",
            format: "CSV", type: "DETAILED", currentCategory: paper.category,
            selectionList: [{ category: paper.category, selectedInstruments: [{ id: paper.id, code: paper.code }] }],
          }),
        };
        const url = `${PAGE}/${s.portlet}/$rihistoricalGenerator?_csrf=${encodeURIComponent(s.token)}`;
        const h = parseHistory(await withRetry(() => fetchText(url, init, budget, fetchImpl), budget), paper.code);
        // A later year's currency is the paper's; the refresh checks each close against the instrument's.
        currency = h.currency ?? currency;
        // Today's row may not be the final close yet (as with Yahoo): it comes with a later refresh.
        bars.push(...h.bars.filter((b) => b.day < today));
      }
      return { currency, bars };
    },
  };
}

/** Search and one paper's facts for the entry form, on any BÉT source (the real one or the invented one). */
export function betLookup(source: BetSource) {
  return {
    async search(query: string): Promise<SearchHit[]> {
      const key = codeKey(query);
      if (!key) return [];
      const papers = await source.papers();
      const hit = (p: BetPaper): SearchHit => ({ symbol: p.code, name: p.code, exchange: "BÉT", assetClass: p.assetClass, source: "bet" });
      const rank = (c: string) => (c === key ? 0 : c.startsWith(key) ? 1 : 2);
      const whole = papers.filter((p) => codeKey(p.code).includes(key));
      if (whole.length > 0) {
        return whole.sort((a, b) => rank(codeKey(a.code)) - rank(codeKey(b.code)) || a.code.localeCompare(b.code)).slice(0, SEARCH_RESULTS).map(hit);
      }
      // The BÉT lists codes, not names: "OTP CETOP" or "Magyar Telekom" is tried word by word.
      const words = [...new Set(query.split(/\s+/).map(codeKey).filter((w) => w.length >= 3))];
      const scored = papers
        .map((p) => {
          const c = codeKey(p.code);
          return { p, n: words.filter((w) => c.includes(w)).length, exact: words.includes(c) ? 0 : 1 };
        })
        .filter((x) => x.n > 0);
      // The papers that match the most words (all of them, when one does); a word that is a whole code first.
      const best = Math.max(0, ...scored.map((x) => x.n));
      return scored
        .filter((x) => x.n === best)
        .sort((a, b) => a.exact - b.exact || a.p.code.localeCompare(b.p.code))
        .slice(0, SEARCH_RESULTS)
        .map((x) => hit(x.p));
    },

    async info(code: string, day: Day): Promise<SymbolInfo | null> {
      const paper = (await source.papers()).find((p) => codeKey(p.code) === codeKey(code));
      if (!paper) return null;
      const recent = await source.history(paper.code, addDays(day, -CLOSE_WINDOW_DAYS), day);
      // An illiquid paper: its currency from the last year, without a close.
      const currency = recent.currency ?? (await source.history(paper.code, addDays(day, -365), day)).currency;
      if (!currency) return null;
      const last = recent.bars.filter((b) => b.day <= day).at(-1);
      return {
        symbol: paper.code, name: paper.code, currency, assetClass: paper.assetClass, exchange: "BÉT",
        close: last ? { day: last.day, price: last.close.toFixed() } : null,
      };
    },
  };
}
