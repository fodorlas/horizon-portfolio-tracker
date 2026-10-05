import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { getPortfolio } from "@/lib/data/portfolio";
import { EVENT_TYPES, type EventType } from "@/lib/finance/ledger";
import { todayInBudapest } from "@/lib/finance/money";
import { getI18n } from "@/lib/i18n-server";
import { currenciesOf } from "@/lib/views/entry-form";
import { recordTransaction } from "../actions";
import { TransactionForm } from "./transaction-form";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.txForm.title };
}

/** The full form with every event type (dividends, splits, FX, corrections…), unchanged from 2b. */
export default async function AdvancedTransactionPage({ searchParams }: PageProps<"/transactions/advanced">) {
  const { m } = await getI18n();
  const sp = await searchParams;
  const data = await getPortfolio(todayInBudapest());
  const institutions = new Map(data.institutions.map((i) => [i.id, i.name]));

  const currencies = currenciesOf(data);
  const initialType = EVENT_TYPES.includes(sp.type as EventType) ? (sp.type as EventType) : undefined;
  const initialAccount = data.accountMeta.some((a) => a.id === sp.account) ? (sp.account as string) : undefined;

  return (
    <>
      <PageHeader title={m.txForm.title} />
      <Card>
        <TransactionForm
          accounts={data.accountMeta.map((a) => ({
            id: a.id,
            label: a.name,
            group: institutions.get(a.institution_id) ?? "?",
            trackingStart: a.tracking_start_date,
          }))}
          instruments={data.instrumentMeta.map((i) => ({
            id: i.id,
            label: i.ticker ? `${i.name} (${i.ticker})` : i.name,
            currency: i.currency,
            valuation: i.valuation as "market" | "manual",
            bond: i.price_source === "akk",
          }))}
          currencies={currencies}
          today={todayInBudapest()}
          initialType={initialType}
          initialAccount={initialAccount}
          action={recordTransaction}
        />
      </Card>
    </>
  );
}
