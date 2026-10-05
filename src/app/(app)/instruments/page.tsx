import type { Metadata } from "next";
import { ConfirmDelete } from "@/components/confirm-action";
import { type FieldSpec, FormDialog } from "@/components/form-dialog";
import { Amount, Day } from "@/components/format";
import { Badge, Card, PageHeader, TableScroll, td, tdNum, th, thNum } from "@/components/ui";
import { ASSET_CLASSES, priceSourceChoices } from "@/lib/actions/schemas";
import { getPortfolio } from "@/lib/data/portfolio";
import { D, todayInBudapest } from "@/lib/finance/money";
import { dayOf, selectPrice, staleness } from "@/lib/finance/prices";
import type { InstrumentMeta } from "@/lib/data/load";
import type { Messages } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { createInstrument, deleteInstrument, updateInstrument } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.instruments.title };
}

/** The instrument fields; an edit fills them in and keeps the valuation kind. */
function fields(m: Messages, i?: InstrumentMeta): FieldSpec[] {
  const t = m.instruments;
  const d = (v: string | number | null | undefined) => (v === null || v === undefined ? undefined : String(v));
  return [
    ...(i ? [{ kind: "hidden" as const, name: "id", value: i.id }, { kind: "hidden" as const, name: "valuation", value: i.valuation }] : []),
    { kind: "text", name: "name", label: t.name, maxLength: 120, defaultValue: d(i?.name) },
    { kind: "select", name: "assetClass", label: t.assetClass, options: ASSET_CLASSES.map((x) => ({ value: x, label: m.assetClasses[x] })), defaultValue: d(i?.asset_class) },
    { kind: "text", name: "currency", label: t.currency, maxLength: 3, placeholder: "USD", defaultValue: d(i?.currency), hint: i ? t.currencyHint : undefined },
    { kind: "text", name: "ticker", label: t.ticker, optional: true, maxLength: 32, defaultValue: d(i?.ticker) },
    { kind: "text", name: "isin", label: t.isin, optional: true, maxLength: 12, defaultValue: d(i?.isin) },
    { kind: "text", name: "exchange", label: t.exchange, optional: true, maxLength: 32, defaultValue: d(i?.exchange) },
    ...(i
      ? []
      : [{ kind: "select" as const, name: "valuation", label: t.valuation, options: (["market", "manual"] as const).map((x) => ({ value: x, label: t.valuations[x] })) }]),
    { kind: "select", name: "priceSource", label: t.priceSource, hint: t.priceSourceHint, options: priceSourceChoices(i?.price_source).map((x) => ({ value: x, label: t.priceSources[x as keyof typeof t.priceSources] ?? x })), defaultValue: d(i?.price_source) },
    { kind: "text", name: "providerSymbol", label: t.providerSymbol, hint: t.providerSymbolHint, optional: true, maxLength: 64, defaultValue: d(i?.provider_symbol) },
    { kind: "number", name: "staleAfterDays", label: t.staleAfter, hint: t.staleAfterHint, optional: true, defaultValue: d(i?.stale_after_days) },
  ];
}

export default async function InstrumentsPage() {
  const { m, fill } = await getI18n();
  const t = m.instruments;
  const data = await getPortfolio(todayInBudapest());
  const today = todayInBudapest();
  const used = new Set(data.events.flatMap((e) => e.lines.map((l) => l.instrumentId)));

  return (
    <>
      <PageHeader
        title={t.title}
        actions={
          <FormDialog
            label={t.new}
            icon="plus"
            action={createInstrument}
            fields={fields(m)}
          />
        }
      />
      <Card id="instruments">
        {data.instrumentMeta.length === 0 ? (
          <p className="text-text-muted">{t.empty}</p>
        ) : (
          <TableScroll label={fill(m.common.table, { name: t.title })}>
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={th}>{t.name}</th>
                  <th scope="col" className={th}>{t.assetClass}</th>
                  <th scope="col" className={th}>{t.currency}</th>
                  <th scope="col" className={th}>{t.valuation}</th>
                  <th scope="col" className={thNum}>{t.lastPrice}</th>
                  <th scope="col" className={th}>
                    <span className="sr-only">{m.common.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.instrumentMeta.map((i) => {
                  const q = i.valuation === "market" ? selectPrice(data.quotes, { id: i.id, priceSource: i.price_source }, today) : null;
                  const age = q ? staleness(dayOf(q.asOf), today, "market", i.stale_after_days) : null;
                  return (
                    <tr key={i.id}>
                      <th scope="row" className={`${td} text-left font-normal`}>
                        <span className="font-medium">{i.name}</span>
                        <span className="block text-xs text-text-muted">{[i.ticker, i.isin, i.exchange].filter(Boolean).join(" · ") || m.common.none}</span>
                      </th>
                      <td className={td}>{m.assetClasses[i.asset_class as keyof typeof m.assetClasses]}</td>
                      <td className={td}>{i.currency}</td>
                      <td className={td}>
                        {i.valuation === "manual" ? m.prices.tabs.valuations : t.priceSources[i.price_source as keyof typeof t.priceSources]}
                      </td>
                      <td className={tdNum}>
                        {q ? (
                          <>
                            <Amount value={new D(q.price)} currency={i.currency} />
                            <span className="block text-xs text-text-muted">
                              <Day day={dayOf(q.asOf)} />
                            </span>
                            {age?.stale ? <Badge tone="warn">{m.common.stale}</Badge> : null}
                          </>
                        ) : (
                          <span className="text-text-muted">{i.valuation === "manual" ? m.positions.manualValue : m.common.missingPrice}</span>
                        )}
                      </td>
                      <td className={`${td} text-right whitespace-nowrap`}>
                        <FormDialog label={fill(t.editTitle, { name: i.name })} icon="pencil" compact action={updateInstrument} fields={fields(m, i)} />
                        {used.has(i.id) ? (
                          <span className="sr-only">{t.inUse}</span>
                        ) : (
                          <ConfirmDelete action={deleteInstrument} fields={{ id: i.id }} label={fill(t.deleteTitle, { name: i.name })} title={fill(t.deleteTitle, { name: i.name })} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </>
  );
}
