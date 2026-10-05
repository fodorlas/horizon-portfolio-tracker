/** Preference cookies. Shared by server code and the client toggles; nothing secret. */
export const CURRENCY_COOKIE = "horizon_ccy";
export const PRIVACY_COOKIE = "horizon_private";
export const THEME_COOKIE = "horizon_theme";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** One year; preferences only. */
export const PREF_MAX_AGE = 60 * 60 * 24 * 365;

/** UI languages (spec 2026-10-01 §3.2). */
export const LOCALES = ["hu", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LANG_COOKIE = "horizon_lang";
/** Each language named in itself, so either can be found from the other (spec 2026-10-01 §3.7). */
export const LANGUAGE_NAMES: Record<Locale, string> = { hu: "Magyar", en: "English" };
export const LANGUAGE_LEGEND = "Nyelv / Language";

/** The language a form was filled in, sent with every server-action submit (spec 2026-10-01 §2.5). */
export const INPUT_LOCALE_FIELD = "inputLocale";

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** Demo defaults are English; live mode keeps the existing Hungarian default. */
export function localeForMode(stored: unknown, demo: boolean): Locale {
  return demo ? "en" : isLocale(stored) ? stored : "hu";
}
