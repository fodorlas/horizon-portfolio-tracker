"use client";
import { useState } from "react";
import { RadioGroup } from "@/components/fields";
import { type ServerAction, useServerForm } from "@/components/server-form";
import { LANGUAGE_LEGEND, LANGUAGE_NAMES, LOCALES, type Locale } from "@/lib/prefs-shared";

/** The UI language: saved at once, applied by the server on the next render (like the theme). */
export function LanguageForm({ current, action }: { current: Locale; action: ServerAction }) {
  const [value, setValue] = useState(current);
  const form = useServerForm(action);
  return (
    <>
      <form onChange={(e) => e.currentTarget.requestSubmit()} onSubmit={form.onSubmit}>
        <RadioGroup legend={LANGUAGE_LEGEND} name="language" value={value} onChange={(v) => setValue(v as Locale)} options={LOCALES.map((x) => ({ value: x, label: LANGUAGE_NAMES[x] }))} />
      </form>
      {form.dialog}
    </>
  );
}
