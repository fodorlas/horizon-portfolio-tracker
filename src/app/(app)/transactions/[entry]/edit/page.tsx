import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, Notice, PageHeader } from "@/components/ui";
import { getPortfolio } from "@/lib/data/portfolio";
import { todayInBudapest } from "@/lib/finance/money";
import { getI18n } from "@/lib/i18n-server";
import { entryKind, entryToInput, isBondKind } from "@/lib/views/entries";
import { entryFormData } from "@/lib/views/entry-form";
import { replaceEntry } from "../../actions";
import { searchSeries, searchSymbols, symbolInfo } from "../../lookup-actions";
import { EntryForm } from "../../new/entry-form";
import { refreshPrices } from "../../../refresh-actions";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.entryForm.editTitle };
}
export const maxDuration = 60;

/** An entry in the same form, filled in; saving replaces it as one unit (replace_entry). */
export default async function EditEntryPage({ params }: PageProps<"/transactions/[entry]/edit">) {
  const i18n = await getI18n();
  const { m } = i18n;
  const { entry } = await params;
  const today = todayInBudapest();
  const data = await getPortfolio(today);
  const events = data.events.filter((e) => data.eventEntries.get(e.id) === entry);
  if (events.length === 0) notFound();

  const accountId = events[0].lines[0].accountId;
  const institutionId = data.accountMeta.find((a) => a.id === accountId)?.institution_id ?? "";
  const valuation = new Map(data.instrumentMeta.map((i) => [i.id, i.valuation as "market" | "manual"]));
  const initial = entryToInput(
    events,
    { valuations: data.logs.valuations.filter((v) => v.entry_id === entry).map((v) => ({ value: v.value, note: v.note })) },
    { institutionId, valuationOf: (id) => valuation.get(id), bondOf: (id) => data.instrumentMeta.some((i) => i.id === id && i.price_source === "akk") },
    i18n,
  );

  if (!initial) {
    // An entry of the old Mai állomány tab (the form records buys only now), or an approved
    // proposal, which changes on its card once sent back (spec 2026-09-28 §6.2).
    return (
      <>
        <PageHeader title={m.entryForm.editTitle} />
        <Card>
          <Notice>{isBondKind(entryKind(events)) ? m.entryForm.bondEntry : m.entryForm.oldOpening}</Notice>
          <p className="mt-4 text-sm">
            <Link href="/transactions" className="text-accent underline underline-offset-4">
              {m.entryForm.viewList}
            </Link>
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title={m.entryForm.editTitle} />
      <Card>
        <EntryForm {...entryFormData(data, today, entry)} initial={initial} entryId={entry} action={replaceEntry} search={searchSymbols} searchSeries={searchSeries} lookup={symbolInfo} refresh={refreshPrices} />
      </Card>
    </>
  );
}
