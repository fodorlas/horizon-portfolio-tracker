"use client";
/**
 * The "new transaction" form: one set of fields per event type (plan §2). The
 * server action builds and validates the ledger lines; this only shows the
 * right fields and keeps what was typed (also through a code re-entry).
 */
import Link from "next/link";
import { useState } from "react";
import { DateField, FormMessage, type Option, type OptionGroup, NumberField, RadioGroup, SelectField, TextArea } from "@/components/fields";
import { useI18n } from "@/components/i18n-provider";
import { type ServerAction, useServerForm } from "@/components/server-form";
import { buttonClass, Notice } from "@/components/ui";
import type { EventType } from "@/lib/finance/ledger";
import { TX_TYPES } from "@/lib/tx/build";


export type AccountOption = { id: string; label: string; group: string; trackingStart: string };
export type InstrumentOption = { id: string; label: string; currency: string; valuation: "market" | "manual"; /** An ÁKK paper. */ bond?: boolean };

type Props = {
  accounts: AccountOption[];
  instruments: InstrumentOption[];
  currencies: string[];
  today: string;
  initialType?: EventType;
  initialAccount?: string;
  action: ServerAction;
};

const NEEDS_INSTRUMENT: EventType[] = ["buy", "sell", "dividend", "dividend_reinvest", "interest_reinvest", "split"];

function groupAccounts(accounts: AccountOption[]): OptionGroup[] {
  const groups = new Map<string, Option[]>();
  for (const a of accounts) groups.set(a.group, [...(groups.get(a.group) ?? []), { value: a.id, label: a.label }]);
  return [...groups].map(([label, options]) => ({ label, options }));
}

