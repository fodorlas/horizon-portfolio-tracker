import type { Metadata } from "next";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { ConfirmDelete } from "@/components/confirm-action";
import { EventLines, eventAccounts, eventInstrumentNames } from "@/components/event-lines";
import { Day } from "@/components/format";
import { Badge, buttonClass, ButtonLink, Card, PageHeader, TableScroll, td, th } from "@/components/ui";
import { getPortfolio } from "@/lib/data/portfolio";
import { todayInBudapest } from "@/lib/finance/money";
import { EVENT_TYPES, type EventType } from "@/lib/finance/ledger";
import type { I18n } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { type EntryKind, entryDetail, isBondKind, type ListItem, listItems } from "@/lib/views/entries";
import { nameMaps, type Names } from "@/lib/views/names";
import { deleteEntry, deleteTransaction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.transactions.title };
}

const selectClass = "w-full rounded-xl border border-control bg-card px-3 py-2 text-sm sm:w-auto sm:max-w-72";
/** The event type an entry kind stands for in the filter. */
const KIND_TYPE: Record<EntryKind, EventType> = {
  opening: "opening_balance", buy: "buy", sell: "sell", interest_reinvest: "interest_reinvest", interest: "interest", maturity: "maturity",
};

async function Actions({ item }: { item: ListItem }) {
  const { m, fill, f } = await getI18n();
  const t = m.transactions;
  if (item.kind === "event") {
    const label = `${m.common.delete}: ${m.eventTypes[item.event.type]}`;
    return <ConfirmDelete action={deleteTransaction} fields={{ id: item.event.id }} label={label} title={label} intro={t.deleteEventIntro} />;
  }
  const e = item.entry;
  const what = { kind: t.kinds[e.kind], date: f.day(e.date) };
  // An approved proposal changes on its card: deleting it sends the proposal back (spec 2026-09-28 §6.2).
  if (isBondKind(e.kind)) {
    const label = fill(t.returnToReviewLabel, what);
    return <ConfirmDelete action={deleteEntry} fields={{ id: e.id }} label={label} title={label} intro={t.returnToReviewIntro} />;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Link href={`/transactions/${e.id}/edit`} className="rounded-lg p-1.5 text-text-muted hover:bg-subtle hover:text-accent" aria-label={fill(t.editLabel, what)} title={t.edit}>
        <Pencil aria-hidden="true" size={16} />
      </Link>
      <ConfirmDelete action={deleteEntry} fields={{ id: e.id }} label={fill(t.deleteLabel, what)} title={fill(t.deleteLabel, what)} intro={t.deleteEntryIntro} />
    </span>
  );
}

