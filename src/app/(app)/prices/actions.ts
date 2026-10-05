"use server";

import { revalidatePath } from "next/cache";
import { dbError, formFields, guarded, zodErrors } from "@/lib/actions/guard";
import type { ActionResult } from "@/lib/actions/result";
import { fxSchema, priceSchema, supersedeSchema, supersedeValuationSchema, valuationSchema } from "@/lib/actions/schemas";
import { todayInBudapest } from "@/lib/finance/money";
import { formLocale } from "@/lib/i18n-server";
import { createClient } from "@/lib/supabase/server";
import { numeric } from "@/lib/supabase/numeric";
import { endOfDayBudapest } from "@/lib/tx/parse";

/*
 * Prices, FX rates and manual values are append-only (plan §3.3): a correction
 * is a new manual row that points at the one it replaces and takes its slot
 * (same instrument/pair and moment). The database checks that slot again.
 */

const done = (): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true };
};

export async function addPrice(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = priceSchema(todayInBudapest(), await formLocale(fd)).safeParse(formFields(fd, ["instrumentId", "day", "price", "note"]));
    if (!v.success) return zodErrors(v.error.issues);
    const db = await createClient();
    const inst = await db.from("instruments").select("currency").eq("id", v.data.instrumentId).maybeSingle();
    if (inst.error) return dbError(inst.error);
    if (!inst.data) return { ok: false, errors: { instrumentId: "unknown" } };
    const { error } = await db.from("price_quotes").insert({
      instrument_id: v.data.instrumentId,
      price: numeric(v.data.price),
      currency: inst.data.currency,
      as_of: endOfDayBudapest(v.data.day),
      source: "manual",
      note: v.data.note,
    });
    return error ? dbError(error) : done();
  });
}

export async function addFxRate(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = fxSchema(todayInBudapest(), await formLocale(fd)).safeParse(formFields(fd, ["base", "quote", "day", "rate", "note"]));
    if (!v.success) return zodErrors(v.error.issues);
    const { error } = await (await createClient()).from("fx_rates").insert({
      base: v.data.base,
      quote: v.data.quote,
      rate: numeric(v.data.rate),
      rate_date: v.data.day,
      source: "manual",
      note: v.data.note,
    });
    return error ? dbError(error) : done();
  });
}

export async function addValuation(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = valuationSchema(todayInBudapest(), await formLocale(fd)).safeParse(formFields(fd, ["accountId", "instrumentId", "day", "value", "note"]));
    if (!v.success) return zodErrors(v.error.issues);
    const db = await createClient();
    const inst = await db.from("instruments").select("currency, valuation").eq("id", v.data.instrumentId).maybeSingle();
    if (inst.error) return dbError(inst.error);
    if (!inst.data) return { ok: false, errors: { instrumentId: "unknown" } };
    if (inst.data.valuation !== "manual") return { ok: false, errors: { instrumentId: "notManual" } };
    const { error } = await db.from("manual_valuations").insert({
      account_id: v.data.accountId,
      instrument_id: v.data.instrumentId,
      value: numeric(v.data.value),
      currency: inst.data.currency,
      as_of: endOfDayBudapest(v.data.day),
      note: v.data.note,
    });
    return error ? dbError(error) : done();
  });
}

export async function correctPrice(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = supersedeSchema(await formLocale(fd)).safeParse(formFields(fd, ["supersedesId", "amount", "note"]));
    if (!v.success) return zodErrors(v.error.issues);
    const db = await createClient();
    const orig = await db.from("price_quotes").select("instrument_id, currency, as_of").eq("id", v.data.supersedesId).maybeSingle();
    if (orig.error) return dbError(orig.error);
    if (!orig.data) return { ok: false, formError: "denied" };
    const { error } = await db.from("price_quotes").insert({
      instrument_id: orig.data.instrument_id,
      price: numeric(v.data.amount),
      currency: orig.data.currency,
      as_of: orig.data.as_of,
      source: "manual",
      supersedes_id: v.data.supersedesId,
      note: v.data.note,
    });
    return error ? dbError(error) : done();
  });
}

export async function correctFxRate(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = supersedeSchema(await formLocale(fd)).safeParse(formFields(fd, ["supersedesId", "amount", "note"]));
    if (!v.success) return zodErrors(v.error.issues);
    const db = await createClient();
    const orig = await db.from("fx_rates").select("base, quote, rate_date, source").eq("id", v.data.supersedesId).maybeSingle();
    if (orig.error) return dbError(orig.error);
    // A broker rate belongs to its FX exchange: it is corrected by fixing the exchange.
    if (!orig.data || orig.data.source === "broker") return { ok: false, formError: "denied" };
    const { error } = await db.from("fx_rates").insert({
      base: orig.data.base,
      quote: orig.data.quote,
      rate: numeric(v.data.amount),
      rate_date: orig.data.rate_date,
      source: "manual",
      supersedes_id: v.data.supersedesId,
      note: v.data.note,
    });
    return error ? dbError(error) : done();
  });
}

export async function correctValuation(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = supersedeValuationSchema(await formLocale(fd)).safeParse(formFields(fd, ["supersedesId", "amount", "note"]));
    if (!v.success) return zodErrors(v.error.issues);
    const db = await createClient();
    const orig = await db
      .from("manual_valuations")
      .select("account_id, instrument_id, currency, as_of")
      .eq("id", v.data.supersedesId)
      .maybeSingle();
    if (orig.error) return dbError(orig.error);
    if (!orig.data) return { ok: false, formError: "denied" };
    const { error } = await db.from("manual_valuations").insert({
      account_id: orig.data.account_id,
      instrument_id: orig.data.instrument_id,
      value: numeric(v.data.amount),
      currency: orig.data.currency,
      as_of: orig.data.as_of,
      supersedes_id: v.data.supersedesId,
      note: v.data.note,
    });
    return error ? dbError(error) : done();
  });
}
