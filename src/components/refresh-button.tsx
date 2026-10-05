"use client";
/**
 * The Frissítés button (phase 4 plan §5): runs the refresh, then says per
 * source what arrived, what failed and what continues next time. A stale TOTP
 * opens the code dialog first, like every other server action.
 */
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FormMessage } from "@/components/fields";
import { type ServerAction, useServerForm } from "@/components/server-form";
import { buttonClass } from "@/components/ui";
import type { RefreshSummary } from "@/lib/refresh/run";
import { useI18n } from "./i18n-provider";

const sourceName = (s: string) => (s === "yahoo" ? "Yahoo" : s === "bet" ? "BÉT" : s === "akk" ? "ÁKK" : s);
/** A check that did not match is a notice, not a failure (spec 2026-09-28 §9). */
const notice = (message: string) => message === "rule_mismatch";

/**
 * One sentence for the owner: new FX rates (MNB) and new prices. The ECB rows
 * only check the MNB ones; per-source details stay in the log on /prices.
 * Failures, what continues next time and split warnings still show: they need action.
 */
function Summary({ r }: { r: RefreshSummary }) {
  const { m, fill, f } = useI18n();
  const t = m.refresh;
  const inserted = (f: (s: string) => boolean) => r.sources.filter((s) => f(s.source)).reduce((n, s) => n + s.inserted, 0);
  const fx = inserted((s) => s === "MNB");
  const prices = inserted((s) => s === "yahoo" || s === "bet" || s === "akk");
  const failures = r.errors.filter((e) => !notice(e.message));
  const suspect = r.sources.reduce((n, s) => n + s.suspect, 0);
  return (
    <div className="flex flex-col gap-1">
      <p>{fx + prices === 0 ? t.upToDate : fill(t.summary, { fx, prices })}</p>
      {suspect > 0 ? <p>{fill(t.suspectShort, { count: suspect })}</p> : null}
      {r.errors.map((e) => (
        <p key={`${e.source}${e.item}`} className={notice(e.message) ? "text-warn" : "text-loss"}>
          {fill(t.errorLine, { source: sourceName(e.source), name: e.item === "rates" ? t.akkRates : e.name, message: t.messages[e.message] })}
        </p>
      ))}
      {failures.length > 0 ? <p className="text-text-muted">{t.keepLast}</p> : null}
      {r.continued > 0 ? <p>{fill(t.continued, { count: r.continued })}</p> : null}
      {r.splitWarnings.map((w) => (
        <p key={`${w.instrumentId}${w.day}`} className="text-warn">
          <span aria-hidden="true">⚠ </span>
          {fill(t.splitWarning, { day: f.day(w.day), ratio: f.typed(w.ratio), name: w.name })}
        </p>
      ))}
      <p>
        <Link href="/prices" className="underline underline-offset-2">
          {t.details}
        </Link>
      </p>
    </div>
  );
}

export function RefreshButton({ action, lastAt }: { action: ServerAction; lastAt: string | null }) {
  const { m, fill, f } = useI18n();
  const t = m.refresh;
  const [summary, setSummary] = useState<RefreshSummary | null>(null);
  const form = useServerForm(action, { onSuccess: (_f, r) => setSummary(r.refresh ?? null) });
  return (
    <div className="flex flex-col items-end gap-1">
      <form onSubmit={(e) => (setSummary(null), form.onSubmit(e))}>
        <button type="submit" className={buttonClass.secondary} disabled={form.pending} title={t.hint}>
          <RefreshCw aria-hidden="true" size={16} className={form.pending ? "motion-safe:animate-spin" : undefined} />
          {form.pending ? t.running : t.button}
        </button>
      </form>
      <p className="text-xs text-text-muted">{lastAt ? fill(t.last, { when: f.moment(lastAt) }) : t.never}</p>
      <div className="w-full max-w-md text-left">
        <FormMessage error={form.formError} success={summary ? <Summary r={summary} /> : undefined} />
      </div>
      {form.dialog}
    </div>
  );
}
