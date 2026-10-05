import { DEMO_COPY } from "./copy";
import type { Locale } from "@/lib/prefs-shared";

export function DemoNotice({ locale }: { locale: Locale }) {
  return (
    <aside role="note" className="mb-5 rounded-xl border border-border bg-subtle px-3 py-2 text-xs text-text-muted">
      <span>{DEMO_COPY[locale].readonlyNotice}</span>
    </aside>
  );
}