function view(item: ListItem, names: Names, manual: ReadonlySet<string>, i18n: I18n) {
  const { m } = i18n;
  const t = m.transactions;
  return item.kind === "entry"
    ? {
        key: item.entry.id, date: item.entry.date, kind: t.kinds[item.entry.kind], note: item.entry.note,
        accounts: names.account.get(item.entry.accountId) ?? "",
        instruments: item.entry.instrumentId ? (names.instrument.get(item.entry.instrumentId) ?? "") : "",
        detail: (
          <span className="amount">
            {entryDetail(item.entry, i18n)} {item.entry.estimated ? <Badge tone="warn" title={m.common.estimatedHint}>{m.common.estimated}</Badge> : null}
          </span>
        ),
      }
    : {
        key: item.event.id, date: item.event.date, kind: m.eventTypes[item.event.type], note: item.event.note,
        accounts: eventAccounts(item.event).map((a) => names.account.get(a)).join(" → "),
        instruments: eventInstrumentNames(item.event, names.instrument, i18n),
        detail: <EventLines event={item.event} manual={manual} i18n={i18n} />,
      };
}

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const sp = await searchParams;
  const i18n = await getI18n();
  const { m, fill } = i18n;
  const t = m.transactions;
  const type = EVENT_TYPES.includes(sp.type as EventType) ? (sp.type as EventType) : "";
  const account = typeof sp.account === "string" ? sp.account : "";

  const data = await getPortfolio(todayInBudapest());
  const names = nameMaps(data);
  const valuation = new Map(data.instrumentMeta.map((i) => [i.id, i.valuation as "market" | "manual"]));
  const manual = new Set(data.instrumentMeta.filter((i) => i.valuation === "manual").map((i) => i.id));
  const items = listItems(data.events, data.eventEntries, (id) => valuation.get(id)).filter((i) => {
    if (i.kind === "entry") return (!type || KIND_TYPE[i.entry.kind] === type) && (!account || i.entry.accountId === account);
    return (!type || i.event.type === type) && (!account || i.event.lines.some((l) => l.accountId === account));
  });

  return (
    <>
      <PageHeader
        title={t.title}
        actions={
          <>
            <Link href="/transactions/advanced" className={buttonClass.secondary}>
              {t.advanced}
            </Link>
            <ButtonLink href="/transactions/new">
              <Plus aria-hidden="true" size={18} />
              {t.new}
            </ButtonLink>
          </>
        }
      />
      <Card id="transactions">
        <form method="get" className="mb-5 grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
            {t.filterType}
            <select name="type" defaultValue={type} className={selectClass}>
              <option value="">{m.common.all}</option>
              <optgroup label={t.groups.entries}>
                {(["opening", "buy", "sell"] as const).map((k) => (
                  <option key={k} value={KIND_TYPE[k]}>
                    {t.kinds[k]}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t.groups.advanced}>
                {EVENT_TYPES.filter((x) => !Object.values(KIND_TYPE).includes(x)).map((x) => (
                  <option key={x} value={x}>
                    {m.eventTypes[x]}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
            {t.filterAccount}
            <select name="account" defaultValue={account} className={selectClass}>
              <option value="">{m.common.all}</option>
              {data.accountMeta.map((a) => (
                <option key={a.id} value={a.id}>
                  {names.account.get(a.id)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass.secondary}>
            {m.common.filter}
          </button>
          <p className="text-sm text-text-muted sm:ml-auto" role="status">
            {fill(t.count, { count: items.length })}
          </p>
        </form>

        {items.length === 0 ? (
          <p className="text-text-muted">{t.empty}</p>
        ) : (
          <>
            <ul className="divide-y divide-border md:hidden">
              {items.map((item) => {
                const v = view(item, names, manual, i18n);
                return (
                  <li key={v.key} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">{v.kind}</p>
                      <p className="text-xs text-text-muted">
                        <Day day={v.date} /> · {v.accounts}
                      </p>
                      {v.instruments ? <p className="text-sm">{v.instruments}</p> : null}
                      <div className="mt-1 text-sm">{v.detail}</div>
                      {v.note ? <p className="mt-1 text-xs text-text-muted">{v.note}</p> : null}
                    </div>
                    <Actions item={item} />
                  </li>
                );
              })}
            </ul>
            <div className="hidden md:block">
              <TableScroll label={fill(m.common.table, { name: t.title })}>
                <table className="w-full min-w-[48rem] text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className={th}>{t.date}</th>
                      <th scope="col" className={th}>{t.filterType}</th>
                      <th scope="col" className={th}>{t.account}</th>
                      <th scope="col" className={th}>{t.instrument}</th>
                      <th scope="col" className={th}>{t.detail}</th>
                      <th scope="col" className={th}>{t.note}</th>
                      <th scope="col" className={th}>
                        <span className="sr-only">{m.common.actions}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item) => {
                      const v = view(item, names, manual, i18n);
                      return (
                        <tr key={v.key}>
                          <td className={td}>
                            <Day day={v.date} />
                          </td>
                          <td className={`${td} font-medium`}>{v.kind}</td>
                          <td className={td}>{v.accounts}</td>
                          <td className={td}>{v.instruments || m.common.none}</td>
                          <td className={td}>{v.detail}</td>
                          <td className={`${td} max-w-48 text-text-muted`}>{v.note ?? ""}</td>
                          <td className={`${td} text-right`}>
                            <Actions item={item} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
