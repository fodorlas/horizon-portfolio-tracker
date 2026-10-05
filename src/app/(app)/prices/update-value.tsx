import { FormDialog } from "@/components/form-dialog";
import { getI18n } from "@/lib/i18n-server";
import { addValuation } from "./actions";

/** Érték frissítése: a new manual value in the log (4c plan §1); no flow, the change is a return. */
export async function UpdateValue({ accountId, instrumentId, name, today }: { accountId: string; instrumentId: string; name: string; today: string }) {
  const { m, fill } = await getI18n();
  const t = m.accounts;
  return (
    <FormDialog
      label={t.updateValue}
      title={fill(t.updateValueTitle, { name })}
      intro={t.updateValueIntro}
      variant="secondary"
      action={addValuation}
      fields={[
        { kind: "hidden", name: "accountId", value: accountId },
        { kind: "hidden", name: "instrumentId", value: instrumentId },
        { kind: "date", name: "day", label: t.day, defaultValue: today, max: today },
        { kind: "number", name: "value", label: t.newValue },
        { kind: "textarea", name: "note", label: t.valueNote, optional: true, maxLength: 500 },
      ]}
    />
  );
}
