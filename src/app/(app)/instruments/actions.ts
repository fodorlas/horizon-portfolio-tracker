"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbError, formFields, guarded, zodErrors } from "@/lib/actions/guard";
import type { ActionResult } from "@/lib/actions/result";
import { allowedPriceSource, instrumentSchema } from "@/lib/actions/schemas";
import { createClient } from "@/lib/supabase/server";

const FIELDS = ["name", "assetClass", "currency", "ticker", "isin", "exchange", "valuation", "priceSource", "providerSymbol", "staleAfterDays"] as const;

export async function createInstrument(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = instrumentSchema.safeParse(formFields(fd, FIELDS));
    if (!v.success) return zodErrors(v.error.issues);
    const d = v.data;
    if (!allowedPriceSource(d.priceSource, null)) return { ok: false, errors: { priceSource: "unknown" } };
    const { error } = await (await createClient()).from("instruments").insert({
      name: d.name,
      asset_class: d.assetClass,
      currency: d.currency,
      ticker: d.ticker,
      isin: d.isin,
      exchange: d.exchange,
      valuation: d.valuation,
      price_source: d.priceSource,
      provider_symbol: d.providerSymbol,
      stale_after_days: d.staleAfterDays,
    });
    if (error?.code === "23505") return { ok: false, errors: { providerSymbol: "duplicateSymbol" } };
    if (error) return dbError(error);
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** Everything but the valuation kind; the currency only while nothing refers to it (the database checks). */
export async function updateInstrument(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const id = z.uuid().safeParse(fd.get("id"));
    if (!id.success) return { ok: false, formError: "invalid" };
    const v = instrumentSchema.safeParse(formFields(fd, FIELDS));
    if (!v.success) return zodErrors(v.error.issues);
    const d = v.data;
    const db = await createClient();
    // Only the settable sources, or the one it already has (an ÁKK paper stays ÁKK).
    const current = await db.from("instruments").select("price_source").eq("id", id.data).maybeSingle();
    if (current.error) return dbError(current.error);
    if (!current.data) return { ok: false, formError: "notFound" };
    if (!allowedPriceSource(d.priceSource, current.data.price_source)) return { ok: false, errors: { priceSource: "unknown" } };
    const { data, error } = await db
      .from("instruments")
      .update({
        name: d.name, asset_class: d.assetClass, currency: d.currency, ticker: d.ticker, isin: d.isin, exchange: d.exchange,
        price_source: d.priceSource, provider_symbol: d.providerSymbol, stale_after_days: d.staleAfterDays,
      })
      .eq("id", id.data)
      .select("id");
    // One Yahoo instrument per symbol: the duplicate is the symbol's.
    if (error?.code === "23505") return { ok: false, errors: { providerSymbol: "duplicateSymbol" } };
    if (error) return dbError(error);
    if (!data?.length) return { ok: false, formError: "notFound" };
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** Only an instrument nothing refers to; its prices and values go with it (delete_instrument). */
export async function deleteInstrument(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const id = z.uuid().safeParse(fd.get("id"));
    if (!id.success) return { ok: false, formError: "invalid" };
    const { error } = await (await createClient()).rpc("delete_instrument", { p_instrument: id.data });
    if (error) return dbError(error);
    revalidatePath("/", "layout");
    return { ok: true };
  });
}
