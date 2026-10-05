"use client";
import { Download } from "lucide-react";
import { useState } from "react";
import { FormMessage } from "@/components/fields";
import { useI18n } from "@/components/i18n-provider";
import { type ServerAction, useServerForm } from "@/components/server-form";
import { buttonClass } from "@/components/ui";
import type { DownloadFile } from "@/lib/actions/result";

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

function download(file: DownloadFile) {
  // Spreadsheets read a CSV as UTF-8 only with a BOM in front.
  const parts: BlobPart[] = file.type.startsWith("text/csv") ? [UTF8_BOM, file.content] : [file.content];
  const url = URL.createObjectURL(new Blob(parts, { type: file.type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Three downloads; a stale code opens the code dialog first (step-up). */
export function ExportPanel({ action }: { action: ServerAction }) {
  const { m, fill } = useI18n();
  const t = m.export;
  const [done, setDone] = useState<string | null>(null);
  const form = useServerForm(action, {
    onSuccess: (_form, result) => {
      if (!result.file) return;
      download(result.file);
      setDone(result.file.name);
    },
  });
  return (
    <>
      <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {(["json", "transactions", "positions"] as const).map((k) => (
            <button key={k} type="submit" name="kind" value={k} className={buttonClass.secondary} disabled={form.pending}>
              <Download aria-hidden="true" size={16} />
              {t[k]}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-muted">{t.csvNote}</p>
        <FormMessage error={form.formError} success={form.pending ? t.preparing : done ? fill(t.done, { name: done }) : undefined} />
      </form>
      {form.dialog}
    </>
  );
}
