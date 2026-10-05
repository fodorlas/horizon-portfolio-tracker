/**
 * The ÁKK's retail government securities (spec 2026-09-28 §2.1–§2.2): the JSON
 * behind allampapir.hu's price list and its interest history. One csrf token
 * per instance, one request at a time inside the refresh's work budget;
 * failures become error classes, never response content.
 *
 * Prices are percent of the nominal value and net: the accrued interest is a
 * separate field, and the value of 1 Ft nominal is (bid + accrued) / 100 –
 * the two are added exactly once.
 */
import { type BondKind, bondKind } from "@/lib/bonds/rules";
import { addDays, D, type Day, type Dec } from "@/lib/finance/money";
import { type Budget, fetchText, ProviderError, withRetry } from "./http";

const BASE = "https://www.allampapir.hu/api";
const UA = "Mozilla/5.0 (compatible; horizon/1.0)";

export type AkkTab = "MAP" | "MAPP";
export type AkkRow = {
  series: string;
  securityType: string;
  kind: BondKind;
  tab: AkkTab;
  issue: Day;
  maturity: Day;
  /** The day the accrued interest is for (T+2). */
  settle: Day;
  bid: Dec;
  ask: Dec | null;
  accrued: Dec;
  /** The current period's annual rate; null where the ÁKK leaves it empty (BMÁP, PMÁP). */
  coupon: Dec | null;
};
/** One BMÁP or PMÁP interest period: [start, end) at `rate` % a year; interest is due on `end`. */
export type AkkRate = { series: string; start: Day; end: Day; rate: Dec };

/** "2026.09.28" → "2026-09-28". */
export function akkDay(s: string): Day {
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(s)) throw new ProviderError("parse");
  return s.replaceAll(".", "-");
}

/** "99,0000" or "5,00 %" → a number; empty, a band ("5,00 - 6,00 %") or anything else → null. */
export function akkNumber(s: string | null | undefined): Dec | null {
  const v = (s ?? "").replace("%", "").trim();
  if (!/^-?\d+(,\d+)?$/.test(v)) return null;
  return new D(v.replace(",", "."));
}

const required = (v: Dec | null): Dec => {
  if (v === null) throw new ProviderError("parse");
  return v;
};
const BAND = /^\d+(,\d+)?\s*-\s*\d+(,\d+)?$/;
/** A field that may be empty (a coupon also a band, "5,00 - 6,00 %"): none then; anything else unreadable fails the row (#32). */
const optional = (s: string, band = false): Dec | null => {
  const v = s.replace("%", "").trim();
  if (v === "") return null;
  const n = akkNumber(s);
  if (n !== null) return n;
  if (band && BAND.test(v)) return null;
  throw new ProviderError("parse");
};
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** A tab's readable rows; `broken` names the series whose row could not be read (absent: none). */
export type AkkList = AkkRow[] & { broken?: string[] };

/**
 * The rows of one price tab the rules cover (spec §5.1); other types (KTV) are
 * left out. An unreadable row is left out and named, so it fails only its own
 * series; a tab with no readable row at all is a changed format.
 */
export function parsePrices(tab: AkkTab, json: unknown): AkkList {
  const rows = (json as { data?: { data?: unknown } } | null)?.data?.data;
  if (!Array.isArray(rows)) throw new ProviderError("parse");
  const out: AkkRow[] = [];
  const broken: string[] = [];
  let unnamed = 0;
  for (const r of rows as Record<string, unknown>[]) {
    if (typeof r?.name !== "string" || typeof r.securityType !== "string") {
      unnamed++;
      continue;
    }
    const kind = bondKind(r.securityType);
    if (!kind) continue;
    try {
      out.push({
        series: r.name,
        securityType: r.securityType,
        kind,
        tab,
        issue: akkDay(text(r.issueDate)),
        maturity: akkDay(text(r.maturityDate)),
        settle: akkDay(text(r.settleDate)),
        bid: required(akkNumber(text(r.bidPrice))),
        ask: optional(text(r.askPrice)),
        accrued: required(akkNumber(text(r.accruedInterest))),
        coupon: optional(text(r.coupon), true),
      });
    } catch {
      broken.push(r.name);
    }
  }
  if (out.length === 0 && broken.length + unnamed > 0) throw new ProviderError("parse");
  return Object.assign(out, { broken });
}

