"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbError, formFields, guarded } from "@/lib/actions/guard";
import type { ActionResult } from "@/lib/actions/result";
import { loadBondFacts } from "@/lib/bonds/sync";
import { loadPortfolio } from "@/lib/data/load";
import { EVENT_TYPES, runLedger } from "@/lib/finance/ledger";
import { D, isDay, todayInBudapest } from "@/lib/finance/money";
import { selectPrice } from "@/lib/finance/prices";
import { fxFnFromRows } from "@/lib/finance/valuation";
import { formLocale } from "@/lib/i18n-server";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { type BuildContext, buildTransaction, TX_FIELDS } from "@/lib/tx/build";
import { buildEntry, lookupPlan, payloadEvents } from "@/lib/entry/build";
import { cashBreaks } from "@/lib/entry/cash";
import { entryContext } from "@/lib/entry/context";
import { parseEntryInput } from "@/lib/entry/input";
import { akkRows, seriesKey } from "@/lib/entry/akk-source";
import { betSource, symbolSource } from "@/lib/entry/symbols";
import { betLookup } from "@/lib/providers/bet";
import { ProviderError, WORK_BUDGET_MS } from "@/lib/providers/http";
import type { AkkRow } from "@/lib/providers/akk";
import type { SymbolInfo } from "@/lib/providers/symbols";

// First line: shape and size of the raw input. The builder does the rest.
const RawInput = z
  .object({ type: z.enum(EVENT_TYPES) })
  .catchall(z.string().max(600))
  .transform((v) => v as Record<string, string>);

