"use client";
import { useState } from "react";
import { DISPLAY_CURRENCIES, type DisplayCurrency } from "@/lib/finance/money";
import { useI18n } from "../i18n-provider";
import { type ServerAction, useServerForm } from "../server-form";

/** HUF / EUR / USD for every total on screen (plan §7). Stored in a cookie by a server action. */
export function CurrencySwitcher({ current, action }: { current: DisplayCurrency; action: ServerAction }) {
  const { m } = useI18n();
  const [selected, setSelected] = useState(current);
  const form = useServerForm(action);
  return (
    <>
      <form onSubmit={form.onSubmit}>
        <div role="group" aria-label={m.shell.currency} className="inline-flex rounded-xl border border-border bg-subtle p-1 text-sm">
        {DISPLAY_CURRENCIES.map((c) => (
          <button
            key={c}
            type="submit"
            name="currency"
            value={c}
            aria-pressed={selected === c}
            onClick={() => setSelected(c)}
            className={`rounded-lg px-2.5 py-1 font-medium ${selected === c ? "bg-card text-accent shadow-sm" : "text-text-muted hover:text-text"}`}
          >
            {c}
          </button>
        ))}
        </div>
      </form>
      {form.dialog}
    </>
  );
}
