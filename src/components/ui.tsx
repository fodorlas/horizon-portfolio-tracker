/** Layout building blocks (server-safe: no hooks). */
import Link from "next/link";
import type { ReactNode } from "react";
import { PendingLabel } from "./pending-label";

export function PageHeader({ title, actions, children }: { title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {/* Sans, like the greeting: Fraunces' j and J hang below the line ("Új tétel"). The logo keeps the serif. */}
        <h1 className="text-3xl font-semibold tracking-tight text-accent sm:text-4xl">{title}</h1>
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-start gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
  id,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  // Only a titled card is a named region; an untitled one is just a box.
  const headingId = id && title ? `${id}-title` : undefined;
  const Tag = headingId ? "section" : "div";
  return (
    <Tag id={id} aria-labelledby={headingId} className={`rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6 ${className}`}>
      {title || action ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title ? (
            <h2 id={headingId} className="text-lg font-semibold">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

const noticeTone = {
  warn: "border-warn/40 bg-warn-soft text-text",
  info: "border-border bg-subtle text-text",
  error: "border-loss/40 bg-card text-loss",
} as const;

export function Notice({ tone = "info", children, role }: { tone?: keyof typeof noticeTone; children: ReactNode; role?: "alert" | "status" }) {
  return (
    <div role={role} className={`rounded-2xl border px-4 py-3 text-sm ${noticeTone[tone]}`}>
      {tone === "warn" ? <span aria-hidden="true">⚠ </span> : null}
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "warn" | "accent"; title?: string }) {
  const cls = { neutral: "border-border text-text-muted", warn: "border-warn/50 text-warn", accent: "border-accent/40 text-accent" }[tone];
  return (
    <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-contrast shadow-sm hover:opacity-90 disabled:opacity-60",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-control bg-card px-4 py-2 text-sm font-medium text-text hover:bg-subtle disabled:opacity-60",
  ghost: "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-text hover:bg-subtle",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-loss/60 bg-card px-4 py-2 text-sm font-medium text-loss hover:bg-subtle disabled:opacity-60",
};

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: keyof typeof buttonClass }) {
  return (
    <Link href={href} className={buttonClass[variant]}>
      {children}
    </Link>
  );
}

/** Segmented links (period, tabs) that keep the page server-rendered. */
export function Segmented({ label, items }: { label: string; items: { href: string; text: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="inline-flex flex-wrap rounded-xl border border-border bg-subtle p-1 text-sm">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          scroll={false}
          aria-current={i.current ? "page" : undefined}
          className={`rounded-lg px-2 py-1.5 sm:px-3 ${i.current ? "bg-card font-semibold text-accent shadow-sm" : "text-text-muted hover:text-text"}`}
        >
          <PendingLabel>{i.text}</PendingLabel>
        </Link>
      ))}
    </nav>
  );
}

/**
 * A scrollable table wrapper that keyboard users can scroll too (axe:
 * scrollable-region-focusable). `relative` keeps absolutely positioned
 * descendants (sr-only text) inside it, so they cannot widen the page.
 * `label` is the region's whole accessible name (the caller fills messages.common.table).
 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="relative -mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
      {children}
    </div>
  );
}

export const th = "px-3 py-2 text-left text-xs font-medium tracking-wide text-text-muted first:pl-0 last:pr-0";
export const thNum = `${th} text-right`;
export const td = "px-3 py-3 align-top first:pl-0 last:pr-0";
export const tdNum = `${td} text-right`;
