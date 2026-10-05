import type { Metadata } from "next";
import Link from "next/link";
import { Amount, Change, Day, Pct, Price, Qty } from "@/components/format";
import { Badge, buttonClass, Card, PageHeader, TableScroll, td, tdNum, th, thNum } from "@/components/ui";
import { loadBondFacts } from "@/lib/bonds/sync";
import { loadPending } from "@/lib/data/pending";
import { getPortfolio } from "@/lib/data/portfolio";
import { todayInBudapest } from "@/lib/finance/money";
import { getI18n } from "@/lib/i18n-server";
import { getPrefs } from "@/lib/prefs";
import { nameMaps, type Names } from "@/lib/views/names";
import { type BondFlag, bondFlags } from "@/lib/views/pending";
import { type PositionRow, positions } from "@/lib/views/portfolio";
import { filterPositions, isFiltered, parsePositionFilter, POSITION_TYPES, type PositionFilter } from "@/lib/views/position-filter";
import { createClient } from "@/lib/supabase/server";
import { UpdateValue } from "../prices/update-value";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.positions.title };
}

const selectClass = "w-full rounded-xl border border-control bg-card px-3 py-2 text-sm";

export default async function PositionsPage({ searchParams }: PageProps<"/positions">) {
  const { m, fill, f } = await getI18n();
  const t = m.positions;
  const ft = t.filter;
  const assetLabels = m.assetClasses as Record<string, string>;
  const [sp, data, prefs, pending] = await Promise.all([searchParams, getPortfolio(todayInBudapest()), getPrefs(), loadPending()]);
  const today = todayInBudapest();
  const model = positions(data, today, prefs.currency);
  const names = nameMaps(data);
  const bonds = await loadBondFacts(await createClient(), data);
  const flags = bondFlags({ today, bonds, positions: model.positions, rows: pending });
  const flagsOf = (p: PositionRow) => flags.get(`${p.accountId}|${p.instrumentId}`) ?? [];
  const ccy = model.currency;

  const filter = parsePositionFilter(sp);
  const filtered = isFiltered(filter);
  const meta = new Map(data.instrumentMeta.map((i) => [i.id, i]));
  const shown = filterPositions(model, filter, (id) => {
    const i = meta.get(id);
    return i ? { assetClass: i.asset_class, name: names.instrument.get(id) ?? i.name } : undefined;
  });
  const currencies = [...new Set([...model.positions.map((p) => p.currency), ...model.cash.map((c) => c.currency)])].sort();
  const showCash = !filter.type || filter.type === "cash";

  return (
    <>
      <PageHeader title={t.title}>
        <p className="mt-2 text-sm text-text-muted">
          {t.total}: <Amount value={shown.total} currency={ccy} className="font-semibold text-text" />
          {!shown.complete ? <span className="text-warn"> · {m.common.incomplete}</span> : null}
          {filtered ? (
            <span className="ml-2 inline-block rounded-lg border border-border bg-subtle px-2 py-0.5 text-xs">
              <span className="amount">{fill(ft.filteredTotal, { total: f.money(model.total, ccy) })}</span>
            </span>
          ) : null}
        </p>
      </PageHeader>

      <div className="grid grid-cols-1 gap-5">
        <Card id="filter">
          <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_0.8fr_1.4fr_auto] lg:items-end">
            <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
              {ft.account}
              <select name="account" defaultValue={filter.account} className={selectClass}>
                <option value="">{m.common.all}</option>
                {data.accountMeta.map((a) => (
                  <option key={a.id} value={a.id}>
                    {names.account.get(a.id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
              {ft.type}
              <select name="type" defaultValue={filter.type} className={selectClass}>
                <option value="">{m.common.all}</option>
                {POSITION_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {assetLabels[x]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
              {ft.currency}
              <select name="currency" defaultValue={filter.currency} className={selectClass}>
                <option value="">{m.common.all}</option>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
              {ft.query}
              <input type="search" name="q" defaultValue={filter.q} maxLength={64} placeholder={ft.queryPlaceholder} className={selectClass} />
            </label>
            <button type="submit" className={buttonClass.secondary}>
              {m.common.filter}
            </button>
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <FilterChips filter={filter} accountName={(id) => names.account.get(id) ?? id} />
            {filtered ? (
              <Link href="/positions" className="text-accent underline underline-offset-2">
                {ft.clear}
              </Link>
            ) : null}
            <p className="text-text-muted sm:ml-auto" role="status">
              {fill(ft.count, { positions: shown.positions.length, cash: shown.cash.length })}
            </p>
          </div>
        </Card>

        <Card id="securities" title={t.securities}>
          {shown.positions.length === 0 ? (
            <p className="text-text-muted">{filtered ? ft.none : t.empty}</p>
          ) : (
            <>
              {/* Phones: one card per position. */}
              <ul className="divide-y divide-border md:hidden">
                {shown.positions.map((p) => (
                  <li key={`${p.accountId}|${p.instrumentId}`} className="py-4">
                    <PositionCard p={p} names={names} currency={ccy} />
                    <Flags flags={flagsOf(p)} />
                    {p.valuation === "manual" ? (
                      <div className="mt-2">
                        <UpdateValue accountId={p.accountId} instrumentId={p.instrumentId} name={names.instrument.get(p.instrumentId) ?? ""} today={today} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {/* Wider screens: a table. */}
              <div className="hidden md:block">
                <TableScroll label={fill(m.common.table, { name: t.securities })}>
                  <table className="w-full min-w-[56rem] text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th scope="col" className={th}>{t.instrument}</th>
                        <th scope="col" className={thNum}>{t.quantity}</th>
                        <th scope="col" className={thNum}>{t.price}</th>
                        <th scope="col" className={thNum}>{t.value}</th>
                        <th scope="col" className={thNum}>{t.cost}</th>
                        <th scope="col" className={thNum}>{t.unrealized}</th>
                        <th scope="col" className={thNum}>{t.realized}</th>
                        <th scope="col" className={thNum}>{t.income}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {shown.positions.map((p) => (
                        <tr key={`${p.accountId}|${p.instrumentId}`}>
                          <th scope="row" className={`${td} text-left font-normal`}>
                            <span className="font-medium">{names.instrument.get(p.instrumentId)}</span>
                            <span className="block text-xs text-text-muted">{names.account.get(p.accountId)}</span>
                            <Flags flags={flagsOf(p)} />
                          </th>
                          <td className={tdNum}>
                            {/* A manual-valued item's units are internal (4c): only its value counts. */}
                            {p.valuation === "manual" ? m.common.none : <Qty value={p.quantity} />}
                          </td>
                          <td className={tdNum}>
                            <PriceCell p={p} />
                            {p.valuation === "manual" ? (
                              <span className="mt-1 block">
                                <UpdateValue accountId={p.accountId} instrumentId={p.instrumentId} name={names.instrument.get(p.instrumentId) ?? ""} today={today} />
                              </span>
                            ) : null}
                          </td>
                          <td className={tdNum}>
                            <Amount value={p.native} currency={p.currency} className="font-medium" />
                            {p.currency !== ccy ? (
                              <span className="block text-xs text-text-muted">
                                {p.display ? <Amount value={p.display} currency={ccy} /> : m.common.missingFx}
                              </span>
                            ) : null}
                          </td>
                          <td className={tdNum}>
                            <Amount value={p.cost} currency={p.currency} />
                            {p.costEstimated ? (
                              <span className="block">
                                <Badge tone="warn" title={m.common.estimatedHint}>{m.common.estimated}</Badge>
                              </span>
                            ) : null}
                          </td>
                          <td className={tdNum}>
                            <Change value={p.unrealized} currency={p.currency} />
                            <span className="block text-xs">
                              <Pct rate={p.unrealizedRate} />
                            </span>
                          </td>
                          <td className={tdNum}>
                            <Change value={p.realized} currency={p.currency} />
                            {p.realizedIncomplete ? (
                              <span className="block">
                                <Badge tone="warn" title={m.common.incompleteHint}>{m.common.incomplete}</Badge>
                              </span>
                            ) : null}
                          </td>
                          <td className={tdNum}>
                            <Amount value={p.incomeNet} currency={p.currency} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </div>
            </>
          )}
          <p className="mt-4 text-xs text-text-muted">{t.note}</p>
        </Card>

        {showCash && !(filtered && shown.cash.length === 0) ? (
        <Card id="cash" title={t.cash}>
          {shown.cash.length === 0 ? (
            <p className="text-text-muted">{t.emptyCash}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={th}>{t.account}</th>
                  <th scope="col" className={thNum}>{t.balance}</th>
                  <th scope="col" className={thNum}>{fill(t.valueDisplay, { currency: ccy })}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.cash.map((c) => (
                  <tr key={`${c.accountId}|${c.currency}`}>
                    <th scope="row" className={`${td} text-left font-normal`}>
                      {names.account.get(c.accountId)}
                    </th>
                    <td className={tdNum}>
                      <Amount value={c.amount} currency={c.currency} className="font-medium" />
                    </td>
                    <td className={tdNum}>{c.display ? <Amount value={c.display} currency={ccy} /> : <span className="text-warn">{m.common.missingFx}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        ) : null}
      </div>
    </>
  );
}

/** The filters in use, each with a way to drop just that one. */
async function FilterChips({ filter, accountName }: { filter: PositionFilter; accountName: (id: string) => string }) {
  const { m, fill } = await getI18n();
  const ft = m.positions.filter;
  const assetLabels = m.assetClasses as Record<string, string>;
  const chips: { key: keyof PositionFilter; label: string; value: string }[] = [];
  if (filter.account) chips.push({ key: "account", label: ft.account, value: accountName(filter.account) });
  if (filter.type) chips.push({ key: "type", label: ft.type, value: assetLabels[filter.type] });
  if (filter.currency) chips.push({ key: "currency", label: ft.currency, value: filter.currency });
  if (filter.q) chips.push({ key: "q", label: ft.query, value: filter.q });
  const without = (key: keyof PositionFilter) => {
    const rest = new URLSearchParams(Object.entries(filter).filter(([k, v]) => k !== key && v) as [string, string][]);
    return rest.size ? `/positions?${rest}` : "/positions";
  };
  return chips.map((c) => (
    <Link
      key={c.key}
      href={without(c.key)}
      aria-label={fill(ft.remove, { label: c.label, value: c.value })}
      className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 font-medium text-accent hover:underline"
    >
      {c.label}: {c.value} <span aria-hidden="true">✕</span>
    </Link>
  ));
}

async function PriceCell({ p }: { p: PositionRow }) {
  const { m, fill } = await getI18n();
  const t = m.positions;
  const sources = m.prices.sources as Record<string, string>;
  if (!p.valueAsOf) return <span className="text-warn">{m.common.missingPrice}</span>;
  return (
    <>
      {p.price ? <Price value={p.price} currency={p.currency} /> : <span>{t.manualValue}</span>}
      <span className="block text-xs whitespace-nowrap text-text-muted">
        {sources[p.valueSource ?? ""] ?? p.valueSource} · {p.ageDays ? fill(m.common.daysAgo, { days: p.ageDays }) : m.common.today}
      </span>
      <span className="block text-xs text-text-muted">
        <Day day={p.valueAsOf} />
      </span>
      {p.stale ? <Badge tone="warn">{m.common.stale}</Badge> : null}
    </>
  );
}

/** Government securities (spec 2026-09-28 §4.3, §6.5): the waiting proposals link to the box on the overview. */
async function Flags({ flags }: { flags: BondFlag[] }) {
  const { m } = await getI18n();
  if (flags.length === 0) return null;
  const f = m.pending.flags;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {flags.map((x) =>
        x === "pending" ? (
          <Link key={x} href="/#pending" className="text-xs text-accent underline underline-offset-2">
            {f.pending}
          </Link>
        ) : (
          <Badge key={x} tone="warn">
            {f[x]}
          </Badge>
        ),
      )}
    </span>
  );
}

async function PositionCard({ p, names, currency }: { p: PositionRow; names: Names; currency: string }) {
  const { m, f } = await getI18n();
  const t = m.positions;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{names.instrument.get(p.instrumentId)}</p>
          <p className="text-xs text-text-muted">{names.account.get(p.accountId)}</p>
        </div>
        <div className="text-right">
          <Amount value={p.native} currency={p.currency} className="font-semibold" />
          {p.currency !== currency ? (
            <span className="block text-xs text-text-muted">{p.display ? <Amount value={p.display} currency={currency} /> : m.common.missingFx}</span>
          ) : null}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        {p.valuation === "manual" ? null : (
          <>
            <dt className="text-text-muted">{t.quantity}</dt>
            <dd className="text-right">
              <Qty value={p.quantity} />
            </dd>
          </>
        )}
        <dt className="text-text-muted">{t.price}</dt>
        <dd className="text-right">
          <PriceCell p={p} />
        </dd>
        <dt className="text-text-muted">{t.cost}</dt>
        <dd className="text-right">
          <Amount value={p.cost} currency={p.currency} />
          {p.costEstimated ? <> <Badge tone="warn" title={m.common.estimatedHint}>{m.common.estimated}</Badge></> : null}
        </dd>
        <dt className="text-text-muted">{t.unrealized}</dt>
        <dd className="text-right">
          <Change value={p.unrealized} currency={p.currency} /> <Pct rate={p.unrealizedRate} className="text-xs" />
        </dd>
        <dt className="text-text-muted">{t.realized}</dt>
        <dd className="text-right">
          <Change value={p.realized} currency={p.currency} />
        </dd>
        <dt className="text-text-muted">{t.income}</dt>
        <dd className="amount text-right">{f.money(p.incomeNet, p.currency)}</dd>
      </dl>
    </div>
  );
}
