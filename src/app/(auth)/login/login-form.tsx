"use client";

import { useActionState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { signIn, type LoginResult } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const t = useI18n().m.login;
  const [state, action, pending] = useActionState<LoginResult, FormData>(signIn, undefined);

  return (
    <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.email}</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded-xl border border-control bg-card px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.password}</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-xl border border-control bg-card px-3 py-2"
        />
      </label>
      <p role="alert" aria-live="polite" className="min-h-6 text-sm text-loss">
        {state?.error === "invalid" && t.error}
        {state?.error === "rate-limited" && t.rateLimited}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-accent px-4 py-2 font-medium text-accent-contrast disabled:opacity-70"
      >
        {t.submit}
      </button>
    </form>
  );
}
