import type { Metadata } from "next";
import Link from "next/link";
import { EventLines } from "@/components/event-lines";
import { getI18n } from "@/lib/i18n-server";
import { entryDetail } from "@/lib/views/entries";
import { Amount, Change, Day, Pct } from "@/components/format";
import { DismissedList, PendingCard } from "@/components/pending-card";
import { RefreshButton } from "@/components/refresh-button";
import { ButtonLink, Card, Notice, PageHeader, Segmented } from "@/components/ui";
import { ValueChart } from "@/components/value-chart";
import { getPortfolio } from "@/lib/data/portfolio";
import { loadPending } from "@/lib/data/pending";
import { getLastRefreshAt } from "@/lib/data/refresh-log";
import { addDays, D, type Dec, todayInBudapest } from "@/lib/finance/money";
import { getPrefs } from "@/lib/prefs";
import { nameMaps, type Names } from "@/lib/views/names";
import { type OverviewModel, overview, parsePeriod, periodStart, PERIODS, type Slice } from "@/lib/views/portfolio";
import { type PendingCard as PendingCardModel, pendingModel } from "@/lib/views/pending";
import { approvePending, dismissPending, restorePending, snoozePending } from "./pending-actions";
import { refreshPrices } from "./refresh-actions";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.overview.title };
}
/** The Frissítés action runs here: room for the work budget (phase 4 plan §3). */
export const maxDuration = 60;

const ALLOC = ["assetClass", "currency", "account"] as const;
type AllocKey = (typeof ALLOC)[number];
const parseAlloc = (v: unknown): AllocKey => (ALLOC.includes(v as AllocKey) ? (v as AllocKey) : "assetClass");

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const { m } = await getI18n();
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const alloc = parseAlloc(sp.alloc);
  const today = todayInBudapest();
  // Prices from the day before the period (V(S − 1)); "all" needs every price.
  const pricesFrom = period === "all" ? undefined : addDays(periodStart(period, today, today), -1);
  const [data, prefs, lastRefresh, pendingRows] = await Promise.all([getPortfolio(pricesFrom), getPrefs(), getLastRefreshAt(), loadPending()]);

  if (data.accountMeta.length === 0) return <Welcome />;

  const model = overview(data, today, prefs.currency, period, data.eventEntries);
  const names = nameMaps(data);
  const pending = pendingModel(pendingRows, names);
  const href = (p: Partial<{ period: string; alloc: string }>) => `/?${new URLSearchParams({ period, alloc, ...p })}`;

  return (
    <>
      <PageHeader title={m.overview.title} actions={<RefreshButton action={refreshPrices} lastAt={lastRefresh} />} />
      <div className="grid grid-cols-1 gap-5">
        <Pending cards={pending.cards} dismissed={pending.dismissed} />
        <Hero model={model} periodLinks={PERIODS.map((p) => ({ href: href({ period: p }), text: m.periods[p], current: p === period }))} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card
            id="allocation"
            title={m.overview.allocation}
            className="lg:col-span-2"
            action={
              <Segmented
                label={m.overview.allocation}
                items={ALLOC.map((a) => ({ href: href({ alloc: a }), text: m.overview.allocationBy[a], current: a === alloc }))}
              />
            }
          >
            <Allocation slices={model.allocation[alloc]} by={alloc} names={names} currency={model.currency} />
          </Card>
          <FxPanel model={model} />
        </div>
        <Recent model={model} names={names} manual={new Set(data.instrumentMeta.filter((i) => i.valuation === "manual").map((i) => i.id))} />
      </div>
    </>
  );
}

/** Ellenőrzésre vár (spec 2026-09-28 §6.5): at the top while anything waits, or something was set aside. */
async function Pending({ cards, dismissed }: { cards: PendingCardModel[]; dismissed: PendingCardModel[] }) {
  const { m, fill } = await getI18n();
  if (cards.length === 0 && dismissed.length === 0) return null;
  const actions = { approve: approvePending, snooze: snoozePending, dismiss: dismissPending, restore: restorePending };
  return (
    <Card id="pending" title={fill(m.pending.title, { count: cards.length })}>
      <div className="flex flex-col gap-3">
        {cards.length > 0 ? <p className="text-sm text-text-muted">{m.pending.intro}</p> : null}
        {cards.map((c) => (
          <PendingCard key={c.id} card={c} actions={actions} />
        ))}
        <DismissedList cards={dismissed} restore={restorePending} />
      </div>
    </Card>
  );
}

