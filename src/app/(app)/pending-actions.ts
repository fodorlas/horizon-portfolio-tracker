"use server";
/**
 * Ellenőrzésre vár (spec 2026-09-28 §6.4): approving a proposal records its
 * events in one call, which marks the proposal approved; Később, Elvetem and
 * Visszaállítás only change its status. Everything through the owner's own
 * session (RLS); the database checks the result once more.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbError, guarded } from "@/lib/actions/guard";
import type { ActionResult } from "@/lib/actions/result";
import { approvalEntry } from "@/lib/bonds/approve";
import { syncProposals } from "@/lib/bonds/sync";
import { loadPortfolio } from "@/lib/data/load";
import { loadPending } from "@/lib/data/pending";
import { runLedger } from "@/lib/finance/ledger";
import { D, isDay, todayInBudapest } from "@/lib/finance/money";
import { fxFnFromRows } from "@/lib/finance/valuation";
import { formLocale } from "@/lib/i18n-server";
import { NOTE_MAX } from "@/lib/tx/build";
import { parseDecimal } from "@/lib/tx/parse";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { earlierPending, seenKey } from "@/lib/views/pending";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

export async function approvePending(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const id = z.uuid().safeParse(fd.get("id"));
    if (!id.success) return { ok: false, formError: "invalid" };
    const db = await createClient();
    const today = todayInBudapest();
    // The proposals as the ledger stands now: a deleted or changed entry since the last
    // Frissítés may have changed the entitled nominal and the amount.
    const data = await loadPortfolio(db);
    await syncProposals(db, data, today);
    const rows = await loadPending(db);
    const row = rows.find((r) => r.id === id.data);
    if (!row || (row.status !== "open" && row.status !== "snoozed")) {
      revalidatePath("/", "layout");
      return { ok: false, formError: "pendingGone" };
    }
    // The order is the server's to keep too, not only the card's (spec §6.4).
    if (earlierPending(rows, row)) return { ok: false, formError: "earlierFirst" };

    const edited = text(fd, "edited") === "1";
    // Figures other than the card showed are not booked unseen.
    if (!edited && text(fd, "seen") !== seenKey(row)) {
      revalidatePath("/", "layout");
      return { ok: false, formError: "pendingChanged" };
    }
    const errors: Record<string, string> = {};
    let amount = row.amount === null ? null : new D(row.amount);
    let date = row.due;
    let note: string | null = null;
    if (edited) {
      const raw = text(fd, "amount");
      if (raw) {
        const p = parseDecimal(raw, await formLocale(fd));
        if (!p.ok) errors.amount = p.error;
        else amount = p.value;
      } else amount = null;
      const day = text(fd, "date") || row.due;
      if (!isDay(day)) errors.date = "date";
      else if (day > today) errors.date = "future";
      else date = day;
      note = text(fd, "note") || null;
      if (note && note.length > NOTE_MAX) errors.note = "noteTooLong";
    }
    const payout = text(fd, "payout") === "withdraw" ? "withdraw" : "keep";
    if (Object.keys(errors).length) return { ok: false, errors };

    const held = runLedger(data.events, fxFnFromRows(data.fxRows), date).positions.get(`${row.accountId}|${row.instrumentId}`)?.qty ?? new D(0);
    const built = approvalEntry(
      { kind: row.kind, instrumentId: row.instrumentId, accountId: row.accountId, nominal: new D(row.nominal) },
      { amount, date, note, payout },
      { held, newId: () => randomUUID(), fxRows: data.fxRows },
    );
    if (!built.ok) return built.error === "amountRequired" ? { ok: false, errors: { amount: "amountRequired" } } : { ok: false, formError: "noHolding" };

    const p = { instruments: [], quotes: [], entries: [built.entry], pending: { id: row.id, edited } } as unknown as Json;
    const { error } = await db.rpc("record_entry", { p });
    if (error) {
      const r = dbError(error);
      // Settled by another tab or click since the check above: show the page as it is now.
      if (!r.ok && r.formError === "pendingGone") revalidatePath("/", "layout");
      return r;
    }
    // Later proposals follow the grown holding at once; a failure here waits for the next Frissítés.
    try {
      await syncProposals(db, await loadPortfolio(db), today);
    } catch (e) {
      console.error("approve: proposals", e instanceof Error ? e.message : e);
    }
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** Status changes only: no ledger event (spec §6.4). */
function setStatus(to: "snoozed" | "dismissed" | "open", from: readonly string[]) {
  return async (fd: FormData): Promise<ActionResult> =>
    guarded(async () => {
      const id = z.uuid().safeParse(fd.get("id"));
      if (!id.success) return { ok: false, formError: "invalid" };
      const db = await createClient();
      const { data, error } = await db.from("pending_events").update({ status: to, updated_at: new Date().toISOString() }).eq("id", id.data).in("status", from).select("id");
      if (error) return dbError(error);
      if (!data?.length) return { ok: false, formError: "pendingGone" };
      revalidatePath("/", "layout");
      return { ok: true };
    });
}

export async function snoozePending(fd: FormData): Promise<ActionResult> {
  return setStatus("snoozed", ["open"])(fd);
}

export async function dismissPending(fd: FormData): Promise<ActionResult> {
  return setStatus("dismissed", ["open", "snoozed"])(fd);
}

export async function restorePending(fd: FormData): Promise<ActionResult> {
  return setStatus("open", ["dismissed"])(fd);
}
