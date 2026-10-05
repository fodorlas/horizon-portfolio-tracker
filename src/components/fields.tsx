"use client";
/**
 * Form fields: a visible label, an optional hint and an error, all wired with
 * aria-describedby / aria-invalid. Error values are keys of messages.errors.
 */
import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from "react";
import type { Messages } from "@/lib/i18n";
import { useI18n } from "./i18n-provider";

const errorText = (m: Messages, code: string | undefined) => (code ? ((m.errors as Record<string, string>)[code] ?? m.errors.invalid) : undefined);

export const inputClass =
  "w-full rounded-xl border border-control bg-card px-3 py-2 text-base text-text placeholder:text-text-muted aria-[invalid=true]:border-loss disabled:bg-subtle disabled:text-text-muted";

type Common = { label: string; hint?: ReactNode; error?: string; optional?: boolean; className?: string };

function Wrap({ id, label, hint, error, optional, className = "", children }: Common & { id: string; children: ReactNode }) {
  const { m } = useI18n();
  const message = errorText(m, error);
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {optional ? <span className="font-normal text-text-muted"> ({m.common.optional})</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={`${id}-error`} className="text-sm text-loss">
          {message}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint: unknown, error: unknown) =>
  [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

export function TextField({ label, hint, error, optional, className, ...props }: Common & InputHTMLAttributes<HTMLInputElement> & { name: string }) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <input
        id={id}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      />
    </Wrap>
  );
}

/** Decimal input: text with a decimal keypad, so "1 234,56" can be typed as is. */
export function NumberField(props: Common & InputHTMLAttributes<HTMLInputElement> & { name: string }) {
  return <TextField inputMode="decimal" autoComplete="off" spellCheck={false} {...props} />;
}

export function DateField(props: Common & InputHTMLAttributes<HTMLInputElement> & { name: string }) {
  return <TextField type="date" {...props} />;
}

export type Option = { value: string; label: string };
export type OptionGroup = { label: string; options: Option[] };

export function SelectField({
  label,
  hint,
  error,
  optional,
  className,
  options,
  groups,
  placeholder,
  ...props
}: Common & SelectHTMLAttributes<HTMLSelectElement> & { name: string; options?: Option[]; groups?: OptionGroup[]; placeholder?: string }) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <select id={id} className={inputClass} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...props}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {groups?.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Wrap>
  );
}

export function TextArea({ label, hint, error, optional, className, ...props }: Common & React.TextareaHTMLAttributes<HTMLTextAreaElement> & { name: string }) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <textarea id={id} rows={2} className={inputClass} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...props} />
    </Wrap>
  );
}

/** Radio group as a fieldset with a legend. */
export function RadioGroup({
  legend,
  name,
  options,
  value,
  onChange,
  error,
}: {
  legend: string;
  name: string;
  options: Option[];
  value?: string;
  onChange?: (v: string) => void;
  error?: string;
}) {
  const { m } = useI18n();
  const message = errorText(m, error);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-control px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === undefined ? undefined : value === o.value}
              onChange={onChange ? () => onChange(o.value) : undefined}
              className="accent-[var(--accent)]"
            />
            {o.label}
          </label>
        ))}
      </div>
      {message ? <p className="text-sm text-loss">{message}</p> : null}
    </fieldset>
  );
}

export function FormMessage({ error, success }: { error?: string; success?: ReactNode }) {
  const { m } = useI18n();
  const message = errorText(m, error);
  // The live region is always there, so a later success message is announced.
  return (
    <div aria-live="polite">
      {message ? (
        <p role="alert" className="rounded-xl border border-loss/40 px-3 py-2 text-sm text-loss">
          {message}
        </p>
      ) : success ? (
        <p className="rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm">{success}</p>
      ) : null}
    </div>
  );
}
