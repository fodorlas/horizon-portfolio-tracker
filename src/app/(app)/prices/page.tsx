import type { Metadata } from "next";
import { FormDialog, type FieldSpec } from "@/components/form-dialog";
import { Amount, Day, Price } from "@/components/format";
import { RefreshButton } from "@/components/refresh-button";
import { Badge, buttonClass, Card, PageHeader, Segmented, TableScroll, td, tdNum, th, thNum } from "@/components/ui";
import { getPortfolio } from "@/lib/data/portfolio";
import { getLastRefreshAt, getRefreshLog, type RefreshLogRow } from "@/lib/data/refresh-log";
import { addDays, D, todayInBudapest } from "@/lib/finance/money";
import { dayOf, priceSourceFilter, selectPrice, selectValuation } from "@/lib/finance/prices";
import { getI18n } from "@/lib/i18n-server";
import { type LogStatus, logStatuses } from "@/lib/views/logs";
import { nameMaps } from "@/lib/views/names";
import { noteText } from "@/lib/views/notes";
import { refreshPrices } from "../refresh-actions";
import { addFxRate, addPrice, addValuation, correctFxRate, correctPrice, correctValuation } from "./actions";
import type { Messages } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.prices.title };
}
/** The Frissítés action runs here too: room for the work budget (phase 4 plan §3). */
export const maxDuration = 60;
/** The logs show this many days of prices (plus the price in force before). */
const LOG_DAYS = 90;

const TABS = ["prices", "fx", "valuations"] as const;
type Tab = (typeof TABS)[number];
const ROW_LIMIT = 300;

const sourceLabel = (t: Messages["prices"], s: string) => (t.sources as Record<string, string>)[s] ?? s;
const statusTone = (s: LogStatus) => (s === "current" ? "accent" : s === "suspect" || s === "superseded" ? "warn" : "neutral");

async function Status({ status }: { status: LogStatus }) {
  const { m } = await getI18n();
  const t = m.prices;
  return <Badge tone={statusTone(status)}>{t.statuses[status]}</Badge>;
}

const correctFields = (t: Messages["prices"], id: string, label: string, current: string): FieldSpec[] => [
  { kind: "hidden", name: "supersedesId", value: id },
  { kind: "number", name: "amount", label, defaultValue: current },
  { kind: "textarea", name: "note", label: t.noteRequired, maxLength: 500 },
];

