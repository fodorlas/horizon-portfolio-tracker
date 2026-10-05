"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { I18nProvider } from "@/components/i18n-provider";
import { ValueChart } from "@/components/value-chart";
import { Badge, Card, Notice, TableScroll, buttonClass, td, tdNum, th, thNum } from "@/components/ui";
import { DEMO_COPY, formatDemoMoney, formatDemoPrice } from "@/demo/copy";
import { DEMO_SEED } from "@/demo/seed";
import type { DemoCurrency, DemoState, DemoTransaction } from "@/demo/types";
import { D, todayInBudapest, type Dec } from "@/lib/finance/money";
import { i18nFor } from "@/lib/i18n";
import { createDemoSessionStore, DemoTradeError, executeDemoTrade, portfolioValue } from "@/lib/demo/store";

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function moneyInCurrency(state: DemoState, amount: Dec, from: DemoCurrency): Dec {
  return amount.times(state.ratesToHuf[from]).div(state.ratesToHuf[state.displayCurrency]);
}

function accountValue(state: DemoState, accountId: string): Dec {
  let value = new D(0);
  for (const cash of state.cash.filter((row) => row.accountId === accountId)) {
    value = value.plus(moneyInCurrency(state, new D(cash.amount), cash.currency));
  }
  for (const position of state.positions.filter((row) => row.accountId === accountId)) {
    const asset = state.assets.find((row) => row.id === position.assetId);
    if (asset) value = value.plus(moneyInCurrency(state, new D(position.units).times(asset.marketPrice), asset.currency));
  }
  return value;
}

function dateLabel(date: string, locale: DemoState["locale"]): string {
  return i18nFor(locale).f.day(date);
}

function numberLabel(value: string, locale: DemoState["locale"]): string {
  return i18nFor(locale).f.quantity(new D(value));
}

