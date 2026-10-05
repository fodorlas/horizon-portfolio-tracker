"use client";
/**
 * Deleting an account with everything on it (4c plan §3): the dialog says
 * what goes, and the button works only after the account's name is typed.
 * delete_account checks the name once more.
 */
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { FormMessage, TextField } from "@/components/fields";
import { useI18n } from "@/components/i18n-provider";
import { Modal } from "@/components/modal";
import { type ServerAction, useServerForm } from "@/components/server-form";
import { buttonClass } from "@/components/ui";

export type DeleteSummary = { entries: number; events: number; values: number; transfers: number; lastOfBroker: boolean; instruments: string[] };

export function DeleteAccount({ accountId, name, summary, action }: { accountId: string; name: string; summary: DeleteSummary; action: ServerAction }) {
  const { m, fill } = useI18n();
  const t = m.accounts;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const form = useServerForm(action, { onSuccess: () => setOpen(false) });
  const title = fill(t.deleteTitle, { name });
  return (
    <>
      <button type="button" className={buttonClass.secondary} onClick={() => (setTyped(""), form.clear(), setOpen(true))} aria-label={title}>
        <Trash2 aria-hidden="true" size={16} />
        {t.delete}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <form onSubmit={form.onSubmit} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="id" value={accountId} />
          <p className="text-sm">{t.deleteIntro}</p>
          <ul className="list-disc pl-5 text-sm">
            <li>{fill(t.deleteSummary, { entries: summary.entries, events: summary.events, values: summary.values })}</li>
            {summary.transfers ? <li>{fill(t.deleteTransfers, { count: summary.transfers })}</li> : null}
            {summary.lastOfBroker ? <li>{t.deleteBroker}</li> : null}
            {summary.instruments.length ? <li>{fill(t.deleteInstruments, { names: summary.instruments.join(", ") })}</li> : null}
          </ul>
          <TextField
            name="confirmName"
            label={fill(t.confirmName, { name })}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            error={form.errors.confirmName}
          />
          <FormMessage error={form.formError} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => setOpen(false)}>
              {m.common.cancel}
            </button>
            <button type="submit" className={buttonClass.danger} disabled={form.pending || typed.trim() !== name.trim()}>
              {form.pending ? m.common.deleting : t.deleteSubmit}
            </button>
          </div>
        </form>
      </Modal>
      {form.dialog}
    </>
  );
}
