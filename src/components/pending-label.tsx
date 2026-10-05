"use client";
/**
 * A link's label that pulses while the page it opens is loading: a slow
 * period switch no longer looks like nothing happened (2026-09-30). Only the
 * look changes, so nothing moves; a screen reader hears that it is loading.
 */
import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "./i18n-provider";

export function PendingLabel({ children }: { children: ReactNode }) {
  const { m } = useI18n();
  const { pending } = useLinkStatus();
  return (
    <span className={pending ? "animate-pulse opacity-60" : undefined}>
      {children}
      {pending ? <span className="sr-only"> ({m.common.loading})</span> : null}
    </span>
  );
}