async function Hero({ model, periodLinks }: { model: OverviewModel; periodLinks: { href: string; text: string; current: boolean }[] }) {
  const { m, fill, f: fmt } = await getI18n();
  const f = model.figures;
  const ccy = model.currency;
  const trackingIn = f?.flows.filter((x) => x.kind === "tracking_in").reduce<Dec>((a, x) => a.plus(x.amount), new D(0));
  const points = model.series.map((p) => ({ day: p.day, value: p.value, label: fmt.money(new D(p.value), ccy), dayLabel: fmt.day(p.day) }));
  const first = model.series[0];
  const last = model.series.at(-1);
  // The period's three figures, each on a tile of its own (the owner's request, 2026-09-30).
  const tile = "flex flex-col rounded-2xl border border-border bg-subtle p-4";

  const stats = f ? (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div data-tile className={tile}>
        <dt className="text-sm text-text-muted">{m.overview.result}</dt>
        <dd className="mt-1 text-xl font-semibold">
          <Change value={f.result} currency={ccy} />
        </dd>
        <dd className="mt-1 text-xs text-text-muted">{m.overview.resultHint}</dd>
      </div>
      <div data-tile className={tile}>
        <dt className="text-sm text-text-muted">{m.overview.netFlow}</dt>
        <dd className="mt-1 text-xl font-semibold">
          <Amount value={f.netFlow} currency={ccy} />
        </dd>
        <dd className="mt-1 text-xs text-text-muted">
          {m.overview.netFlowHint}
          {trackingIn && !trackingIn.isZero() ? (
            <>
              {" · "}
              <span className="amount">{fill(m.overview.trackingIn, { amount: fmt.money(trackingIn, ccy) })}</span>
            </>
          ) : null}
        </dd>
      </div>
      <div data-tile className={tile}>
        <dt className="text-sm text-text-muted">{m.overview.return}</dt>
        <dd className="mt-1 text-xl font-semibold">
          {f.notMeaningful ? <span className="text-text-muted">{m.overview.notMeaningful}</span> : <Pct rate={f.returnRate} />}
        </dd>
        <dd className="mt-1 text-xs text-text-muted">{m.overview.returnHint}</dd>
      </div>
    </dl>
  ) : null;

  return (
    <>
      <Card id="hero">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-text-muted">{m.overview.totalValue}</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">
                <Amount value={model.now.total} currency={ccy} />
              </p>
              <p className="mt-1 text-sm text-text-muted">{fill(m.overview.valueAt, { date: fmt.day(model.today) })}</p>
            </div>
            <Segmented label={m.overview.period} items={periodLinks} />
          </div>
          {model.missingCount > 0 ? (
            <Notice tone="warn">
              {fill(m.overview.missing, { count: model.missingCount })}{" "}
              <Link href="/positions" className="underline underline-offset-2">
                {m.nav.positions}
              </Link>
            </Notice>
          ) : null}
          {model.now.staleShare.gt(0) ? (
            <Notice tone="warn">{fill(m.overview.staleShare, { share: fmt.percent(model.now.staleShare, 1, false) })}</Notice>
          ) : null}
          {stats}
          {f && (f.truncated || f.largeFlows || !f.complete) ? (
            <ul className="flex flex-col gap-1 text-sm text-text-muted">
              {f.truncated ? <li>{fill(m.overview.sinceTracking, { date: fmt.day(f.start) })}</li> : null}
              {f.largeFlows ? <li>{m.overview.largeFlows}</li> : null}
              {!f.complete ? <li className="text-warn">{m.overview.incomplete}</li> : null}
            </ul>
          ) : null}
        </div>
      </Card>

      {f && first && last ? (
        <Card id="chart" title={m.overview.chartTitle}>
          <figure>
            <ValueChart points={points} markers={model.markers.map((mk) => ({ day: mk.day, label: m.overview.markers[mk.kind] }))} height={260} />
            <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
              <span className="amount">
                {fill(m.overview.chartSummary, {
                  from: fmt.day(first.day),
                  start: fmt.money(new D(first.value), ccy),
                  to: fmt.day(last.day),
                  end: fmt.money(new D(last.value), ccy),
                })}
              </span>
              {model.markers.length ? (
                <span>
                  <span aria-hidden="true" className="text-[var(--c3)]">
                    ┆{" "}
                  </span>
                  {[...new Set(model.markers.map((mk) => `${m.overview.markers[mk.kind]}: ${fmt.day(mk.day)}`))].join(" · ")}
                </span>
              ) : null}
            </figcaption>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-text-muted">{m.overview.chartTable}</summary>
              <div className="mt-2 max-h-64 overflow-y-auto" role="region" aria-label={m.overview.chartTable} tabIndex={0}>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="py-1 text-left font-medium text-text-muted">{m.overview.chartDay}</th>
                      <th className="py-1 text-right font-medium text-text-muted">{m.overview.chartValue}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.day} className="border-t border-border">
                        <td className="py-1">{p.dayLabel}</td>
                        <td className="amount py-1 text-right">{p.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </figure>
        </Card>
      ) : null}
    </>
  );
}