export async function recordTransaction(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const raw = RawInput.safeParse(formFields(fd, TX_FIELDS));
    if (!raw.success) return { ok: false, errors: { type: "unknown" } };

    const db = await createClient();
    // Prices are asked for the transaction's own day only (a correction's market value).
    const day = raw.data.date;
    const data = await loadPortfolio(db, isDay(day ?? "") ? { pricesFrom: day } : {});
    const fx = fxFnFromRows(data.fxRows);
    const ctx: BuildContext = {
      today: todayInBudapest(),
      locale: await formLocale(fd),
      accounts: new Map(data.accounts.map((a) => [a.id, { trackingStart: a.trackingStart }])),
      instruments: new Map(data.instrumentMeta.map((i) => [i.id, { currency: i.currency, valuation: i.valuation as "market" | "manual", priceSource: i.price_source }])),
      fxRows: data.fxRows,
      holding: (accountId, instrumentId, day) =>
        runLedger(data.events, fx, day).positions.get(`${accountId}|${instrumentId}`)?.qty ?? new D(0),
      priceOn: (instrumentId, day) => {
        const q = selectPrice(data.quotes, { id: instrumentId, priceSource: ctx.instruments.get(instrumentId)?.priceSource ?? "manual" }, day);
        return q ? new D(q.price) : null;
      },
    };

    const built = buildTransaction(raw.data, ctx);
    if (!built.ok) return { ok: false, errors: built.errors };

    const { event, lines, extras } = built.payload;
    const { error } = await db.rpc("record_event_bundle", {
      p_event: event as unknown as Json,
      p_lines: lines as unknown as Json,
      p_extras: extras as unknown as Json,
    });
    if (error) return dbError(error);
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function deleteTransaction(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const id = z.uuid().safeParse(fd.get("id"));
    if (!id.success) return { ok: false, formError: "invalid" };
    const db = await createClient();
    // Cash a later buy took may not go away with it (spec 2026-09-28 §3.4).
    const loaded = await loadPortfolio(db);
    if (cashBreaks(loaded.events, loaded.events.filter((e) => e.id !== id.data))) return { ok: false, formError: "cashUsedLater" };
    // Lines and a broker rate go with it (on delete cascade); the history check
    // refuses a delete that later events depend on.
    const { data, error } = await db.from("events").delete().eq("id", id.data).select("id");
    if (error) return dbError(error);
    if (!data?.length) return { ok: false, formError: "denied" };
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/*
 * Simple entries (4c): the form sends its whole state as one JSON field. The
 * Yahoo and BÉT facts (name, currency, the close on the buy day) are fetched
 * here again, whatever the browser showed; then one RPC writes everything.
 */
async function saveEntry(fd: FormData, entryId?: string): Promise<ActionResult> {
  const input = parseEntryInput(fd.get("entry"));
  if (!input) return { ok: false, formError: "invalid" };
  const db = await createClient();
  const today = todayInBudapest();
  const data = await loadPortfolio(db, { pricesFrom: today });
  if (entryId !== undefined && ![...data.eventEntries.values()].includes(entryId)) return { ok: false, formError: "notFound" };

  const bondMaturity = new Map((await loadBondFacts(db, data)).map((b) => [b.instrumentId, b.maturity]));
  const base = { today, newId: () => randomUUID(), entryId, bondMaturity, locale: await formLocale(fd) };
  const plan = lookupPlan(input, entryContext(data, { ...base, symbols: new Map() }));
  // Government securities: today's ÁKK list, for a new series' terms or today's estimate (spec 2026-09-28 §3.1–§3.2).
  const akk = new Map<string, AkkRow | null>();
  if (plan.series.length) {
    try {
      const rows = await akkRows(today, WORK_BUDGET_MS, plan.series);
      for (const s of plan.series) akk.set(s, rows.find((r) => seriesKey(r.series) === seriesKey(s)) ?? null);
    } catch (e) {
      if (e instanceof ProviderError) return { ok: false, formError: "akkUnavailable" };
      throw e;
    }
  }
  const symbols = new Map<string, SymbolInfo | null>();
  if (plan.symbols.length) {
    const source = symbolSource(today, WORK_BUDGET_MS);
    try {
      for (const s of plan.symbols) symbols.set(s, await source.info(s, plan.closeDay ?? today, { close: plan.close }));
    } catch (e) {
      if (e instanceof ProviderError) return { ok: false, formError: "yahooUnavailable" };
      throw e;
    }
  }

  const betSymbols = new Map<string, SymbolInfo | null>();
  if (plan.betCodes.length) {
    const bet = betLookup(betSource(today, WORK_BUDGET_MS, plan.betCodes));
    try {
      for (const c of plan.betCodes) betSymbols.set(c, await bet.info(c, plan.closeDay ?? today));
    } catch (e) {
      if (e instanceof ProviderError) return { ok: false, formError: "betUnavailable" };
      throw e;
    }
  }

  const built = buildEntry(input, entryContext(data, { ...base, symbols, betSymbols, akk }));
  if (!built.ok) return { ok: false, errors: built.errors };
  // An edit may not take away cash a later buy took (spec 2026-09-28 §3.4).
  const others = data.events.filter((e) => entryId === undefined || data.eventEntries.get(e.id) !== entryId);
  if (cashBreaks(data.events, [...others, ...payloadEvents(built.payload, new Date().toISOString())])) return { ok: false, formError: "cashUsedLater" };
  const p = built.payload as unknown as Json;
  const { error } = entryId === undefined ? await db.rpc("record_entry", { p }) : await db.rpc("replace_entry", { p_entry: entryId, p });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  // The form keeps working with the broker and account it just created.
  return { ok: true, saved: { institutionId: built.payload.institution?.id ?? input.institution.id, accountId: built.payload.account?.id ?? input.account.id } };
}

export async function recordEntry(fd: FormData): Promise<ActionResult> {
  return guarded(() => saveEntry(fd));
}

export async function replaceEntry(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const id = z.uuid().safeParse(fd.get("entryId"));
    if (!id.success) return { ok: false, formError: "invalid" };
    return saveEntry(fd, id.data);
  });
}

/** The entry's events and its own prices and values go together (delete_entry). */
export async function deleteEntry(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const id = z.uuid().safeParse(fd.get("id"));
    if (!id.success) return { ok: false, formError: "invalid" };
    const db = await createClient();
    // Cash a later buy took may not go away with it (spec 2026-09-28 §3.4).
    const loaded = await loadPortfolio(db);
    const after = loaded.events.filter((e) => loaded.eventEntries.get(e.id) !== id.data);
    if (cashBreaks(loaded.events, after)) return { ok: false, formError: "cashUsedLater" };
    const { error } = await db.rpc("delete_entry", { p_entry: id.data });
    if (error) return dbError(error);
    revalidatePath("/", "layout");
    return { ok: true };
  });
}
