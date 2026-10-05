"use client";

import { DEMO_COPY } from "./copy";
import type { Locale } from "@/lib/prefs-shared";
import { DEMO_STORAGE_KEY } from "@/lib/demo/store";

export function DemoResetButton({ locale }: { locale: Locale }) {
  return (
    <form
      action="/demo/reset"
      method="post"
      onSubmit={() => {
        try {
          localStorage.removeItem(DEMO_STORAGE_KEY);
        } catch {
          // The reset route still clears preference cookies if browser storage is unavailable.
        }
      }}
    >
      <button type="submit" className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-accent underline underline-offset-2 hover:bg-card">
        {DEMO_COPY[locale].reset}
      </button>
    </form>
  );
}
