"use client";
/**
 * The simple form (4c plan §2): Vétel | Eladás; the Mai állomány tab went on
 * 2026-09-27 (every holding is a buy on its day). Broker, account and
 * instrument are chosen or created in place; the whole state goes
 * to the server as one JSON field, where buildEntry checks every field and one
 * database call records everything. What was typed survives errors and a code
 * re-entry (useServerForm resends the same FormData). A buy may take the
 * account's cash first, and a sale's money stays there unless it was taken
 * out (spec 2026-09-28 §3.4). A government security from the ÁKK list is
 * bought by nominal and amount paid, without a unit price (§3.1–§3.2).
 */
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Announce } from "@/components/announce";
import { DateField, FormMessage, NumberField, RadioGroup, SelectField, TextArea, TextField } from "@/components/fields";
import { useI18n } from "@/components/i18n-provider";
import { type ServerAction, useServerForm } from "@/components/server-form";
import { buttonClass, Notice } from "@/components/ui";
import { ACCOUNT_TYPES } from "@/lib/actions/schemas";
import type { ActionResult } from "@/lib/actions/result";
import { availableFrom, type CashStep } from "@/lib/entry/cash";
import { type EntryInput, type EntryTab, emptyEntryInput, type InstrumentInput, type PayFrom, type Proceeds } from "@/lib/entry/input";
import { D, type Dec, isDay } from "@/lib/finance/money";
import type { Locale } from "@/lib/prefs-shared";
import { parseDecimal } from "@/lib/tx/parse";
import { InstrumentPicker, type InstrumentOption, type Lookup } from "./instrument-picker";

const NEW = "__new";

export type Holding = { accountId: string; instrumentId: string; quantity: string; value: string | null };

type MarketSource = "yahoo" | "bet";

type Props = {
  institutions: { id: string; name: string }[];
  accounts: { id: string; institutionId: string; name: string }[];
  instruments: InstrumentOption[];
  /** Today's holdings: what can be sold, and a hint of how much. */
  holdings: Holding[];
  /** Cash per account and currency (cash.ts): what a buy may take, previewed here, decided on the server. */
  cash: { accountId: string; currency: string; steps: CashStep[] }[];
  currencies: string[];
  today: string;
  initial?: EntryInput;
  initialAccount?: string;
  entryId?: string;
  action: ServerAction;
  /** Tőzsdei papír keresése: `auto` asks the BÉT first, then Yahoo (lookup-actions). */
  search: (q: string, where: "auto" | "yahoo") => Promise<ActionResult>;
  /** Series on today's ÁKK list (spec 2026-09-28 §3.1). */
  searchSeries?: (q: string) => Promise<ActionResult>;
  lookup: (symbol: string, day: string, source: "yahoo" | "bet") => Promise<ActionResult>;
  /** Run after a save (Frissítés): FX rates and prices the new item needs arrive at once. */
  refresh?: () => Promise<ActionResult>;
};

const num = (raw: string, locale: Locale): Dec | null => {
  if (!raw.trim()) return null;
  const p = parseDecimal(raw, locale);
  return p.ok ? p.value : null;
};

function startState(p: Props): EntryInput {
  if (p.initial) return p.initial;
  const acc = p.accounts.find((a) => a.id === p.initialAccount) ?? p.accounts[0];
  const inst = acc?.institutionId ?? p.institutions[0]?.id;
  const firstAccount = acc ?? p.accounts.find((a) => a.institutionId === inst);
  return {
    ...emptyEntryInput(),
    tab: "buy",
    institution: inst ? { mode: "existing", id: inst, name: "" } : { mode: "new", id: "", name: "" },
    account: firstAccount ? { mode: "existing", id: firstAccount.id, name: "", accountType: "normal" } : { mode: "new", id: "", name: "", accountType: "normal" },
    date: p.today,
  };
}

/** After a save: the same place, empty amounts. */
const cleared = (s: EntryInput): EntryInput => ({
  ...emptyEntryInput(), tab: s.tab, institution: s.institution, account: s.account, date: s.date,
});