export default async function PricesPage({ searchParams }: PageProps<"/prices">) {
  const { m } = await getI18n();
  const t = m.prices;
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "prices";
  const instrumentFilter = typeof sp.instrument === "string" ? sp.instrument : "";
  const today = todayInBudapest();
  const [data, refreshLog, lastRefresh] = await Promise.all([getPortfolio(addDays(today, -LOG_DAYS)), getRefreshLog(), getLastRefreshAt()]);
  const names = nameMaps(data);

  // Prices belong to market-priced instruments; a manual item has values (the third tab) instead.
  const instrumentOptions = data.instrumentMeta.filter((i) => i.valuation === "market").map((i) => ({ value: i.id, label: names.instrument.get(i.id) ?? i.name }));
  const manualInstruments = data.instrumentMeta.filter((i) => i.valuation === "manual");
  const accountOptions = data.accountMeta.map((a) => ({ value: a.id, label: names.account.get(a.id) ?? a.name }));

  const addButton =
    tab === "prices" ? (
      <FormDialog
        label={t.newPrice}
        icon="plus"
        action={addPrice}
        fields={[
          { kind: "select", name: "instrumentId", label: t.instrument, options: instrumentOptions, defaultValue: instrumentFilter || undefined },
          { kind: "date", name: "day", label: t.day, defaultValue: today, max: today },
          { kind: "number", name: "price", label: t.price },
          { kind: "textarea", name: "note", label: t.noteRequired, maxLength: 500 },
        ]}
      />
    ) : tab === "fx" ? (
      <FormDialog
        label={t.newFx}
        icon="plus"
        action={addFxRate}
        fields={[
          { kind: "text", name: "base", label: t.base, maxLength: 3, defaultValue: "EUR" },
          { kind: "text", name: "quote", label: t.quote, maxLength: 3, defaultValue: "HUF" },
          { kind: "date", name: "day", label: t.day, defaultValue: today, max: today },
          { kind: "number", name: "rate", label: t.rate, hint: t.rateHint },
          { kind: "textarea", name: "note", label: t.noteRequired, maxLength: 500 },
        ]}
      />
    ) : manualInstruments.length && accountOptions.length ? (
      <FormDialog
        label={t.newValuation}
        icon="plus"
        action={addValuation}
        fields={[
          { kind: "select", name: "accountId", label: t.account, options: accountOptions },
          { kind: "select", name: "instrumentId", label: t.instrument, options: manualInstruments.map((i) => ({ value: i.id, label: names.instrument.get(i.id) ?? i.name })) },
          { kind: "date", name: "day", label: t.day, defaultValue: today, max: today },
          { kind: "number", name: "value", label: t.value },
          { kind: "textarea", name: "note", label: t.note, optional: true, maxLength: 500 },
        ]}
      />
    ) : null;

  return (
    <>
      <PageHeader
        title={t.title}
        actions={
          <>
            {addButton}
            <RefreshButton action={refreshPrices} lastAt={lastRefresh} />
          </>
        }
      >
        <p className="mt-2 text-sm text-text-muted">{t.intro}</p>
      </PageHeader>
      <div className="mb-5">
        <Segmented label={t.title} items={TABS.map((x) => ({ href: `/prices?tab=${x}`, text: t.tabs[x], current: x === tab }))} />
      </div>
      <Card id={`log-${tab}`} title={t.tabs[tab]}>
        {tab === "prices" ? <PriceLog data={data} names={names} today={today} filter={instrumentFilter} instrumentOptions={instrumentOptions} /> : null}
        {tab === "fx" ? <FxLog data={data} /> : null}
        {tab === "valuations" ? (
          manualInstruments.length ? <ValuationLog data={data} names={names} today={today} /> : <p className="text-text-muted">{t.noManualInstruments}</p>
        ) : null}
      </Card>
      <Card id="refresh-log" title={m.refresh.logTitle} className="mt-5">
        <RefreshLog rows={refreshLog} instrumentName={(id) => names.instrument.get(id) ?? id} />
      </Card>
    </>
  );
}

