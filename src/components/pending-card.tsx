"use client";
/**
 * One proposal of "Ellenőrzésre vár" (spec 2026-09-28 §6.3–§6.4): what the
 * Horizon computed and from what, or that the data is missing; where the
 * money goes; Jóváhagyom, Módosítom, Később, Elvetem. A later proposal of the
 * same paper and account waits for the earlier one.
 */
import { useId, useState } from "react";
import { DateField, FormMessage, NumberField, RadioGroup, TextArea } from "@/components/fields";
import { useI18n } from "@/components/i18n-provider";
import { type ServerAction, useServerForm } from "@/components/server-form";
import { Badge, buttonClass } from "@/components/ui";
import { D } from "@/lib/finance/money";
import type { I18n } from "@/lib/i18n";
import { type PendingCard as Card, seenKey } from "@/lib/views/pending";

const huf = ({ f }: I18n, v: string) => f.money(new D(v), "HUF");

export type PendingActions = { approve: ServerAction; snooze: ServerAction; dismiss: ServerAction; restore: ServerAction };

/** A button's full name: the proposal and the account it acts on, as a screen reader's list of buttons reads it. */
const named = ({ m, fill, f }: I18n, label: string, c: Card) =>
  fill(m.pending.buttonName, { action: label, what: fill(m.pending.heading, { date: f.day(c.due), kind: m.pending.kinds[c.kind], name: c.instrumentName }), account: c.accountName });

/** A one-button form for Később, Elvetem and Visszaállítás. */
function Quick({ action, id, label, name }: { action: ServerAction; id: string; label: string; name: string }) {
  const form = useServerForm(action);
  return (
    <form onSubmit={form.onSubmit}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={buttonClass.secondary} disabled={form.pending} aria-label={name}>
        {label}
      </button>
      <FormMessage error={form.formError} />
      {form.dialog}
    </form>
  );
}

export function PendingCard({ card: c, actions }: { card: Card; actions: PendingActions }) {
  const i18n = useI18n();
  const { m, fill, f } = i18n;
  const t = m.pending;
  const [open, setOpen] = useState(c.status !== "snoozed");
  // A card that comes back snoozed (Később) folds, one that comes back open unfolds.
  const [shownStatus, setShownStatus] = useState(c.status);
  if (shownStatus !== c.status) {
    setShownStatus(c.status);
    setOpen(c.status !== "snoozed");
  }
  const missing = c.amount === null;
  const [editing, setEditing] = useState(missing);
  const [payout, setPayout] = useState<"keep" | "withdraw">("keep");
  const form = useServerForm(actions.approve);
  const blockedId = useId();
  const e = form.errors;
  const heading = fill(t.heading, { date: f.day(c.due), kind: t.kinds[c.kind], name: c.instrumentName });
  const b = c.basis;

  if (!open) {
    return (
      <article className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-3">
        <h3 className="text-sm font-medium">{heading}</h3>
        <span className="flex items-center gap-2">
          <Badge>{t.snoozed}</Badge>
          <button type="button" className={buttonClass.secondary} onClick={() => setOpen(true)} aria-label={named(i18n, t.open, c)}>
            {t.open}
          </button>
        </span>
      </article>
    );
  }

  const rows: [string, string][] = [
    [c.kind === "maturity" ? t.repaid : t.entitled, huf(i18n, c.nominal)],
    [t.period, fill(t.periodValue, { start: f.day(b.start), end: f.day(b.end), days: b.days })],
  ];
  if (b.annual && c.percent) rows.push([t.rate, fill(t.rateValue, { annual: f.typed(b.annual), percent: f.typed(c.percent) })]);
  if (c.amount) rows.push([t.interest, huf(i18n, c.amount)]);

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border-strong px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{heading}</h3>
          <p className="text-sm text-text-muted">{c.accountName}</p>
        </div>
        {c.status === "snoozed" ? <Badge>{t.snoozed}</Badge> : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-text-muted">{k}</dt>
            <dd className="amount text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {missing ? (
        <div className="text-sm">
          <p className="font-medium text-warn">{t.missing}</p>
          <p className="text-text-muted">{b.missing === "unverified" ? t.unverified : b.missing === "unchecked" ? t.unchecked : t.missingRate}</p>
        </div>
      ) : (
        <p className="text-sm text-text-muted">{fill(t.computed, { source: t.sources[b.rateSource ?? "observed"], method: t.methods[b.method] })}</p>
      )}
      {b.uncertain ? <p className="text-sm text-warn">{t.uncertain}</p> : null}

      <form onSubmit={form.onSubmit} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="id" value={c.id} />
        <input type="hidden" name="edited" value={editing ? "1" : "0"} />
        <input type="hidden" name="seen" value={seenKey(c)} />
        {editing ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <NumberField name="amount" label={c.kind === "interest_reinvest" ? t.amountReinvest : t.amount} defaultValue={c.amount ? f.typed(c.amount) : ""} error={e.amount} />
            <DateField name="date" label={t.date} defaultValue={c.due} error={e.date} />
            <TextArea name="note" label={t.note} optional maxLength={500} error={e.note} />
          </div>
        ) : null}
        {c.kind !== "interest_reinvest" ? (
          <div className="flex flex-col gap-1">
            <RadioGroup
              legend={t.payout}
              name="payout"
              value={payout}
              onChange={(v) => setPayout(v as "keep" | "withdraw")}
              options={[{ value: "keep", label: t.payoutKeep }, { value: "withdraw", label: t.payoutWithdraw }]}
            />
            {payout === "keep" ? <p className="text-sm text-text-muted">{t.payoutKeepHint}</p> : null}
          </div>
        ) : (
          <input type="hidden" name="payout" value="keep" />
        )}
        {c.blockedBy ? (
          <p id={blockedId} className="text-sm text-text-muted">
            {fill(t.blocked, { date: f.day(c.blockedBy.due), kind: t.kindsLower[c.blockedBy.kind] })}
          </p>
        ) : null}
        <FormMessage error={form.formError} />
        <div className="flex flex-wrap gap-2">
          {/* The reason is said at the disabled button too (#36). */}
          <button
            type="submit"
            className={buttonClass.primary}
            disabled={form.pending || c.blockedBy !== null}
            aria-label={named(i18n, t.approve, c)}
            aria-describedby={c.blockedBy ? blockedId : undefined}
          >
            {t.approve}
          </button>
          {!editing ? (
            <button type="button" className={buttonClass.secondary} onClick={() => setEditing(true)} aria-label={named(i18n, t.modify, c)}>
              {t.modify}
            </button>
          ) : null}
        </div>
      </form>
      {form.dialog}
      <div className="flex flex-wrap gap-2">
        {c.status === "open" ? <Quick action={actions.snooze} id={c.id} label={t.snooze} name={named(i18n, t.snooze, c)} /> : null}
        <Quick action={actions.dismiss} id={c.id} label={t.dismiss} name={named(i18n, t.dismiss, c)} />
      </div>
    </article>
  );
}

/** Elvetett (n): folded at the bottom, each can come back. */
export function DismissedList({ cards, restore }: { cards: Card[]; restore: ServerAction }) {
  const i18n = useI18n();
  const { m, fill, f } = i18n;
  const t = m.pending;
  if (cards.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-text-muted">{fill(t.dismissedTitle, { count: cards.length })}</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {cards.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{fill(t.heading, { date: f.day(c.due), kind: t.kinds[c.kind], name: c.instrumentName })}</span>
            <Quick action={restore} id={c.id} label={t.restore} name={named(i18n, t.restore, c)} />
          </li>
        ))}
      </ul>
    </details>
  );
}
