"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbError, formFields, guarded, zodErrors } from "@/lib/actions/guard";
import type { ActionResult } from "@/lib/actions/result";
import { accountSchema, institutionSchema } from "@/lib/actions/schemas";
import { todayInBudapest } from "@/lib/finance/money";
import { createClient } from "@/lib/supabase/server";

export async function createInstitution(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = institutionSchema.safeParse(formFields(fd, ["name"]));
    if (!v.success) return zodErrors(v.error.issues);
    const { error } = await (await createClient()).from("institutions").insert({ name: v.data.name });
    if (error) return dbError(error);
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function createAccount(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = accountSchema(todayInBudapest()).safeParse(formFields(fd, ["institutionId", "name", "accountType", "trackingStart"]));
    if (!v.success) return zodErrors(v.error.issues);
    const { error } = await (await createClient()).from("accounts").insert({
      institution_id: v.data.institutionId,
      name: v.data.name,
      account_type: v.data.accountType,
      tracking_start_date: v.data.trackingStart,
    });
    if (error) return dbError(error);
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

const idOf = (fd: FormData, name = "id") => z.uuid().safeParse(fd.get(name));

/** Name, type and broker; the tracking start only earlier (the database refuses anything else). */
export async function updateAccount(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const id = idOf(fd);
    if (!id.success) return { ok: false, formError: "invalid" };
    const v = accountSchema(todayInBudapest()).safeParse(formFields(fd, ["institutionId", "name", "accountType", "trackingStart"]));
    if (!v.success) return zodErrors(v.error.issues);
    const { data, error } = await (await createClient())
      .from("accounts")
      .update({ institution_id: v.data.institutionId, name: v.data.name, account_type: v.data.accountType, tracking_start_date: v.data.trackingStart })
      .eq("id", id.data)
      .select("id");
    if (error) return dbError(error);
    if (!data?.length) return { ok: false, formError: "notFound" };
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function renameInstitution(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const id = idOf(fd);
    if (!id.success) return { ok: false, formError: "invalid" };
    const v = institutionSchema.safeParse(formFields(fd, ["name"]));
    if (!v.success) return zodErrors(v.error.issues);
    const { data, error } = await (await createClient()).from("institutions").update({ name: v.data.name }).eq("id", id.data).select("id");
    if (error) return dbError(error);
    if (!data?.length) return { ok: false, formError: "notFound" };
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** Everything on the account goes, after its name is typed (delete_account checks it again). */
export async function deleteAccount(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const id = idOf(fd);
    if (!id.success) return { ok: false, formError: "invalid" };
    const name = String(fd.get("confirmName") ?? "").trim();
    if (!name) return { ok: false, errors: { confirmName: "required" } };
    const { error } = await (await createClient()).rpc("delete_account", { p_account: id.data, p_name: name });
    if (error) return dbError(error);
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** A broker without accounts (an account with it is refused by its foreign key: "inUse"). */
export async function deleteInstitution(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const id = idOf(fd);
    if (!id.success) return { ok: false, formError: "invalid" };
    const { data, error } = await (await createClient()).from("institutions").delete().eq("id", id.data).select("id");
    if (error) return dbError(error);
    if (!data?.length) return { ok: false, formError: "notFound" };
    revalidatePath("/", "layout");
    return { ok: true };
  });
}