async function RefreshLog({ rows, instrumentName }: { rows: RefreshLogRow[]; instrumentName: (id: string) => string }) {
  const { m, fill, f } = await getI18n();
  const r = m.refresh;
  if (rows.length === 0) return <p className="text-text-muted">{r.emptyLog}</p>;
  // Yahoo, BÉT and ÁKK rows name an instrument; the ÁKK's tab and history rows say what they are.
  const logItem = (row: RefreshLogRow) =>
    row.source === "akk" && row.item === "rates" ? r.akkRates : row.source === "akk" && (row.item === "MAP" || row.item === "MAPP") ? row.item : row.source === "yahoo" || row.source === "bet" || row.source === "akk" ? instrumentName(row.item) : row.item;
  const note = (row: RefreshLogRow) => {
    const parts: string[] = [];
    if (row.message) parts.push(r.messages[row.message as keyof typeof r.messages] ?? row.message);
    else if (row.status === "skipped") parts.push(r.recent);
    if (row.suspect > 0) parts.push(r.suspect.replace("{count}", String(row.suspect)));
    if (row.unchecked > 0) parts.push(r.unchecked.replace("{count}", String(row.unchecked)));
    return parts.join(" · ");
  };
  return (
    <>
      <p className="mb-3 text-sm text-text-muted">{r.logIntro}</p>
      <TableScroll label={fill(m.common.table, { name: r.logTitle })}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>{r.columns.at}</th>
              <th className={th}>{r.columns.source}</th>
              <th className={th}>{r.columns.item}</th>
              <th className={th}>{r.columns.kind}</th>
              <th className={th}>{r.columns.range}</th>
              <th className={th}>{r.columns.status}</th>
              <th className={thNum}>{r.columns.inserted}</th>
              <th className={th}>{r.columns.note}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className={`${td} whitespace-nowrap`}>{f.moment(row.at)}</td>
                <td className={td}>{row.source === "yahoo" ? "Yahoo" : row.source === "bet" ? "BÉT" : row.source === "akk" ? "ÁKK" : row.source}</td>
                <td className={td}>{logItem(row)}</td>
                <td className={`${td} whitespace-nowrap`}>{r.kinds[row.kind as keyof typeof r.kinds]}</td>
                <td className={`${td} whitespace-nowrap`}>{row.range_from && row.range_to ? `${f.day(row.range_from)} – ${f.day(row.range_to)}` : "–"}</td>
                <td className={td}>
                  <Badge tone={row.status === "error" ? "warn" : row.status === "ok" ? "accent" : "neutral"}>{r.statuses[row.status as keyof typeof r.statuses]}</Badge>
                </td>
                <td className={tdNum}>{row.inserted}</td>
                <td className={td}>{note(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </>
  );
}

type Data = Awaited<ReturnType<typeof getPortfolio>>;
type Names = ReturnType<typeof nameMaps>;

async function PriceLog({ data, names, today, filter, instrumentOptions }: { data: Data; names: Names; today: string; filter: string; instrumentOptions: { value: string; label: string }[] }) {
  const { m, fill } = await getI18n();
  const t = m.prices;
  const current = new Set(data.instrumentMeta.map((i) => selectPrice(data.quotes, { id: i.id, priceSource: i.price_source }, today)?.id).filter((x): x is string => !!x));
  // A row of a source its instrument no longer uses (e.g. Yahoo after a move to the BÉT) is not "ok" (#39).
  const priceSourceOf = new Map(data.instrumentMeta.map((i) => [i.id, i.price_source]));
  const statuses = logStatuses(data.logs.quotes, current, (q) => priceSourceFilter(priceSourceOf.get(q.instrument_id) ?? "manual")(q.source));
  const currency = new Map(data.instrumentMeta.map((i) => [i.id, i.currency]));
  const rows = data.logs.quotes
    .filter((q) => !filter || q.instrument_id === filter)
    .sort((a, b) => b.as_of.localeCompare(a.as_of) || b.entered_at.localeCompare(a.entered_at))
    .slice(0, ROW_LIMIT);

  return (
    <>
      <form method="get" className="mb-4 grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <input type="hidden" name="tab" value="prices" />
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
          {t.filterInstrument}
          <select name="instrument" defaultValue={filter} className="w-full rounded-xl border border-control bg-card px-3 py-2 text-sm sm:w-auto sm:max-w-72">
            <option value="">{m.common.all}</option>
            {instrumentOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass.secondary}>
          {m.common.filter}
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="text-text-muted">{t.empty}</p>
      ) : (
        <TableScroll label={fill(m.common.table, { name: t.tabs.prices })}>
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>{t.day}</th>
                <th scope="col" className={th}>{t.instrument}</th>
                <th scope="col" className={thNum}>{t.price}</th>
                <th scope="col" className={th}>{t.source}</th>
                <th scope="col" className={th}>{t.status}</th>
                <th scope="col" className={th}>{t.note}</th>
                <th scope="col" className={th}>
                  <span className="sr-only">{m.common.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((q) => {
                const status = statuses.get(q.id)!;
                return (
                  <tr key={q.id}>
                    <td className={td}>
                      <Day day={dayOf(q.as_of)} />
                    </td>
                    <td className={td}>{names.instrument.get(q.instrument_id)}</td>
                    <td className={tdNum}>
                      <Price value={new D(q.price)} currency={currency.get(q.instrument_id) ?? q.currency} />
                    </td>
                    <td className={td}>{sourceLabel(t, q.source)}</td>
                    <td className={td}>
                      <Status status={status} />
                    </td>
                    <td className={`${td} max-w-56 text-text-muted`}>{noteText(q.note, m)}</td>
                    <td className={`${td} text-right`}>
                      {status !== "superseded" ? (
                        <FormDialog compact icon="pencil" label={`${t.correct}: ${names.instrument.get(q.instrument_id)}, ${dayOf(q.as_of)}`} title={t.correctTitle} intro={t.correctIntro} action={correctPrice} fields={correctFields(t, q.id, t.price, new D(q.price).toFixed())} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}

async function FxLog({ data }: { data: Data }) {
  const { m, fill, f } = await getI18n();
  const t = m.prices;
  const statuses = logStatuses(data.logs.fx);
  const rows = [...data.logs.fx].sort((a, b) => b.rate_date.localeCompare(a.rate_date) || b.fetched_at.localeCompare(a.fetched_at)).slice(0, ROW_LIMIT);
  if (rows.length === 0) return <p className="text-text-muted">{t.empty}</p>;
  return (
    <TableScroll label={fill(m.common.table, { name: t.tabs.fx })}>
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={th}>{t.day}</th>
            <th scope="col" className={th}>{t.pair}</th>
            <th scope="col" className={thNum}>{t.rate}</th>
            <th scope="col" className={th}>{t.source}</th>
            <th scope="col" className={th}>{t.status}</th>
            <th scope="col" className={th}>{t.note}</th>
            <th scope="col" className={th}>
              <span className="sr-only">{m.common.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const status = statuses.get(r.id)!;
            return (
              <tr key={r.id}>
                <td className={td}>
                  <Day day={r.rate_date} />
                </td>
                <td className={td}>
                  {r.base}/{r.quote}
                </td>
                <td className={tdNum}>{f.rate(new D(r.rate))}</td>
                <td className={td}>{sourceLabel(t, r.source)}</td>
                <td className={td}>
                  <Status status={status} />
                </td>
                <td className={`${td} max-w-56 text-text-muted`}>{noteText(r.note, m)}</td>
                <td className={`${td} text-right`}>
                  {status !== "superseded" && status !== "broker" ? (
                    <FormDialog compact icon="pencil" label={`${t.correct}: ${r.base}/${r.quote}, ${r.rate_date}`} title={t.correctTitle} intro={t.correctIntro} action={correctFxRate} fields={correctFields(t, r.id, t.rate, new D(r.rate).toFixed())} />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}

async function ValuationLog({ data, names, today }: { data: Data; names: Names; today: string }) {
  const { m, fill } = await getI18n();
  const t = m.prices;
  const current = new Set<string>();
  for (const v of data.valuations) {
    const sel = selectValuation(data.valuations, v.accountId, v.instrumentId, today);
    if (sel) current.add(sel.id);
  }
  const statuses = logStatuses(data.logs.valuations.map((v) => ({ ...v, source: "manual", status: "ok" })), current);
  const rows = [...data.logs.valuations].sort((a, b) => b.as_of.localeCompare(a.as_of) || b.entered_at.localeCompare(a.entered_at)).slice(0, ROW_LIMIT);
  if (rows.length === 0) return <p className="text-text-muted">{t.empty}</p>;
  return (
    <TableScroll label={fill(m.common.table, { name: t.tabs.valuations })}>
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={th}>{t.day}</th>
            <th scope="col" className={th}>{t.instrument}</th>
            <th scope="col" className={th}>{t.account}</th>
            <th scope="col" className={thNum}>{t.value}</th>
            <th scope="col" className={th}>{t.status}</th>
            <th scope="col" className={th}>{t.note}</th>
            <th scope="col" className={th}>
              <span className="sr-only">{m.common.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((v) => {
            const status = statuses.get(v.id)!;
            return (
              <tr key={v.id}>
                <td className={td}>
                  <Day day={dayOf(v.as_of)} />
                </td>
                <td className={td}>{names.instrument.get(v.instrument_id)}</td>
                <td className={td}>{names.account.get(v.account_id)}</td>
                <td className={tdNum}>
                  <Amount value={new D(v.value)} currency={v.currency} />
                </td>
                <td className={td}>
                  <Status status={status} />
                </td>
                <td className={`${td} max-w-56 text-text-muted`}>{noteText(v.note, m)}</td>
                <td className={`${td} text-right`}>
                  {status !== "superseded" ? (
                    <FormDialog compact icon="pencil" label={`${t.correct}: ${names.instrument.get(v.instrument_id)}, ${dayOf(v.as_of)}`} title={t.correctTitle} intro={t.correctIntro} action={correctValuation} fields={correctFields(t, v.id, t.value, new D(v.value).toFixed())} />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}
