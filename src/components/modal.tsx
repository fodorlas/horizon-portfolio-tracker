"use client";
/** Native <dialog> as a modal: focus trap, Esc and the backdrop come from the browser. */
import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "./i18n-provider";
import { buttonClass } from "./ui";

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { m } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-border bg-card p-0 text-text shadow-xl"
    >
      <div className="flex items-start justify-between gap-4 p-5 pb-0 sm:p-6 sm:pb-0">
        <h2 id={titleId} className="text-2xl font-semibold tracking-tight text-accent">
          {title}
        </h2>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-text-muted hover:bg-subtle hover:text-text" aria-label={m.nav.close}>
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <div className="p-5 sm:p-6">{open ? children : null}</div>
    </dialog>
  );
}

/** A button that opens a modal; the content gets a `close` callback. */
export function DialogButton({
  label,
  title,
  variant = "primary",
  icon,
  children,
}: {
  label: string;
  title?: string;
  variant?: keyof typeof buttonClass;
  icon?: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={buttonClass[variant]} onClick={() => setOpen(true)}>
        {icon}
        {label}
      </button>
      <Modal open={open} onClose={close} title={title ?? label}>
        {children(close)}
      </Modal>
    </>
  );
}