export function DemoExperience() {
  const [sessionStore] = useState(() => createDemoSessionStore());
  const { state, storageAvailable } = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot, sessionStore.getServerSnapshot);
  const [action, setAction] = useState<"buy" | "sell">("buy");
  const [accountId, setAccountId] = useState(DEMO_SEED.accounts[0].id);
  const [assetId, setAssetId] = useState(DEMO_SEED.assets[0].id);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const copy = DEMO_COPY[state.locale];

  useEffect(() => {
    sessionStore.hydrate(sessionStorageOrNull());
  }, [sessionStore]);

  useEffect(() => {
    document.documentElement.lang = state.locale;
  }, [state.locale]);

  const persist = (next: DemoState) => {
    sessionStore.update(next, sessionStorageOrNull());
  };

  const total = portfolioValue(state, state.displayCurrency);
  const cashTotal = useMemo(
    () => state.cash.reduce((sum, row) => sum.plus(moneyInCurrency(state, new D(row.amount), row.currency)), new D(0)),
    [state],
  );
  const invested = total.minus(cashTotal);
  const today = todayInBudapest();
  const chartPoints = state.history.map((point) => ({
    day: point.date,
    value: new D(point.totalHuf).div(state.ratesToHuf[state.displayCurrency]).toFixed(),
    label: formatDemoMoney(Number(new D(point.totalHuf).div(state.ratesToHuf[state.displayCurrency])), state.displayCurrency, state.locale),
    dayLabel: dateLabel(point.date, state.locale),
  }));
  const todayPoint = {
    day: today,
    value: total.toFixed(),
    label: formatDemoMoney(total.toNumber(), state.displayCurrency, state.locale),
    dayLabel: dateLabel(today, state.locale),
  };
  if (chartPoints.at(-1)?.day === today) chartPoints[chartPoints.length - 1] = todayPoint;
  else chartPoints.push(todayPoint);

  const allocation = state.assets.reduce((groups, asset) => {
    const quantity = state.positions.filter((position) => position.assetId === asset.id).reduce((sum, position) => sum.plus(position.units), new D(0));
    if (quantity.isZero()) return groups;
    const value = moneyInCurrency(state, quantity.times(asset.marketPrice), asset.currency);
    groups.set(asset.kind, (groups.get(asset.kind) ?? new D(0)).plus(value));
    return groups;
  }, new Map<string, Dec>());
  const allocationMax = [...allocation.values()].reduce((max, value) => value.gt(max) ? value : max, new D(0));

  const selectedAsset = state.assets.find((asset) => asset.id === assetId) ?? state.assets[0];
  function submitTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    try {
      const next = executeDemoTrade(state, {
        action,
        accountId: String(fields.get("accountId")),
        assetId: String(fields.get("assetId")),
        units: String(fields.get("units")),
        price: String(fields.get("price")),
      });
      persist(next);
      setMessage({ kind: "success", text: DEMO_COPY[next.locale].tradeSaved });
      event.currentTarget.reset();
    } catch (error) {
      const currentCopy = DEMO_COPY[state.locale];
      const text = error instanceof DemoTradeError
        ? error.code === "insufficient_cash" ? currentCopy.insufficientCash
          : error.code === "insufficient_units" ? currentCopy.insufficientUnits
            : error.code === "invalid_trade" ? currentCopy.invalidTrade : currentCopy.tradeError
        : currentCopy.tradeError;
      setMessage({ kind: "error", text });
    }
  }

  function transactionLabel(transaction: DemoTransaction): string {
    if (transaction.assetId) return state.assets.find((asset) => asset.id === transaction.assetId)?.name ?? copy.asset;
    return state.accounts.find((account) => account.id === transaction.accountId)?.name ?? copy.account;
  }

  const firstHistory = state.history[0]?.date ?? today;
  const historyDescription = copy.historySummary
    .replace("{from}", dateLabel(firstHistory, state.locale))
    .replace("{to}", dateLabel(today, state.locale));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-text-muted">Horizon</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-accent sm:text-4xl">{copy.pageTitle}</h1>
          <p className="mt-2 max-w-2xl text-sm text-text-muted">{copy.tagline}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="demo-language">Language</label>
          <select
            id="demo-language"
            aria-label={state.locale === "en" ? "Language" : "Nyelv"}
            className="rounded-xl border border-control bg-card px-3 py-2 text-sm"
            value={state.locale}
            onChange={(event) => persist({ ...state, locale: event.target.value as DemoState["locale"] })}
          >
            <option value="en">English</option>
            <option value="hu">Magyar</option>
          </select>
          <label className="sr-only" htmlFor="demo-currency">{copy.displayCurrency}</label>
          <select
            id="demo-currency"
            className="rounded-xl border border-control bg-card px-3 py-2 text-sm"
            value={state.displayCurrency}
            onChange={(event) => persist({ ...state, displayCurrency: event.target.value as DemoCurrency })}
          >
            {(["HUF", "EUR", "USD"] as const).map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
        </div>
      </header>

      <Notice tone="info">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{storageAvailable ? copy.demoNotice : copy.memoryNotice}</span>
          <div className="flex flex-wrap items-center gap-3">
            <a href="#live-version" className="font-medium underline underline-offset-2">{copy.liveLink}</a>
            <button type="button" className={buttonClass.secondary} onClick={() => {
              sessionStore.reset(sessionStorageOrNull());
              setMessage(null);
            }}>{copy.reset}</button>
          </div>
        </div>
      </Notice>

      <section aria-label={copy.value} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard testId="portfolio-value" title={copy.value} value={formatDemoMoney(total.toNumber(), state.displayCurrency, state.locale)} primary />
        <StatCard testId="cash-value" title={copy.cash} value={formatDemoMoney(cashTotal.toNumber(), state.displayCurrency, state.locale)} />
        <StatCard title={copy.invested} value={formatDemoMoney(invested.toNumber(), state.displayCurrency, state.locale)} />
        <StatCard title={copy.accounts} value={String(state.accounts.length)} />
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title={copy.valueHistory} className="lg:col-span-2">
          <figure>
            <I18nProvider locale={state.locale}>
              <ValueChart points={chartPoints} markers={[]} height={250} />
            </I18nProvider>
            <figcaption className="mt-2 text-xs text-text-muted">{historyDescription}</figcaption>
          </figure>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-text-muted">{copy.chartTable}</summary>
            <TableScroll label={copy.valueHistory}>
              <table className="mt-2 w-full border-collapse">
                <thead><tr className="border-b border-border"><th className={th}>{copy.tableDate}</th><th className={thNum}>{copy.tableValue}</th></tr></thead>
                <tbody>{chartPoints.map((point) => <tr key={point.day} className="border-b border-border last:border-0"><td className={td}>{point.dayLabel}</td><td className={`${tdNum} amount`}>{point.label}</td></tr>)}</tbody>
              </table>
            </TableScroll>
          </details>
        </Card>
        <Card title={copy.allocation}>
          <ul className="flex flex-col gap-4">
            {[...allocation.entries()].map(([kind, value]) => {
              const width = allocationMax.isZero() ? 0 : value.div(allocationMax).times(100).toNumber();
              const label = copy.kind[kind as keyof typeof copy.kind];
              return (
                <li key={kind}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span>{label}</span>
                    <span className="amount text-text-muted">{formatDemoMoney(value.toNumber(), state.displayCurrency, state.locale)}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title={copy.tradeTitle} className="lg:col-span-1">
          <p className="mb-4 text-sm text-text-muted">{copy.tradeIntro}</p>
          <form className="flex flex-col gap-4" onSubmit={submitTrade}>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={copy.tradeTitle}>
              <button type="button" aria-pressed={action === "buy"} className={action === "buy" ? buttonClass.primary : buttonClass.secondary} onClick={() => setAction("buy")}>{copy.buy}</button>
              <button type="button" aria-pressed={action === "sell"} className={action === "sell" ? buttonClass.primary : buttonClass.secondary} onClick={() => setAction("sell")}>{copy.sell}</button>
            </div>
            <Field label={copy.account} id="demo-account">
              <select id="demo-account" name="accountId" className={inputClass} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                {state.accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name} · {state.institutions.find((row) => row.id === account.institutionId)?.name}</option>
                ))}
              </select>
            </Field>
            <Field label={copy.asset} id="demo-asset">
              <select id="demo-asset" name="assetId" className={inputClass} value={assetId} onChange={(event) => setAssetId(event.target.value)}>
                {state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} ({asset.ticker}) · {asset.currency}</option>)}
              </select>
            </Field>
            <Field label={`${copy.units} (${selectedAsset.ticker})`} id="demo-units">
              <input id="demo-units" name="units" type="number" min="0.0001" step="any" required className={inputClass} defaultValue="1" />
            </Field>
            <Field label={`${copy.tradePrice} (${selectedAsset.currency})`} id="demo-price">
              <input key={selectedAsset.id} id="demo-price" name="price" type="number" min="0.0001" step="any" required className={inputClass} defaultValue={selectedAsset.marketPrice} />
            </Field>
            <p className="text-xs text-text-muted">{copy.samplePrices}: {formatDemoPrice(selectedAsset.marketPrice, selectedAsset.currency, state.locale)}</p>
            <button type="submit" className={buttonClass.primary}>{copy.saveTrade}</button>
            {message ? <p role={message.kind === "error" ? "alert" : "status"} aria-live="polite" className={message.kind === "error" ? "text-sm text-loss" : "text-sm text-gain"}>{message.text}</p> : null}
          </form>
        </Card>

        <Card title={copy.holdings} className="lg:col-span-2">
          <TableScroll label={copy.holdings}>
            <table className="w-full border-collapse text-sm">
              <thead><tr className="border-b border-border"><th className={th}>{copy.asset}</th><th className={th}>{copy.account}</th><th className={thNum}>{copy.units}</th><th className={thNum}>{copy.marketPrice}</th><th className={thNum}>{copy.positionValue}</th></tr></thead>
              <tbody>
                {state.positions.map((position) => {
                  const asset = state.assets.find((row) => row.id === position.assetId)!;
                  const account = state.accounts.find((row) => row.id === position.accountId)!;
                  const value = moneyInCurrency(state, new D(position.units).times(asset.marketPrice), asset.currency);
                  return <tr key={`${position.accountId}-${position.assetId}`} className="border-b border-border last:border-0">
                    <td className={td}><span className="font-medium">{asset.name}</span><span className="mt-1 block text-xs text-text-muted">{asset.ticker} · {copy.kind[asset.kind]}</span></td>
                    <td className={td}>{account.name}</td>
                    <td className={`${tdNum} amount`}>{numberLabel(position.units, state.locale)}</td>
                    <td className={`${tdNum} amount whitespace-nowrap`}>{formatDemoPrice(asset.marketPrice, asset.currency, state.locale)} <span className="block"><Badge>{copy.samplePrices}</Badge></span></td>
                    <td className={`${tdNum} amount whitespace-nowrap`}>{formatDemoMoney(value.toNumber(), state.displayCurrency, state.locale)}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title={copy.accounts}>
          <ul className="divide-y divide-border">
            {state.accounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div><p className="font-medium">{account.name}</p><p className="text-xs text-text-muted">{state.institutions.find((row) => row.id === account.institutionId)?.name}</p></div>
                <p className="amount whitespace-nowrap">{formatDemoMoney(accountValue(state, account.id).toNumber(), state.displayCurrency, state.locale)}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={copy.recentActivity}>
          {state.transactions.length === 0 ? <p className="text-sm text-text-muted">{copy.noActivity}</p> : (
            <ol className="divide-y divide-border">
              {[...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 6).map((transaction) => (
                <li key={transaction.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div><p className="font-medium">{copy.action[transaction.action]} · {transactionLabel(transaction)}</p><time dateTime={transaction.date} className="text-xs text-text-muted">{dateLabel(transaction.date, state.locale)}</time></div>
                  <p className="amount whitespace-nowrap text-right">{transaction.units ? `${numberLabel(transaction.units, state.locale)} × ` : ""}{transaction.price ? formatDemoMoney(Number(transaction.price), transaction.currency, state.locale) : ""}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <footer className="space-y-3 pb-8 text-xs text-text-muted">
        <p>{copy.estimate}</p>
        <section id="live-version" className="scroll-mt-4 rounded-2xl border border-border bg-card p-4">
          <h2 className="font-semibold text-text">{copy.liveTitle}</h2>
          <p className="mt-1">{copy.liveDescription}</p>
        </section>
      </footer>
    </div>
  );
}

const inputClass = "w-full rounded-xl border border-control bg-card px-3 py-2 text-sm text-text";

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <label htmlFor={id} className="flex flex-col gap-1.5 text-sm font-medium">{label}{children}</label>;
}

function StatCard({ title, value, primary = false, testId }: { title: string; value: string; primary?: boolean; testId?: string }) {
  return <Card className={primary ? "border-accent/30" : ""}>
    <p className="text-sm text-text-muted">{title}</p>
    <p data-testid={testId} className={`amount mt-2 text-2xl font-semibold tracking-tight ${primary ? "text-accent" : ""}`}>{value}</p>
  </Card>;
}
