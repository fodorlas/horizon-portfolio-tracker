"use client";
import Link from "next/link";
import { useState } from "react";
import { FormMessage, TextField } from "@/components/fields";
import { useI18n } from "@/components/i18n-provider";
import { type ServerAction, useServerForm } from "@/components/server-form";
import { buttonClass } from "@/components/ui";

export function PasswordForm({ email, action }: { email: string; action: ServerAction }) {
  const { m } = useI18n();
  const t = m.password;
  const [resetKey, setResetKey] = useState(0);
  const form = useServerForm(action, { onSuccess: () => setResetKey((k) => k + 1) });
  return (
    <>
      <form key={resetKey} onSubmit={form.onSubmit} className="flex max-w-md flex-col gap-4" noValidate>
        {/* Lets password managers file the new password under the right account. */}
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
        <TextField name="password" type="password" label={t.new} hint={t.intro} autoComplete="new-password" error={form.errors.password} />
        <TextField name="confirm" type="password" label={t.confirm} autoComplete="new-password" error={form.errors.confirm} />
        <FormMessage error={form.formError} success={form.ok ? t.success : undefined} />
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className={buttonClass.primary} disabled={form.pending}>
            {form.pending ? m.common.saving : t.submit}
          </button>
          <Link href="/settings" className="text-sm text-accent underline underline-offset-4">
            {t.back}
          </Link>
        </div>
      </form>
      {form.dialog}
    </>
  );
}
