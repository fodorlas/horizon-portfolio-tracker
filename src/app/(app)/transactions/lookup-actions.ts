"use server";

import { z } from "zod";
import { guarded } from "@/lib/actions/guard";
import type { ActionResult } from "@/lib/actions/result";
import { akkRows, seriesKey } from "@/lib/entry/akk-source";
import { betSource, searchMarket, symbolSource } from "@/lib/entry/symbols";
import { isDay, todayInBudapest } from "@/lib/finance/money";
import { betLookup } from "@/lib/providers/bet";
import { ProviderError } from "@/lib/providers/http";
import { type SeriesHit, typeLabel } from "@/lib/providers/akk";
import { MAX_QUERY } from "@/lib/providers/yahoo-search";

/** A provider failure is a short form error; the owner can still enter the item by hand. */
async function lookup(fn: () => Promise<ActionResult>, unavailable = "yahooUnavailable"): Promise<ActionResult> {
  return guarded(async () => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ProviderError) return { ok: false, formError: unavailable };
      throw e;
    }
  });
}

/** Tőzsdei papír keresése: the BÉT first, then Yahoo (spec 2026-09-28 §12/3); `yahoo` asks Yahoo only. */
export async function searchSymbols(query: string, where: "auto" | "yahoo" = "auto"): Promise<ActionResult> {
  return lookup(async () => {
    const q = z.string().trim().min(1).max(MAX_QUERY).safeParse(query);
    const w = z.enum(["auto", "yahoo"]).safeParse(where);
    if (!q.success || !w.success) return { ok: true, hits: [], from: "yahoo", betDown: false };
    return { ok: true, ...(await searchMarket(q.data, todayInBudapest(), w.data)) };
  });
}

/** Name, currency, kind and the close on or before `day` (the preview; the save fetches again). */
export async function symbolInfo(symbol: string, day: string, source: "yahoo" | "bet" = "yahoo"): Promise<ActionResult> {
  const from = z.enum(["yahoo", "bet"]).safeParse(source);
  const bet = from.success && from.data === "bet";
  return lookup(async () => {
    const s = z.string().trim().min(1).max(64).safeParse(symbol);
    const today = todayInBudapest();
    if (!s.success || !from.success) return { ok: true, info: null };
    const on = isDay(day) && day <= today ? day : today;
    return { ok: true, info: bet ? await betLookup(betSource(today, undefined, [s.data])).info(s.data, on) : await symbolSource(today).info(s.data, on) };
  }, bet ? "betUnavailable" : "yahooUnavailable");
}

/** Keresés az ÁKK listáján: up to 10 series whose name contains the query (case, "/" and spaces do not matter). */
export async function searchSeries(query: string): Promise<ActionResult> {
  return guarded(async () => {
    const q = z.string().trim().min(1).max(32).safeParse(query);
    if (!q.success) return { ok: true, series: [] };
    try {
      const key = seriesKey(q.data);
      const rows = await akkRows(todayInBudapest(), undefined, [q.data]);
      const series: SeriesHit[] = rows
        .filter((r) => seriesKey(r.series).includes(key))
        .slice(0, 10)
        .map((r) => ({ series: r.series, label: typeLabel(r), maturity: r.maturity, coupon: r.coupon?.toFixed() ?? null }));
      return { ok: true, series };
    } catch (e) {
      if (e instanceof ProviderError) return { ok: false, formError: "akkUnavailable" };
      throw e;
    }
  });
}