export function TransactionForm({ accounts, instruments, currencies, today, initialType = "buy", initialAccount, action }: Props) {
  const { m, fill, f } = useI18n();
  const t = m.txForm;
  const [type, setType] = useState<EventType>(initialType);
  const [accountId, setAccountId] = useState(initialAccount ?? accounts[0]?.id ?? "");
  const [instrumentId, setInstrumentId] = useState(instruments[0]?.id ?? "");
  const [asset, setAsset] = useState<"cash" | "position">("cash");
  const [bondId, setBondId] = useState("");
  const [correctionKind, setCorrectionKind] = useState<"missing_flow" | "reconciliation">("missing_flow");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [resetKey, setResetKey] = useState(0);
  const form = useServerForm(action, { onSuccess: () => setResetKey((k) => k + 1) });
  const e = form.errors;

  if (accounts.length === 0) {
    return (
      <Notice tone="info">
        {t.needAccounts}{" "}
        <Link href="/accounts" className="underline underline-offset-2">
          {m.nav.accounts}
        </Link>
      </Notice>
    );
  }

  const account = accounts.find((a) => a.id === accountId);
  const inst = instruments.find((i) => i.id === instrumentId);
  const accountGroups = groupAccounts(accounts);
  const instrumentOptions = instruments.map((i) => ({ value: i.id, label: `${i.label} · ${i.currency}` }));
  const bonds = instruments.filter((i) => i.bond);
  const currencyOptions = currencies.map((c) => ({ value: c, label: c }));

  const usesInstrument =
    NEEDS_INSTRUMENT.includes(type) ||
    (type === "transfer" && asset === "position") ||
    (type === "opening_balance" && asset === "position") ||
    (type === "correction" && correctionKind === "reconciliation" && asset === "position");
  const usesAsset = type === "transfer" || type === "opening_balance" || (type === "correction" && correctionKind === "reconciliation");
  const cashAmount =
    ["deposit", "withdrawal", "fee"].includes(type) ||
    ((type === "transfer" || type === "opening_balance") && asset === "cash") ||
    (type === "correction" && (correctionKind === "missing_flow" || asset === "cash"));
  const missingInstrument = usesInstrument && instruments.length === 0;

  const instrumentField = (label = t.instrument) => (
    <SelectField name="instrumentId" label={label} options={instrumentOptions} value={instrumentId} onChange={(ev) => setInstrumentId(ev.target.value)} error={e.instrumentId} />
  );
  const currencyField = (name: string, label: string, defaultValue: string, optional = false) => (
    <SelectField key={`${name}-${defaultValue}`} name={name} label={label} options={currencyOptions} defaultValue={defaultValue} error={e[name]} optional={optional} />
  );
  const num = (name: string, label: string, opts: { hint?: string; optional?: boolean } = {}) => (
    <NumberField name={name} label={label} hint={opts.hint} optional={opts.optional} error={e[name]} />
  );

  return (
    <>
      <form onSubmit={form.onSubmit} className="flex flex-col gap-5" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            name="type"
            label={t.type}
            options={TX_TYPES.map((x) => ({ value: x, label: m.eventTypes[x] }))}
            value={type}
            onChange={(ev) => {
              setType(ev.target.value as EventType);
              form.clear();
            }}
            hint={m.eventTypeHints[type]}
            error={e.type}
          />
          {type === "opening_balance" ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t.date}</span>
              <p className="rounded-xl border border-border bg-subtle px-3 py-2 text-sm">
                {account ? fill(t.openingDate, { date: f.day(account.trackingStart) }) : m.common.none}
              </p>
            </div>
          ) : (
            <DateField name="date" label={t.date} defaultValue={today} max={today} error={e.date} />
          )}
        </div>

        {type === "correction" ? (
          <div className="grid grid-cols-1 gap-4">
            <RadioGroup
              legend={t.correctionKind}
              name="correctionKind"
              value={correctionKind}
              onChange={(v) => setCorrectionKind(v as typeof correctionKind)}
              options={[
                { value: "missing_flow", label: t.missingFlow },
                { value: "reconciliation", label: t.reconciliation },
              ]}
              error={e.correctionKind}
            />
            <RadioGroup
              legend={t.direction}
              name="direction"
              value={direction}
              onChange={(v) => setDirection(v as typeof direction)}
              options={[
                { value: "in", label: t.directionIn },
                { value: "out", label: t.directionOut },
              ]}
              error={e.direction}
            />
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            name="accountId"
            label={type === "transfer" ? t.fromAccount : t.account}
            groups={accountGroups}
            value={accountId}
            onChange={(ev) => setAccountId(ev.target.value)}
            error={e.accountId}
          />
          {type === "transfer" ? <SelectField name="toAccountId" label={t.toAccount} groups={accountGroups} defaultValue={accounts.find((a) => a.id !== accountId)?.id} error={e.toAccountId} /> : null}
        </div>

        {usesAsset ? (
          <RadioGroup
            legend={t.asset}
            name="asset"
            value={asset}
            onChange={(v) => setAsset(v as typeof asset)}
            options={[
              { value: "cash", label: t.assetCash },
              { value: "position", label: t.assetPosition },
            ]}
            error={e.asset}
          />
        ) : null}

        {missingInstrument ? (
          <Notice tone="info">
            {t.needInstruments}{" "}
            <Link href="/instruments" className="underline underline-offset-2">
              {m.nav.instruments}
            </Link>
          </Notice>
        ) : null}

        {/* Remounted after a successful save, so the amounts start empty again. */}
        <div key={`${type}-${resetKey}`} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {usesInstrument && !missingInstrument ? instrumentField(type === "dividend" ? t.payer : t.instrument) : null}

          {type === "buy" || type === "sell" ? (
            <>
              {num("quantity", t.quantity)}
              {num("price", t.price, { hint: t.priceHint })}
              {num("total", t.total, { hint: t.totalHint, optional: true })}
              {num("fee", t.fee, { optional: true })}
              {currencyField("feeCurrency", t.feeCurrency, inst?.currency ?? "HUF")}
            </>
          ) : null}

          {type === "interest" && bonds.length > 0 ? (
            <SelectField
              name="instrumentId"
              label={t.interestBond}
              hint={t.interestBondHint}
              options={[{ value: "", label: t.interestNoBond }, ...bonds.map((b) => ({ value: b.id, label: b.label }))]}
              value={bondId}
              onChange={(ev) => setBondId(ev.target.value)}
              optional
              error={e.instrumentId}
            />
          ) : null}

          {type === "dividend" || type === "interest" ? (
            <>
              {type === "interest" && bondId ? null : currencyField("currency", t.currency, type === "dividend" ? (inst?.currency ?? "HUF") : "HUF")}
              {num("gross", t.gross)}
              {num("tax", t.tax, { optional: true })}
            </>
          ) : null}

          {type === "dividend_reinvest" ? (
            <>
              {num("gross", t.gross)}
              {num("tax", t.tax, { optional: true })}
              {num("quantity", t.quantity)}
              {num("reinvest", t.reinvest, { hint: t.reinvestHint, optional: true })}
            </>
          ) : null}

          {type === "interest_reinvest" ? num("gross", t.interestCredited, { hint: t.interestCreditedHint }) : null}

          {type === "split" ? (
            <>
              {num("ratioFrom", t.ratioFrom, { hint: t.ratioHint })}
              {num("ratioTo", t.ratioTo)}
            </>
          ) : null}

          {type === "fx_exchange" ? (
            <>
              {currencyField("fromCurrency", t.fromCurrency, "HUF")}
              {num("fromAmount", t.fromAmount)}
              {currencyField("toCurrency", t.toCurrency, "EUR")}
              {num("toAmount", t.toAmount)}
              {num("fee", t.fee, { optional: true })}
              {currencyField("feeCurrency", t.feeCurrency, "HUF")}
            </>
          ) : null}

          {cashAmount ? (
            <>
              {currencyField("currency", t.currency, "HUF")}
              {num("amount", t.amount)}
            </>
          ) : null}

          {usesInstrument && (type === "transfer" || type === "opening_balance" || type === "correction") ? num("quantity", t.quantity) : null}

          {type === "opening_balance" && asset === "position" ? (
            <>
              {inst?.valuation === "manual"
                ? num("value", t.openingValue, { hint: t.openingValueHint })
                : num("price", t.openingPrice, { hint: t.openingPriceHint })}
              {num("cost", t.cost, { hint: t.costHint, optional: true })}
            </>
          ) : null}

          {type === "correction" && correctionKind === "reconciliation" && asset === "position" && direction === "in"
            ? num("price", t.correctionPrice, { hint: t.correctionPriceHint, optional: true })
            : null}

          <TextArea
            name="note"
            label={type === "correction" ? t.noteRequired : t.note}
            optional={type !== "correction"}
            maxLength={500}
            className="sm:col-span-2"
            error={e.note}
          />
        </div>

        <FormMessage
          error={form.formError ?? (Object.keys(e).length ? "invalid" : undefined)}
          success={
            form.ok ? (
              <>
                {t.success}{" "}
                <Link href="/transactions" className="underline underline-offset-2">
                  {t.viewList}
                </Link>
              </>
            ) : undefined
          }
        />
        <div>
          <button type="submit" className={buttonClass.primary} disabled={form.pending || missingInstrument}>
            {form.pending ? t.submitting : t.submit}
          </button>
        </div>
      </form>
      {form.dialog}
    </>
  );
}
