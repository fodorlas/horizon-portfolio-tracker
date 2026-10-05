"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { createClient } from "@/lib/supabase/client";


type Mode =
  | { kind: "loading" }
  | { kind: "load-error" }
  | { kind: "verify"; factorId: string }
  | { kind: "enroll"; factorId: string; qr: string; secret: string };

export function MfaForm({ next, stale }: { next: string; stale: boolean }) {
  const t = useI18n().m.mfa;
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error || !data) return setMode({ kind: "load-error" });

      const verified = data.totp[0];
      if (verified) return setMode({ kind: "verify", factorId: verified.id });

      // No verified factor yet: clear abandoned enrolments, then start a new one.
      for (const f of data.all.filter((f) => f.factor_type === "totp" && f.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Horizon" });
      if (enrolled.error) return setMode({ kind: "load-error" });
      setMode({
        kind: "enroll",
        factorId: enrolled.data.id,
        qr: enrolled.data.totp.qr_code,
        secret: enrolled.data.totp.secret,
      });
    })();
  }, []);

  async function onSubmit(formData: FormData) {
    if (mode.kind !== "verify" && mode.kind !== "enroll") return;
    const code = String(formData.get("code") ?? "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) return setError(true);

    setPending(true);
    setError(false);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: mode.factorId, code });
    if (error) {
      setPending(false);
      return setError(true);
    }
    // Full navigation so the proxy sees the upgraded (aal2) session cookies.
    window.location.assign(next);
  }

  if (mode.kind === "loading") return <p className="mt-6 text-text-muted">{t.loading}</p>;
  if (mode.kind === "load-error") return <p role="alert" className="mt-6 text-loss">{t.loadError}</p>;

  return (
    <div className="mt-4">
      {mode.kind === "enroll" ? (
        <>
          <p className="text-text-muted">{t.enrollIntro}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URL SVG from Supabase */}
          <img src={mode.qr} alt={t.qrAlt} className="mx-auto mt-4 h-48 w-48 rounded-xl bg-white p-2" />
          <p className="mt-4 text-sm text-text-muted">{t.manualKey}</p>
          <code className="mt-1 block break-all rounded-lg border border-border px-2 py-1 text-sm">{mode.secret}</code>
        </>
      ) : (
        <p className="text-text-muted">{stale ? t.staleIntro : t.verifyIntro}</p>
      )}

      <form action={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t.code}</span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={7}
            required
            autoFocus
            aria-invalid={error}
            aria-describedby="mfa-error"
            className="rounded-xl border border-control bg-card px-3 py-2 text-lg tracking-widest"
          />
        </label>
        <p id="mfa-error" role="alert" aria-live="polite" className="min-h-6 text-sm text-loss">
          {error && t.error}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-accent px-4 py-2 font-medium text-accent-contrast disabled:opacity-70"
        >
          {t.submit}
        </button>
      </form>
    </div>
  );
}