async function Allocation({ slices, by, names, currency }: { slices: Slice[]; by: AllocKey; names: Names; currency: string }) {
  const { m, f } = await getI18n();
  if (slices.length === 0) return <p className="text-text-muted">{m.overview.allocationEmpty}</p>;
  const label = (key: string) =>
    by === "assetClass" ? ((m.assetClasses as Record<string, string>)[key] ?? key) : by === "account" ? (names.account.get(key) ?? key) : key;
  const color = (i: number) => `var(--c${Math.min(i + 1, 6)})`;
  const positive = slices.filter((s) => s.share.gt(0));
  return (
    <>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-subtle" aria-hidden="true">
        {positive.map((s, i) => (
          <div key={s.key} style={{ width: `${s.share.times(100).toFixed(2)}%`, background: color(i) }} />
        ))}
      </div>
      <ul className="mt-4 flex flex-col gap-3">
        {slices.map((s, i) => (
          <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ background: color(i) }} />
              <span className="truncate">{label(s.key)}</span>
            </span>
            <span className="flex items-baseline gap-3">
              <Amount value={s.value} currency={currency} className="font-medium" />
              <span className="w-14 text-right text-text-muted">{f.percent(s.share, 1, false)}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

async function FxPanel({ model }: { model: OverviewModel }) {
  const { m, fill, f } = await getI18n();
  return (
    <Card id="fx" title={m.overview.fxTitle}>
      <ul className="flex flex-col gap-3">
        {model.fx.map((r) => (
          <li key={`${r.base}${r.quote}`} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">
              {r.base}/{r.quote}
            </span>
            {r.selection.kind === "rate" ? (
              <span className="text-right">
                <span className="font-semibold">{fill(m.overview.fxRow, { base: r.base, quote: r.quote, rate: f.rate(r.selection.rate) })}</span>
                <span className="block text-xs text-text-muted">
                  {(m.prices.sources as Record<string, string>)[r.selection.source] ?? r.selection.source} · <Day day={r.selection.rateDate} />
                  {r.stale ? <span className="text-warn"> · {m.common.stale}</span> : null}
                </span>
              </span>
            ) : (
              <span className="text-text-muted">{m.overview.fxMissing}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function Recent({ model, names, manual }: { model: OverviewModel; names: Names; manual: ReadonlySet<string> }) {
  const i18n = await getI18n();
  const { m } = i18n;
  return (
    <Card id="recent" title={m.overview.recent} action={<Link href="/transactions" className="text-sm text-accent underline underline-offset-4">{m.overview.allTransactions}</Link>}>
      {model.recent.length === 0 ? (
        <p className="text-text-muted">{m.overview.noTransactions}</p>
      ) : (
        <ul className="divide-y divide-border">
          {model.recent.map((item) => {
            // An entry (Vétel / Eladás, or an old opening) is one row; other events as they are.
            const e = item.kind === "entry" ? item.entry : null;
            const ev = item.kind === "event" ? item.event : null;
            const inst = e ? e.instrumentId : ev!.lines.find((l) => l.instrumentId)?.instrumentId;
            const accountId = e ? e.accountId : (ev!.lines[0]?.accountId ?? "");
            return (
              <li key={e ? e.id : ev!.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {e ? m.transactions.kinds[e.kind] : m.eventTypes[ev!.type]}
                    {inst ? <span className="font-normal text-text-muted"> · {names.instrument.get(inst)}</span> : null}
                  </p>
                  <p className="text-xs text-text-muted">
                    <Day day={e ? e.date : ev!.date} /> · {names.account.get(accountId)}
                  </p>
                </div>
                {e ? <span className="amount text-sm">{entryDetail(e, i18n)}</span> : <EventLines event={ev!} manual={manual} i18n={i18n} />}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

async function Welcome() {
  const { m } = await getI18n();
  return (
    <>
      <PageHeader title={m.overview.emptyTitle} />
      <Card>
        <p>{m.overview.emptyText}</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          {m.overview.emptySteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <ButtonLink href="/accounts">{m.nav.accounts}</ButtonLink>
          <ButtonLink href="/instruments" variant="secondary">
            {m.nav.instruments}
          </ButtonLink>
        </div>
      </Card>
    </>
  );
}
