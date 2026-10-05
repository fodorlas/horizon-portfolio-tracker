"use client";
import { createContext, type ReactNode, useContext } from "react";
import { type I18n, i18nFor } from "@/lib/i18n";
import type { Locale } from "@/lib/prefs-shared";

// Hungarian outside a provider: component tests, and nothing the root layout leaves unwrapped.
const LocaleContext = createContext<Locale>("hu");

/** The root layout's language for the client components below it; only the code crosses the boundary. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useI18n(): I18n {
  return i18nFor(useContext(LocaleContext));
}
