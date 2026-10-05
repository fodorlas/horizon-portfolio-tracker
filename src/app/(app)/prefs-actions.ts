"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { guarded } from "@/lib/actions/guard";
import type { ActionResult } from "@/lib/actions/result";
import { CURRENCY_COOKIE, isLocale, LANG_COOKIE, PREF_MAX_AGE, THEME_COOKIE, THEMES, type Theme } from "@/lib/prefs-shared";
import { isDisplayCurrency } from "@/lib/views/portfolio";

async function setPref(name: string, value: string) {
  (await cookies()).set(name, value, {
    path: "/",
    maxAge: PREF_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
}

export async function setDisplayCurrency(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = fd.get("currency");
    if (typeof v !== "string" || !isDisplayCurrency(v)) return { ok: false, formError: "invalid" };
    await setPref(CURRENCY_COOKIE, v);
    return { ok: true };
  });
}

export async function setTheme(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = fd.get("theme");
    if (typeof v !== "string" || !THEMES.includes(v as Theme)) return { ok: false, formError: "invalid" };
    await setPref(THEME_COOKIE, v);
    return { ok: true };
  });
}

/** The UI language (spec 2026-10-01 §3.2): a cookie like the theme; the next render uses it. */
export async function setLanguage(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = fd.get("language");
    if (!isLocale(v)) return { ok: false, formError: "invalid" };
    await setPref(LANG_COOKIE, v);
    return { ok: true };
  });
}
