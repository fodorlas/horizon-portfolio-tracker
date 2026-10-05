"use client";
/**
 * Submitting a form to a server action (plan §1.3):
 *  - the form is not reset, so nothing typed is lost on an error;
 *  - a "reauth" answer opens the code dialog, and after a fresh TOTP the very
 *    same FormData is sent again.
 * Render `dialog` outside the form (a dialog holds its own form).
 */
import { type FormEvent, useCallback, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions/result";
import { INPUT_LOCALE_FIELD } from "@/lib/prefs-shared";
import { createClient } from "@/lib/supabase/client";
import { TextField } from "./fields";
import { useI18n } from "./i18n-provider";
import { Modal } from "./modal";
import { buttonClass } from "./ui";

export type ServerAction = (fd: FormData) => Promise<ActionResult>;

export function useServerForm(
  action: ServerAction,
  opts: { onSuccess?: (form: HTMLFormElement | null, result: Extract<ActionResult, { ok: true }>) => void } = {},
) {
  const { locale } = useI18n();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [reauth, setReauth] = useState(false);
  const waiting = useRef<FormData | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const { onSuccess } = opts;

  const run = useCallback(
    (fd: FormData) =>
      startTransition(async () => {
        const r = await action(fd);
        if (!r.ok && r.reauth) {
          waiting.current = fd;
          setReauth(true);
          return;
        }
        setResult(r);
        if (r.ok) onSuccess?.(form.current, r);
      }),
    [action, onSuccess],
  );

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    form.current = e.currentTarget;
    setResult(null);
    // The clicked button's name/value belongs to the submission too.
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    // The server reads numbers in the language the form was filled in (spec 2026-10-01 §2.5).
    fd.set(INPUT_LOCALE_FIELD, locale);
    run(fd);
  };

  const dialog = (
    <ReauthDialog
      open={reauth}
      onCancel={() => {
        waiting.current = null;
        setReauth(false);
      }}
      onVerified={() => {
        setReauth(false);
        const fd = waiting.current;
        waiting.current = null;
        if (fd) run(fd);
      }}
    />
  );

  const failed = result && !result.ok ? result : null;
  return {
    onSubmit,
    pending,
    ok: result?.ok === true,
    errors: failed?.errors ?? {},
    formError: failed?.formError,
    dialog,
    clear: () => setResult(null),
  };
}

async function verifyTotp(code: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp[0];
  if (error || !factor) return false;
  const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  return !verified.error;
}

export function ReauthDialog({ open, onCancel, onVerified }: { open: boolean; onCancel: () => void; onVerified: () => void }) {
  const { m } = useI18n();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) return setError("code");
    setBusy(true);
    const ok = await verifyTotp(code);
    setBusy(false);
    if (!ok) return setError("code");
    setError(undefined);
    onVerified();
  }

  return (
    <Modal open={open} onClose={onCancel} title={m.reauth.title}>
      <p className="text-text-muted">{m.reauth.intro}</p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-4" noValidate>
        <TextField
          name="code"
          label={m.mfa.code}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          autoFocus
          aria-invalid={error ? true : undefined}
        />
        <div aria-live="polite">
          {error ? (
            <p role="alert" className="text-sm text-loss">
              {m.mfa.error}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonClass.secondary} onClick={onCancel}>
            {m.reauth.cancel}
          </button>
          <button type="submit" className={buttonClass.primary} disabled={busy}>
            {busy ? m.mfa.loading : m.reauth.submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