/**
 * BMÁP and PMÁP interest periods from the history. FixMÁP rows show the
 * sales window and MÁP Plusz rows only the band, so neither is a period rate.
 */
export function parseRates(json: unknown): AkkRate[] {
  const rows = (json as { data?: { data?: unknown } } | null)?.data?.data;
  if (!Array.isArray(rows)) throw new ProviderError("parse");
  const out: AkkRate[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (r?.place !== "BMAP" && r?.place !== "PMAP") continue;
    const rate = akkNumber(text(r.rate));
    if (rate === null || typeof r.name !== "string" || typeof r.validFrom !== "string" || typeof r.validTo !== "string") continue;
    out.push({ series: r.name, start: akkDay(r.validFrom), end: addDays(akkDay(r.validTo), 1), rate });
  }
  return out;
}

/** What 1 Ft nominal is worth today: the Kincstár's bid plus the accrued interest, in forints. */
export const unitValue = (r: AkkRow): Dec => r.bid.plus(r.accrued).div(100);

/** A today's buy of `nominal` at the Kincstár's ask plus accrued interest, whole forints; null without an ask. */
export const buyEstimate = (r: AkkRow, nominal: Dec): Dec | null =>
  r.ask === null ? null : nominal.times(r.ask.plus(r.accrued)).div(100).toDecimalPlaces(0, D.ROUND_HALF_UP);

const LABELS: Record<string, string> = { "MÁP Plusz": "MÁP Plusz", MÁPP_T: "MÁP Plusz", FixMÁP: "FixMÁP", PMÁP: "PMÁP", BMÁP: "BMÁP" };
/** The name the owner knows the type by (both MÁP Plusz kinds are "MÁP Plusz"). */
export const typeLabel = (r: { securityType: string }): string => LABELS[r.securityType] ?? r.securityType;

/** A series on today's list, as the entry form's picker shows it (spec 2026-09-28 §3.1). */
export type SeriesHit = { series: string; label: string; maturity: Day; coupon: string | null };

export type AkkSource = { prices(tab: AkkTab): Promise<AkkList>; rates(): Promise<AkkRate[]> };

/** The real source: one csrf session per instance, then JSON posts with its token and cookie. */
export function createAkk(budget: Budget, fetchImpl: typeof fetch = fetch): AkkSource {
  let session: Promise<{ cookie: string; header: string; token: string }> | null = null;
  const open = () =>
    (session ??= withRetry(async () => {
      const res = await fetchImpl(`${BASE}/csrf`, { headers: { "User-Agent": UA }, cache: "no-store" });
      if (res.status === 429) throw new ProviderError("http_429");
      if (!res.ok) throw new ProviderError(res.status >= 500 ? "http_5xx" : "http_4xx");
      const body = (await res.json().catch(() => null)) as { data?: { headerName?: unknown; token?: unknown } } | null;
      const header = body?.data?.headerName;
      const token = body?.data?.token;
      if (typeof header !== "string" || typeof token !== "string") throw new ProviderError("parse");
      const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      return { cookie, header, token };
    }, budget).catch((e) => {
      session = null; // the next call may try again
      throw e;
    }));

  async function post(path: string, body: unknown): Promise<unknown> {
    const s = await open();
    const init: RequestInit = {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json", [s.header]: s.token, Cookie: s.cookie },
      body: JSON.stringify(body),
    };
    const raw = await withRetry(() => fetchText(`${BASE}${path}`, init, budget, fetchImpl), budget);
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new ProviderError("parse");
    }
  }

  return {
    prices: async (tab) => parsePrices(tab, await post("/networkRate/get_prices", { paper: tab })),
    rates: async () => parseRates(await post("/retailInterest/get_all_data", {})),
  };
}
