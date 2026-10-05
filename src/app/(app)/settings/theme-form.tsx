"use client";
import { useState } from "react";
import { RadioGroup } from "@/components/fields";
import { useI18n } from "@/components/i18n-provider";
import { type ServerAction, useServerForm } from "@/components/server-form";
import { THEMES, type Theme } from "@/lib/prefs-shared";

/** Theme choice: saved at once, applied by the server on the next render. */
export function ThemeForm({ current, action }: { current: Theme; action: ServerAction }) {
  const { m } = useI18n();
  const [value, setValue] = useState(current);
  const form = useServerForm(action);
  return (
    <>
      <form
        onChange={(e) => e.currentTarget.requestSubmit()}
        onSubmit={form.onSubmit}
      >
        <RadioGroup legend={m.settings.theme} name="theme" value={value} onChange={(v) => setValue(v as Theme)} options={THEMES.map((x) => ({ value: x, label: m.settings.themes[x] }))} />
      </form>
      {form.dialog}
    </>
  );
}
