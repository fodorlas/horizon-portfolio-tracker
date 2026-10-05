/**
 * UI text and formatting, one dictionary per language (spec 2026-10-01 §3).
 * Server code gets its language from getI18n (i18n-server.ts), client
 * components from useI18n (components/i18n-provider.tsx); both end here.
 */
import en from "../../messages/en.json";
import hu from "../../messages/hu.json";
import { type Formatters, formatters } from "./format";
import type { Locale } from "./prefs-shared";

export type Messages = typeof hu;

// A missing English key fails the type check here (spec 2026-10-01 §3.1).
const english: Messages = en;
const DICTIONARIES: Record<Locale, Messages> = { hu, en: english };

/** Fills "{name}" placeholders. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? String(vars[key]) : all));
}

export type I18n = { locale: Locale; m: Messages; fill: typeof fill; f: Formatters };

const built = new Map<Locale, I18n>();

/** One language's texts and formatters, built once per language. */
export function i18nFor(locale: Locale): I18n {
  let i = built.get(locale);
  if (!i) {
    const m = DICTIONARIES[locale];
    built.set(locale, (i = { locale, m, fill, f: formatters(locale, m.format) }));
  }
  return i;
}
