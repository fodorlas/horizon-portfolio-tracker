"use client";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { PREF_MAX_AGE, PRIVACY_COOKIE } from "@/lib/prefs-shared";
import { useI18n } from "../i18n-provider";

/**
 * The eye in the header: blurs every amount (`.amount`) at once. Kept in a
 * cookie so the server renders the next page already blurred, without a flash.
 */
export function PrivacyToggle({ initial }: { initial: boolean }) {
  const { m } = useI18n();
  const [on, setOn] = useState(initial);
  function toggle() {
    const next = !on;
    setOn(next);
    document.documentElement.toggleAttribute("data-private", next);
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${PRIVACY_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${PREF_MAX_AGE}; samesite=lax${secure}`;
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={toggle}
      title={m.shell.privacy}
      className="rounded-xl border border-border bg-card p-2 text-text-muted hover:text-text aria-pressed:border-accent aria-pressed:text-accent"
    >
      {on ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
      <span className="sr-only">{m.shell.privacy}</span>
    </button>
  );
}
