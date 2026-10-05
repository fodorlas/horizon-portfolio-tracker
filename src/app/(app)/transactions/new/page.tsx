import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { getPortfolio } from "@/lib/data/portfolio";
import { todayInBudapest } from "@/lib/finance/money";
import { getI18n } from "@/lib/i18n-server";
import { entryFormData } from "@/lib/views/entry-form";
import { recordEntry } from "../actions";
import { searchSeries, searchSymbols, symbolInfo } from "../lookup-actions";
import { refreshPrices } from "../../refresh-actions";
import { EntryForm } from "./entry-form";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.entryForm.title };
}
// Saving looks the new Yahoo symbols up again (4c plan §5).
export const maxDuration = 60;

/** Új tétel: Vétel | Eladás (4c plan §2; no Mai állomány since 2026-09-27). `?account=` preselects an account. */
export default async function NewEntryPage({ searchParams }: PageProps<"/transactions/new">) {
  const { m } = await getI18n();
  const sp = await searchParams;
  const today = todayInBudapest();
  const data = await getPortfolio(today);
  const initialAccount = data.accountMeta.some((a) => a.id === sp.account) ? (sp.account as string) : undefined;

  return (
    <>
      <PageHeader title={m.entryForm.title} />
      <Card>
        <EntryForm {...entryFormData(data, today)} initialAccount={initialAccount} action={recordEntry} search={searchSymbols} searchSeries={searchSeries} lookup={symbolInfo} refresh={refreshPrices} />
      </Card>
    </>
  );
}
