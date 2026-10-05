"use client";
/**
 * A button that opens a small form in a dialog. Fields are described as data,
 * so server pages can use it directly; errors come back from the action.
 */
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { DateField, FormMessage, NumberField, type Option, type OptionGroup, SelectField, TextArea, TextField } from "./fields";
import { useI18n } from "./i18n-provider";
import { Modal } from "./modal";
import { type ServerAction, useServerForm } from "./server-form";
import { buttonClass } from "./ui";

type Base = { name: string; label: string; hint?: string; optional?: boolean; defaultValue?: string };
export type FieldSpec =
  | (Base & { kind: "text" | "number" | "date"; max?: string; maxLength?: number; placeholder?: string; autoComplete?: string })
  | (Base & { kind: "select"; options?: Option[]; groups?: OptionGroup[]; placeholder?: string })
  | (Base & { kind: "textarea"; maxLength?: number })
  | { kind: "hidden"; name: string; value: string };

const icons = { plus: Plus, pencil: Pencil };

export function FormDialog({
  label,
  title,
  intro,
  action,
  fields,
  submit,
  variant = "primary",
  icon,
  compact = false,
}: {
  label: string;
  title?: string;
  intro?: string;
  action: ServerAction;
  fields: FieldSpec[];
  submit?: string;
  variant?: keyof typeof buttonClass;
  icon?: keyof typeof icons;
  /** Icon-only trigger (e.g. "Javítás" in a table row); the label becomes its name. */
  compact?: boolean;
}) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  const form = useServerForm(action, { onSuccess: () => setOpen(false) });
  const Icon = icon ? icons[icon] : null;
  const e = form.errors;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          form.clear();
          setOpen(true);
        }}
        className={compact ? "rounded-lg p-1.5 text-text-muted hover:bg-subtle hover:text-accent" : buttonClass[variant]}
        aria-label={compact ? label : undefined}
        title={compact ? label : undefined}
      >
        {Icon ? <Icon aria-hidden="true" size={compact ? 16 : 18} /> : null}
        {compact ? null : label}
      </button>
      <span role="status" className="sr-only">
        {form.ok ? m.common.saved : ""}
      </span>
      <Modal open={open} onClose={() => setOpen(false)} title={title ?? label}>
        {intro ? <p className="mb-4 text-sm text-text-muted">{intro}</p> : null}
        <form onSubmit={form.onSubmit} className="flex flex-col gap-4" noValidate>
          {fields.map((f) => {
            if (f.kind === "hidden") return <input key={f.name} type="hidden" name={f.name} value={f.value} />;
            const common = { name: f.name, label: f.label, hint: f.hint, optional: f.optional, defaultValue: f.defaultValue, error: e[f.name] };
            switch (f.kind) {
              case "text":
                return <TextField key={f.name} {...common} maxLength={f.maxLength} placeholder={f.placeholder} autoComplete={f.autoComplete ?? "off"} />;
              case "number":
                return <NumberField key={f.name} {...common} />;
              case "date":
                return <DateField key={f.name} {...common} max={f.max} />;
              case "select":
                return <SelectField key={f.name} {...common} options={f.options} groups={f.groups} placeholder={f.placeholder} />;
              case "textarea":
                return <TextArea key={f.name} {...common} maxLength={f.maxLength} />;
            }
          })}
          <FormMessage error={form.formError} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => setOpen(false)}>
              {m.common.cancel}
            </button>
            <button type="submit" className={buttonClass.primary} disabled={form.pending}>
              {form.pending ? m.common.saving : (submit ?? m.common.save)}
            </button>
          </div>
        </form>
      </Modal>
      {form.dialog}
    </>
  );
}
