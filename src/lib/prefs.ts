import "server-only";
import { cookies } from "next/headers";
import { readAppMode } from "@/lib/demo/config";
import type { DisplayCurrency } from "@/lib/finance/money";
import { isDisplayCurrency } from "@/lib/views/portfolio";
import { CURRENCY_COOKIE, LANG_COOKIE, localeForMode, PRIVACY_COOKIE, THEME_COOKIE, THEMES, type Locale, type Theme } from "./prefs-shared";

export type Prefs = { currency: DisplayCurrency; privacy: boolean; theme: Theme; locale: Locale };

export async function getPrefs(): Promise<Prefs> {
  const c = await cookies();
  const currency = c.get(CURRENCY_COOKIE)?.value;
  const theme = c.get(THEME_COOKIE)?.value as Theme | undefined;
  const locale = c.get(LANG_COOKIE)?.value;
  return {
    currency: isDisplayCurrency(currency) ? currency : "HUF",
    privacy: c.get(PRIVACY_COOKIE)?.value === "1",
    theme: theme && THEMES.includes(theme) ? theme : "system",
    locale: localeForMode(locale, readAppMode(process.env).demo),
  };
}