export function EntryForm(props: Props) {
  const { m, fill, f, locale } = useI18n();
  const t = m.entryForm;
  const { institutions, accounts, instruments, holdings, cash, currencies, today, entryId, action, search, searchSeries, lookup, refresh } = props;
  const [s, setS] = useState<EntryInput>(() => startState(props));
  const [infos, setInfos] = useState<Record<string, Lookup>>({});
  const [after, setAfter] = useState<"idle" | "running" | "done" | "failed">("idle");
  const form = useServerForm(action, {
    onSuccess: (_, r) => {
      if (refresh) {
        setAfter("running");
        void refresh().then((x) => setAfter(x.ok ? "done" : "failed"), () => setAfter("failed"));
      }
      setS((prev) => {
        if (entryId) return prev;
        const next = cleared(prev);
        // A broker or account created just now is an existing one from here on.
        if (r.saved) {
          next.institution = { mode: "existing", id: r.saved.institutionId, name: "" };
          next.account = { ...prev.account, mode: "existing", id: r.saved.accountId, name: "" };
        }
        return next;
      });
    },
  });
  const e = form.errors;
  const set = (patch: Partial<EntryInput>) => setS((prev) => ({ ...prev, ...patch }));

  const lookupKey = (symbol: string, day: string, source: MarketSource) => `${source}:${symbol.toUpperCase()}|${day}`;
  const asked = useRef(new Set<string>());
  const ensureInfo = useCallback(
    (symbol: string, day: string, source: MarketSource) => {
      const key = lookupKey(symbol, day, source);
      if (asked.current.has(key)) return;
      asked.current.add(key);
      setInfos((p) => ({ ...p, [key]: "loading" }));
      void lookup(symbol, day, source).then((r) => {
        if (!r.ok) asked.current.delete(key); // a later pick tries again
        setInfos((p) => ({ ...p, [key]: r.ok ? (r.info ?? null) : "error" }));
      });
    },
    [lookup],
  );

  const sell = s.tab === "sell";
  const brokerNew = s.institution.mode === "new";
  const brokerAccounts = accounts.filter((a) => a.institutionId === s.institution.id);
  const byId = new Map(instruments.map((i) => [i.id, i]));
  const held = holdings.filter((h) => h.accountId === s.account.id && new D(h.quantity).gt(0));
  // An edited sale keeps its own instrument on offer, even when it sold everything.
  const editedId = entryId && props.initial?.account.id === s.account.id && props.initial.instrument.mode === "existing" ? props.initial.instrument.id : "";
  const optionsFor = sell ? instruments.filter((i) => i.id === editedId || held.some((h) => h.instrumentId === i.id)) : instruments;

  const kindOf = (inp: InstrumentInput) => (inp.mode === "manual" ? "manual" : inp.mode === "existing" ? (byId.get(inp.id)?.valuation ?? "market") : "market");
  const isBond = (inp: InstrumentInput) => inp.mode === "akk" || (inp.mode === "existing" && byId.get(inp.id)?.source === "akk");
  const currencyOf = (inp: InstrumentInput, info?: Lookup) =>
    inp.mode === "existing" ? byId.get(inp.id)?.currency : inp.mode === "akk" ? "HUF" : inp.mode === "manual" ? inp.currency : info && typeof info === "object" ? info.currency : undefined;
  // The Yahoo symbol or BÉT code to look up, with its source; an ÁKK series is never one.
  const symbolOf = (inp: InstrumentInput): { symbol: string; source: MarketSource } | null => {
    if (inp.mode === "yahoo" || inp.mode === "bet") return inp.symbol ? { symbol: inp.symbol, source: inp.mode } : null;
    if (inp.mode !== "existing" || isBond(inp)) return null;
    const o = byId.get(inp.id);
    return o?.symbol ? { symbol: o.symbol, source: o.source === "bet" ? "bet" : "yahoo" } : null;
  };

  // ------------------------------------------------------------ broker/account
  const chooseBroker = (v: string) => {
    if (v === NEW) return set({ institution: { mode: "new", id: "", name: s.institution.name }, account: { ...s.account, mode: "new", id: "" } });
    const first = accounts.find((a) => a.institutionId === v);
    set({
      institution: { mode: "existing", id: v, name: "" },
      account: first ? { ...s.account, mode: "existing", id: first.id } : { ...s.account, mode: "new", id: "" },
    });
  };
  const chooseAccount = (v: string) => set({ account: v === NEW ? { ...s.account, mode: "new", id: "" } : { ...s.account, mode: "existing", id: v } });

  const where = (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-2 text-base font-semibold">{t.where}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          name="broker"
          label={t.broker}
          options={[...institutions.map((i) => ({ value: i.id, label: i.name })), ...(sell ? [] : [{ value: NEW, label: t.newBroker }])]}
          value={brokerNew ? NEW : s.institution.id}
          onChange={(ev) => chooseBroker(ev.target.value)}
          error={e["institution.id"]}
        />
        {brokerNew ? (
          <TextField name="brokerName" label={t.newBrokerName} maxLength={100} autoComplete="off" value={s.institution.name}
            onChange={(ev) => set({ institution: { ...s.institution, name: ev.target.value } })} error={e["institution.name"]} />
        ) : null}
        <SelectField
          name="account"
          label={t.account}
          options={[...brokerAccounts.map((a) => ({ value: a.id, label: a.name })), ...(sell ? [] : [{ value: NEW, label: t.newAccount }])]}
          value={s.account.mode === "new" ? NEW : s.account.id}
          disabled={brokerNew}
          onChange={(ev) => chooseAccount(ev.target.value)}
          error={e["account.id"]}
        />
        {s.account.mode === "new" ? (
          <>
            <TextField name="accountName" label={t.newAccountName} maxLength={100} autoComplete="off" value={s.account.name}
              onChange={(ev) => set({ account: { ...s.account, name: ev.target.value } })} error={e["account.name"]} />
            <SelectField name="accountType" label={t.accountType} options={ACCOUNT_TYPES.map((x) => ({ value: x, label: m.accounts.types[x] }))}
              value={s.account.accountType} onChange={(ev) => set({ account: { ...s.account, accountType: ev.target.value } })} error={e["account.accountType"]} />
          </>
        ) : null}
      </div>
    </fieldset>
  );

  // ------------------------------------------------------------ buy / sell
  const inst = s.instrument;
  const manual = kindOf(inst) === "manual";
  const bond = isBond(inst);
  const tradeSym = symbolOf(inst);
  // The lookup for the chosen symbol on the buy day: its name for a new one, the close for a buy without a price.
  const tradeInfo = tradeSym && s.date ? infos[lookupKey(tradeSym.symbol, s.date, tradeSym.source)] : undefined;
  const ccy = currencyOf(inst, tradeInfo);
  const holding = held.find((h) => inst.mode === "existing" && h.instrumentId === inst.id);
  const close = !sell && tradeInfo && typeof tradeInfo === "object" && tradeInfo.close && tradeInfo.currency === ccy ? tradeInfo.close : null;
  const byClose = !sell && !s.price.trim() && !s.total.trim() && close !== null;
  const summary = (() => {
    if (manual || !ccy) return null;
    const qty = num(s.quantity, locale);
    const price = num(s.price, locale) ?? (byClose ? new D(close!.price) : null);
    const total = num(s.total, locale);
    const fee = num(s.fee, locale) ?? new D(0);
    const gross = total ?? (qty && price ? qty.times(price) : null);
    if (!gross) return null;
    const base = total ? f.money(total, ccy) : `${f.quantity(qty!)} × ${f.price(price!, ccy)}`;
    const text = fee.isZero()
      ? total ? base : `${base} = ${f.money(gross, ccy)}`
      : fill(sell ? t.summarySellFee : t.summaryFee, { base, fee: f.money(fee, ccy), total: f.money(sell ? gross.minus(fee) : gross.plus(fee), ccy) });
    return byClose ? fill(t.buyEstimate, { text }) : text;
  })();
  const priceHint = (() => {
    if (sell || !tradeSym) return ccy ? fill(t.priceHint, { currency: ccy }) : undefined;
    const bet = tradeSym.source === "bet";
    if (close && ccy) return fill(bet ? t.buyPriceBet : t.buyPriceYahoo, { price: f.price(new D(close.price), ccy), date: f.day(close.day) });
    if (tradeInfo === null || (tradeInfo && typeof tradeInfo === "object")) return bet ? t.buyPriceNeededBet : t.buyPriceNeeded;
    return bet ? t.buyPriceLaterBet : t.buyPriceLater;
  })();
  // Spec 2026-09-28 §3.4: what the buy costs, and what the account's cash can pay of it (a preview).
  const cost = (() => {
    if (manual) return num(s.amount, locale);
    const qty = num(s.quantity, locale);
    const price = num(s.price, locale) ?? (byClose ? new D(close!.price) : null);
    const gross = num(s.total, locale) ?? (qty && price ? qty.times(price) : null);
    return gross ? gross.plus(num(s.fee, locale) ?? 0) : null;
  })();
  const available =
    !sell && s.account.mode === "existing" && ccy && isDay(s.date)
      ? availableFrom(cash.find((c) => c.accountId === s.account.id && c.currency === ccy)?.steps, s.date)
      : new D(0);
  const payHint = (() => {
    if (!ccy) return null;
    const money = (d: Dec) => f.money(d, ccy);
    if (s.payFrom === "deposit") return fill(t.payFromDepositHint, { available: money(available) });
    if (!cost) return fill(t.payFromCashAvailable, { available: money(available) });
    const rest = cost.minus(D.min(cost, available));
    return rest.gt(0)
      ? fill(t.payFromCashPartial, { available: money(available), rest: money(rest) })
      : fill(t.payFromCashAll, { available: money(available) });
  })();
  const pickInstrument = (v: InstrumentInput) => {
    set({ instrument: v });
    const sym = symbolOf(v);
    if (!sell && v.mode === "existing" && sym && s.date) ensureInfo(sym.symbol, s.date, sym.source);
  };
  const pickDate = (date: string) => {
    set({ date });
    if (!sell && tradeSym && /^\d{4}-\d{2}-\d{2}$/.test(date)) ensureInfo(tradeSym.symbol, date, tradeSym.source);
  };

  const trade = (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DateField name="date" label={t.date} max={today} value={s.date} onChange={(ev) => pickDate(ev.target.value)} error={e.date} />
      </div>
      {sell && optionsFor.length === 0 ? (
        <Notice>{t.noHoldings}</Notice>
      ) : (
        <InstrumentPicker
          value={inst}
          onChange={pickInstrument}
          options={optionsFor}
          currencies={currencies}
          errors={e}
          errorKey="instrument"
          allowNew={!sell}
          search={search}
          onPickSymbol={(symbol, source) => s.date && ensureInfo(symbol, s.date, source)}
          info={inst.mode === "yahoo" || inst.mode === "bet" ? tradeInfo : undefined}
          searchSeries={searchSeries}
        />
      )}
      {holding ? (
        <p className="text-sm text-text-muted">
          {manual
            ? holding.value && ccy ? fill(t.heldValue, { value: f.money(new D(holding.value), ccy) }) : null
            : bond
              ? fill(t.heldNominal, { amount: f.money(new D(holding.quantity), "HUF") })
              : fill(t.held, { qty: f.quantity(new D(holding.quantity)) })}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {manual ? (
          <>
            <NumberField name="amount" label={sell ? t.takenOut : t.paidIn} value={s.amount} onChange={(ev) => set({ amount: ev.target.value })} error={e.amount} />
            <NumberField name="newValue" label={t.newValue} optional hint={sell ? t.newValueHintSell : t.newValueHintBuy} value={s.newValue}
              onChange={(ev) => set({ newValue: ev.target.value })} error={e.newValue} />
          </>
        ) : bond ? (
          <>
            <NumberField name="quantity" label={t.nominal} value={s.quantity} onChange={(ev) => set({ quantity: ev.target.value })} error={e.quantity} />
            <NumberField
              name="total"
              label={sell ? t.receivedTotal : t.paidTotal}
              optional={!sell}
              hint={sell ? undefined : s.date === today ? t.akkTotalTodayHint : t.akkTotalHint}
              value={s.total}
              onChange={(ev) => set({ total: ev.target.value })}
              error={e.total}
            />
            <NumberField name="fee" label={t.fee} optional value={s.fee} onChange={(ev) => set({ fee: ev.target.value })} error={e.fee} />
          </>
        ) : (
          <>
            <NumberField name="quantity" label={t.quantity} value={s.quantity} onChange={(ev) => set({ quantity: ev.target.value })} error={e.quantity} />
            <NumberField name="price" label={t.price} optional={!sell} hint={priceHint} value={s.price}
              onChange={(ev) => set({ price: ev.target.value })} error={e.price} />
            <NumberField name="total" label={t.total} optional hint={t.totalHint} value={s.total} onChange={(ev) => set({ total: ev.target.value })} error={e.total} />
            <NumberField name="fee" label={t.fee} optional value={s.fee} onChange={(ev) => set({ fee: ev.target.value })} error={e.fee} />
          </>
        )}
        <TextArea name="note" label={t.note} optional maxLength={500} className="sm:col-span-2" value={s.note} onChange={(ev) => set({ note: ev.target.value })} error={e.note} />
      </div>
      {!sell && available.gt(0) ? (
        <div className="flex flex-col gap-1">
          <RadioGroup
            legend={t.payFrom}
            name="payFrom"
            value={s.payFrom}
            onChange={(v) => set({ payFrom: v as PayFrom })}
            options={[{ value: "cash", label: t.payFromCash }, { value: "deposit", label: t.payFromDeposit }]}
          />
          <p className="text-sm text-text-muted">{payHint}</p>
        </div>
      ) : null}
      {sell ? (
        <div className="flex flex-col gap-1">
          <RadioGroup
            legend={t.proceeds}
            name="proceeds"
            value={s.proceeds}
            onChange={(v) => set({ proceeds: v as Proceeds })}
            options={[{ value: "keep", label: t.proceedsKeep }, { value: "withdraw", label: t.proceedsWithdraw }]}
          />
          <p className="text-sm text-text-muted">{s.proceeds === "keep" ? t.proceedsKeepHint : t.proceedsWithdrawHint}</p>
        </div>
      ) : null}
      <p className="amount text-sm font-medium">{summary}</p>
      {/* One settled line for screen readers instead of two live regions (#27). */}
      <Announce text={[summary, !sell && available.gt(0) ? payHint : null].filter(Boolean).join(" ")} />
    </div>
  );

  const setTab = (tab: EntryTab) => {
    form.clear();
    // Each tab starts with empty amounts: nothing typed for a buy slips into a sale.
    const fresh = { ...cleared(s), tab };
    // A sale needs an existing broker and account.
    if (tab === "sell" && (s.institution.mode === "new" || s.account.mode === "new")) {
      const inst0 = institutions[0];
      const acc0 = accounts.find((a) => a.institutionId === inst0?.id);
      return setS({
        ...fresh,
        institution: inst0 ? { mode: "existing", id: inst0.id, name: "" } : s.institution,
        account: acc0 ? { ...s.account, mode: "existing", id: acc0.id } : s.account,
      });
    }
    setS(fresh);
  };

  return (
    <>
      <form onSubmit={(e) => (setAfter("idle"), form.onSubmit(e))} className="flex flex-col gap-6" noValidate>
        <input type="hidden" name="entry" value={JSON.stringify(s)} />
        {entryId ? <input type="hidden" name="entryId" value={entryId} /> : null}
        {entryId ? (
          <p className="font-medium">{fill(t.editing, { kind: t.tabs[s.tab] })}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <RadioGroup
              legend={t.tabsLegend}
              name="tab"
              value={s.tab}
              onChange={(v) => setTab(v as EntryTab)}
              options={(["buy", "sell"] as const).map((x) => ({ value: x, label: t.tabs[x] }))}
            />
            <p className="text-sm text-text-muted">{t.tabHints[s.tab]}</p>
          </div>
        )}
        {where}
        {trade}
        <FormMessage
          error={form.formError ?? (Object.keys(e).length ? "invalid" : undefined)}
          success={
            form.ok ? (
              <>
                {t.success}{" "}
                {after === "running" ? `${t.refreshing} ` : after === "done" ? `${t.refreshed} ` : after === "failed" ? `${t.refreshFailed} ` : null}
                <Link href="/transactions" className="underline underline-offset-2">
                  {t.viewList}
                </Link>
              </>
            ) : undefined
          }
        />
        <div>
          <button type="submit" className={buttonClass.primary} disabled={form.pending}>
            {form.pending ? t.submitting : entryId ? t.submitEdit : t.submit}
          </button>
        </div>
        {entryId ? null : (
          <p className="text-sm">
            <Link href="/transactions/advanced" className="text-accent underline underline-offset-4">
              {t.advanced}
            </Link>
          </p>
        )}
      </form>
      {form.dialog}
    </>
  );
}
