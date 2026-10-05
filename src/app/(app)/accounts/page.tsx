import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { Amount, Day } from "@/components/format";
import { Badge, buttonClass, Card, PageHeader } from "@/components/ui";
import { getPortfolio } from "@/lib/data/portfolio";
import { ACCOUNT_TYPES } from "@/lib/actions/schemas";
import { runLedger } from "@/lib/finance/ledger";
import { D, todayInBudapest } from "@/lib/finance/money";
import { selectValuation } from "@/lib/finance/prices";
import { fxFnFromRows, valueAt } from "@/lib/finance/valuation";
import { getI18n } from "@/lib/i18n-server";
import { getPrefs } from "@/lib/prefs";
import { orphanedBy } from "@/lib/views/orphans";
import { UpdateValue } from "../prices/update-value";
import { ConfirmDelete } from "@/components/confirm-action";
import { createAccount, createInstitution, deleteAccount, deleteInstitution, renameInstitution, updateAccount } from "./actions";
import { DeleteAccount, type DeleteSummary } from "./delete-account";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.accounts.title };
}

export default async function AccountsPage() {
  const { m, fill } = await getI18n();
  const t = m.accounts;
  const [data, prefs] = await Promise.all([getPortfolio(todayInBudapest()), getPrefs()]);
  const today = todayInBudapest();
  const now = valueAt(data, today, prefs.currency);
  const positions = runLedger(data.events, fxFnFromRows(data.fxRows), today).positions;
  const instruments = new Map(data.instrumentMeta.map((i) => [i.id, i]));
  const institutionOptions = data.institutions.map((i) => ({ value: i.id, label: i.name }));

  /** What deleting the account takes with it (delete_account does the same). */
  const summaryOf = (accountId: string, institutionId: string): DeleteSummary => {
    const touching = data.events.filter((e) => e.lines.some((l) => l.accountId === accountId));
    const entries = new Set(touching.flatMap((e) => (data.eventEntries.has(e.id) ? [data.eventEntries.get(e.id)!] : [])));
    return {
      entries: entries.size,
      events: touching.filter((e) => !data.eventEntries.has(e.id)).length,
      values: data.logs.valuations.filter((v) => v.account_id === accountId).length,
      transfers: touching.filter((e) => e.lines.some((l) => l.accountId !== accountId)).length,
      lastOfBroker: data.accountMeta.filter((a) => a.institution_id === institutionId).length === 1,
      instruments: orphanedBy(data.events, new Set(touching.map((e) => e.id)))
        .map((id) => instruments.get(id)?.name ?? id)
        .sort((a, b) => a.localeCompare(b, "hu")),
    };
  };

  return (
    <>
      <PageHeader
        title={t.title}
        actions={
          <>
            <FormDialog label={t.newInstitution} icon="plus" variant="secondary" action={createInstitution} fields={[{ kind: "text", name: "name", label: t.name, maxLength: 100 }]} />
            {data.institutions.length ? (
              <FormDialog
                label={t.newAccount}
                icon="plus"
                action={createAccount}
                fields={[
                  { kind: "select", name: "institutionId", label: t.institution, options: institutionOptions },
                  { kind: "text", name: "name", label: t.name, maxLength: 100 },
                  { kind: "select", name: "accountType", label: t.type, options: ACCOUNT_TYPES.map((x) => ({ value: x, label: t.types[x] })) },
                  { kind: "date", name: "trackingStart", label: t.trackingStart, hint: t.trackingStartHint, defaultValue: today, max: today },
                ]}
              />
            ) : null}
          </>
        }
      />
      {data.institutions.length === 0 ? (
        <Card>
          <p className="text-text-muted">{t.empty}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {data.institutions.map((inst) => {
            const accounts = data.accountMeta.filter((a) => a.institution_id === inst.id);
            return (
              <Card
                key={inst.id}
                id={`inst-${inst.id}`}
                title={inst.name}
                action={
                  <span className="inline-flex items-center gap-1">
                    <FormDialog
                      label={fill(t.renameTitle, { name: inst.name })}
                      title={fill(t.renameTitle, { name: inst.name })}
                      icon="pencil"
                      compact
                      action={renameInstitution}
                      fields={[
                        { kind: "hidden", name: "id", value: inst.id },
                        { kind: "text", name: "name", label: t.name, maxLength: 100, defaultValue: inst.name },
                      ]}
                    />
                    {/* A broker with accounts goes with its last account (delete_account). */}
                    {accounts.length === 0 ? (
                      <ConfirmDelete action={deleteInstitution} fields={{ id: inst.id }} label={fill(t.deleteTitle, { name: inst.name })} title={fill(t.deleteTitle, { name: inst.name })} />
                    ) : null}
                  </span>
                }
              >
                {accounts.length === 0 ? (
                  <p className="text-sm text-text-muted">{t.noAccounts}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {accounts.map((a) => {
                      const open = [...positions.values()].filter((p) => p.accountId === a.id && !p.qty.isZero());
                      const manual = open.filter((p) => instruments.get(p.instrumentId)?.valuation === "manual");
                      const toPositions = `/positions?account=${a.id}`;
                      return (
                        <li key={a.id} className="flex flex-col gap-3 py-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-medium">
                                <Link href={toPositions} className="text-accent underline underline-offset-2">
                                  {a.name}
                                </Link>{" "}
                                {a.account_type !== "normal" ? <Badge tone="accent">{t.types[a.account_type as keyof typeof t.types]}</Badge> : null}
                              </p>
                              <p className="text-sm text-text-muted">
                                {t.trackingStart}: <Day day={a.tracking_start_date} />
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-text-muted">{t.value}</p>
                              <Amount value={now.byAccount.get(a.id) ?? null} currency={prefs.currency} className="font-semibold" />
                              <p className="text-xs text-text-muted">{fill(t.positionCount, { count: open.length })}</p>
                            </div>
                          </div>

                          {manual.length ? (
                            <div>
                              <p className="text-xs font-medium text-text-muted">{t.manualItems}</p>
                              <ul className="mt-1 flex flex-col gap-1">
                                {manual.map((p) => {
                                  const i = instruments.get(p.instrumentId)!;
                                  const v = selectValuation(data.valuations, a.id, i.id, today);
                                  return (
                                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                      <span>
                                        {i.name}: <Amount value={v ? new D(v.value) : null} currency={i.currency} />
                                      </span>
                                      <UpdateValue accountId={a.id} instrumentId={i.id} name={i.name} today={today} />
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ) : null}

                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={toPositions} className={buttonClass.secondary} aria-label={fill(t.positionsOf, { name: a.name })}>
                              {t.positions} <span aria-hidden="true">→</span>
                            </Link>
                            <Link href={`/transactions/new?account=${a.id}`} className={buttonClass.secondary}>
                              <Plus aria-hidden="true" size={16} />
                              {t.newEntryHere}
                            </Link>
                            <FormDialog
                              label={t.edit}
                              title={fill(t.editTitle, { name: a.name })}
                              icon="pencil"
                              variant="secondary"
                              action={updateAccount}
                              fields={[
                                { kind: "hidden", name: "id", value: a.id },
                                { kind: "select", name: "institutionId", label: t.institution, options: institutionOptions, defaultValue: a.institution_id },
                                { kind: "text", name: "name", label: t.name, maxLength: 100, defaultValue: a.name },
                                { kind: "select", name: "accountType", label: t.type, options: ACCOUNT_TYPES.map((x) => ({ value: x, label: t.types[x] })), defaultValue: a.account_type },
                                { kind: "date", name: "trackingStart", label: t.trackingStart, hint: t.trackingStartEditHint, defaultValue: a.tracking_start_date, max: a.tracking_start_date },
                              ]}
                            />
                            <DeleteAccount accountId={a.id} name={a.name} summary={summaryOf(a.id, inst.id)} action={deleteAccount} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
