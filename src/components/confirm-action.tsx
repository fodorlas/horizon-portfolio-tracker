"use client";
/** A small button that asks first, then runs a server action with hidden fields. */
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { FormMessage } from "./fields";
import { useI18n } from "./i18n-provider";
import { Modal } from "./modal";
import { type ServerAction, useServerForm } from "./server-form";
import { buttonClass } from "./ui";

export function ConfirmDelete({ action, fields, label, title, intro }: { action: ServerAction; fields: Record<string, string>; label: string; title: string; intro?: string }) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  const form = useServerForm(action, { onSuccess: () => setOpen(false) });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-text-muted hover:bg-subtle hover:text-loss" aria-label={label} title={label}>
        <Trash2 aria-hidden="true" size={16} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <form onSubmit={form.onSubmit} className="flex flex-col gap-4">
          {Object.entries(fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {intro ? <p className="text-sm text-text-muted">{intro}</p> : null}
          <p>{m.common.confirmDelete}</p>
          <FormMessage error={form.formError} />
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => setOpen(false)}>
              {m.common.cancel}
            </button>
            <button type="submit" className={buttonClass.danger} disabled={form.pending}>
              {form.pending ? m.common.deleting : m.common.delete}
            </button>
          </div>
        </form>
      </Modal>
      {form.dialog}
    </>
  );
}
