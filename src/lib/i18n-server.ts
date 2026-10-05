import "server-only";
import { cache } from "react";
import { type I18n, i18nFor } from "./i18n";
import { getPrefs } from "./prefs";
import { INPUT_LOCALE_FIELD, isLocale, type Locale } from "./prefs-shared";

/** The request's language: the horizon_lang cookie, Hungarian without it (spec 2026-10-01 §3.3). Once per request. */
export const getI18n = cache(async (): Promise<I18n> => i18nFor((await getPrefs()).locale));

/** The language a submitted form was filled in: its own field, else the cookie (spec 2026-10-01 §2.5). */
export async function formLocale(fd: FormData): Promise<Locale> {
  const own = fd.get(INPUT_LOCALE_FIELD);
  return isLocale(own) ? own : (await getPrefs()).locale;
}
