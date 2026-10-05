"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { requestPasswordReset, type ResetResult } from "./actions";

export function ForgotForm() {
  const { m } = useI18n();
  const t = m.forgot;
  const [state, action, pending] = useActionState<ResetResult, FormData>(requestPasswordReset, undefined);
  return (
    <>
      <p className="mt-2 text-sm text-text-muted">{t.intro}</p>
      <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{m.login.email}</span>
          <input name="email" type="email" autoComplete="username" required className="rounded-xl border border-control bg-card px-3 py-2" />
        </label>
        <div aria-live="polite" className="min-h-6 text-sm">
          {state?.status === "sent" ? <p>{t.sent}</p> : null}
          {state?.status === "invalid" ? <p role="alert" className="text-loss">{t.invalid}</p> : null}
          {state?.status === "rate-limited" ? <p role="alert" className="text-loss">{m.login.rateLimited}</p> : null}
        </div>
        <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2 font-medium text-accent-contrast disabled:opacity-70">
          {t.submit}
        </button>
      </form>
      <p className="mt-6 text-sm">
        <Link href="/login" className="text-accent underline underline-offset-4">
          {t.back}
        </Link>
      </p>
    </>
  );
}
