"use client";
/**
 * Choosing an instrument in the simple form (4c plan §2): one of the existing
 * ones, a market search hit – the BÉT first, then Yahoo (spec 2026-09-28
 * §12/3); a paper already there is offered as that instrument – or a new
 * manual-valued item. The state lives in the form; this
 * only edits it and keeps the search results.
 */
import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { FormMessage, RadioGroup, SelectField, TextField } from "@/components/fields";
import { useI18n } from "@/components/i18n-provider";
import { Badge, buttonClass } from "@/components/ui";
import { ASSET_CLASSES } from "@/lib/actions/schemas";
import type { ActionResult } from "@/lib/actions/result";
import type { InstrumentInput } from "@/lib/entry/input";
import type { SeriesHit } from "@/lib/providers/akk";
import type { SearchHit, SymbolInfo } from "@/lib/providers/symbols";


/** `symbol`: the Yahoo symbol or the ÁKK series (`source` says which). */
export type InstrumentOption = { id: string; name: string; label: string; currency: string; valuation: "market" | "manual"; symbol: string | null; source?: string };
export type Lookup = SymbolInfo | null | "loading" | "error";

const blank = (mode: InstrumentInput["mode"], over: Partial<InstrumentInput> = {}): InstrumentInput => ({
  mode, id: "", symbol: "", name: "", currency: "", assetClass: "", ...over,
});

/** A Yahoo or BÉT lookup as one line: name, currency and kind (the buy's price field shows the close). */
export function LookupLine({ info, source = "yahoo" }: { info: Lookup | undefined; source?: "yahoo" | "bet" }) {
  const { m, fill } = useI18n();
  const t = m.picker;
  if (info === undefined) return null;
  if (info === "loading") return <p className="text-sm text-text-muted">{t.looking}</p>;
  if (info === "error") return <FormMessage error={source === "bet" ? "betUnavailable" : "yahooUnavailable"} />;
  if (info === null) return <FormMessage error={source === "bet" ? "betCodeNotFound" : "symbolNotFound"} />;
  return (
    <p className="text-sm">{fill(t.info, { name: info.name, currency: info.currency, type: m.assetClasses[info.assetClass] })}</p>
  );
}

export function InstrumentPicker({
  value,
  onChange,
  options,
  currencies,
  errors,
  errorKey,
  allowNew,
  search,
  onPickSymbol,
  info,
  searchSeries,
}: {
  value: InstrumentInput;
  onChange: (v: InstrumentInput) => void;
  options: InstrumentOption[];
  currencies: string[];
  errors: Record<string, string>;
  /** Server error keys: `${errorKey}`, `${errorKey}.name`, … */
  errorKey: string;
  allowNew: boolean;
  /** `auto`: the BÉT first, then Yahoo; `yahoo`: Yahoo only. */
  search: (q: string, where: "auto" | "yahoo") => Promise<ActionResult>;
  /** A new Yahoo symbol or BÉT code was chosen: the form looks it up for the preview. */
  onPickSymbol: (symbol: string, source: "yahoo" | "bet") => void;
  info: Lookup | undefined;
  /** Government securities on today's ÁKK list (spec 2026-09-28 §3.1); without it the option is not offered. */
  searchSeries?: (q: string) => Promise<ActionResult>;
}) {
  const { m, fill, f } = useI18n();
  const t = m.picker;
  const uid = useId();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ hits: SearchHit[]; from: "bet" | "yahoo"; betDown: boolean; where: "auto" | "yahoo" } | null>(null);
  const [status, setStatus] = useState<"idle" | "searching" | "error">("idle");
  // "Nem ez?" unmounts itself: after its search the keyboard goes on from the first hit.
  const hitsRef = useRef<HTMLFieldSetElement>(null);
  const focusHits = useRef(false);
  // Searches are numbered: an answer counts only if no newer search started since (#40).
  const lastSearch = useRef(0);
  const lastSeriesSearch = useRef(0);
  useEffect(() => {
    if (!focusHits.current) return;
    focusHits.current = false;
    hitsRef.current?.querySelector<HTMLInputElement>("input[type=radio]")?.focus();
  }, [found]);

  // Papers already there, by source. The same paper may be a BÉT code or its .BD Yahoo symbol (OTP ↔ OTP.BD).
  const byYahoo = new Map(options.filter((o) => o.symbol && o.source !== "akk" && o.source !== "bet").map((o) => [o.symbol!.toUpperCase(), o]));
  const byBet = new Map(options.filter((o) => o.symbol && o.source === "bet").map((o) => [o.symbol!.toUpperCase(), o]));
  const knownOf = (h: SearchHit) => {
    const k = h.symbol.toUpperCase();
    if (h.source === "bet") return byBet.get(k) ?? byYahoo.get(`${k}.BD`);
    return byYahoo.get(k) ?? (k.endsWith(".BD") ? byBet.get(k.slice(0, -3)) : undefined);
  };
  const bySeries = new Map(options.filter((o) => o.symbol && o.source === "akk").map((o) => [o.symbol!.toUpperCase(), o]));
  const [seriesQuery, setSeriesQuery] = useState("");
  const [seriesHits, setSeriesHits] = useState<SeriesHit[] | null>(null);
  const [seriesStatus, setSeriesStatus] = useState<"idle" | "searching" | "error">("idle");
  // The same name and currency is the manual item already there (buildEntry does the same).
  const sameManual =
    value.mode === "manual" &&
    value.name.trim() !== "" &&
    options.some((o) => o.valuation === "manual" && o.currency === value.currency && o.name.trim().toLocaleLowerCase("hu") === value.name.trim().toLocaleLowerCase("hu"));
  const select = (
    <SelectField
      name={`${uid}-instrument`}
      label={m.entryForm.instrument}
      placeholder={m.entryForm.choose}
      options={options.map((o) => ({ value: o.id, label: `${o.label} · ${o.currency}` }))}
      value={value.mode === "existing" ? value.id : ""}
      onChange={(e) => onChange(blank("existing", { id: e.target.value }))}
      error={errors[errorKey]}
    />
  );
  if (!allowNew) return select;

  async function runSearch(where: "auto" | "yahoo" = "auto") {
    if (!query.trim()) return;
    const n = ++lastSearch.current;
    setStatus("searching");
    const r = await search(query.trim(), where);
    if (n !== lastSearch.current) return;
    if (r.ok) {
      focusHits.current = where === "yahoo";
      setFound({ hits: r.hits ?? [], from: r.from ?? "yahoo", betDown: r.betDown ?? false, where });
      setStatus("idle");
    } else setStatus("error");
  }
  // What the search found, and after the BÉT why Yahoo answers.
  const searchStatus = (() => {
    if (status === "searching") return t.searching;
    if (!found) return "";
    const n = found.hits.length;
    if (found.from === "bet") return fill(t.countBet, { count: n });
    const why = found.where === "auto" ? (found.betDown ? t.betDown : t.noneOnBet) : "";
    if (n === 0) return found.where === "auto" && found.betDown ? `${t.betDown} ${t.none}` : t.none;
    return why ? `${why} ${fill(t.countYahoo, { count: n })}` : fill(t.countYahoo, { count: n });
  })();
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter searches here instead of submitting the whole form.
    if (e.key === "Enter") {
      e.preventDefault();
      void runSearch();
    }
  };
  async function runSeriesSearch() {
    if (!seriesQuery.trim() || !searchSeries) return;
    const n = ++lastSeriesSearch.current;
    setSeriesStatus("searching");
    const r = await searchSeries(seriesQuery.trim());
    if (n !== lastSeriesSearch.current) return;
    if (r.ok) {
      setSeriesHits(r.series ?? []);
      setSeriesStatus("idle");
    } else setSeriesStatus("error");
  }
  const onSeriesKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runSeriesSearch();
    }
  };
  const pickSeries = (h: SeriesHit) => {
    const known = bySeries.get(h.series.toUpperCase());
    if (known) return onChange(blank("existing", { id: known.id }));
    onChange(blank("akk", { symbol: h.series, name: `${h.label} ${h.series}`, currency: "HUF", assetClass: "bond" }));
  };
  const seriesLine = (h: SeriesHit) =>
    fill(h.coupon ? t.akkHit : t.akkHitNoCoupon, { name: `${h.label} ${h.series}`, maturity: f.day(h.maturity), coupon: h.coupon ? f.typed(h.coupon) : "" });

  const pick = (h: SearchHit) => {
    const known = knownOf(h);
    if (known) return onChange(blank("existing", { id: known.id }));
    onChange(blank(h.source, { symbol: h.symbol, name: h.name, assetClass: h.assetClass }));
    onPickSymbol(h.symbol, h.source);
  };

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        legend={t.source}
        name={`${uid}-source`}
        value={value.mode === "bet" ? "yahoo" : value.mode}
        onChange={(v) => onChange(v === "manual" ? blank("manual", { currency: "HUF", assetClass: "managed" }) : blank(v as InstrumentInput["mode"]))}
        options={[
          { value: "existing", label: t.existing },
          { value: "yahoo", label: t.market },
          ...(searchSeries ? [{ value: "akk", label: t.akk }] : []),
          { value: "manual", label: t.manual },
        ]}
      />

      {value.mode === "existing" ? select : null}

      {value.mode === "yahoo" || value.mode === "bet" ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <TextField
              name={`${uid}-query`}
              label={t.query}
              hint={t.queryHint}
              className="grow"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              autoComplete="off"
              maxLength={64}
              error={errors[errorKey]}
            />
            <button type="button" className={buttonClass.secondary} onClick={() => void runSearch()} disabled={status === "searching"}>
              <Search aria-hidden="true" size={16} />
              {t.search}
            </button>
          </div>
          <p role="status" className="text-sm text-text-muted">
            {searchStatus}
          </p>
          {status === "error" ? <FormMessage error="yahooUnavailable" /> : null}
          {found?.hits.length ? (
            <fieldset ref={hitsRef} className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t.results}</legend>
              {found.hits.map((h) => {
                const known = knownOf(h);
                return (
                  <label key={`${h.source}:${h.symbol}`} className="flex cursor-pointer items-start gap-2 rounded-xl border border-control px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                    <input
                      type="radio"
                      name={`${uid}-hit`}
                      checked={value.mode === h.source && value.symbol.toUpperCase() === h.symbol.toUpperCase()}
                      onChange={() => pick(h)}
                      className="mt-1 accent-[var(--accent)]"
                    />
                    {h.source === "bet" ? (
                      // The BÉT names a paper by its code (spec 2026-09-28 §2.6).
                      <span className="min-w-0">
                        <span className="font-medium">{h.symbol}</span> · {m.assetClasses[h.assetClass]} <Badge tone="neutral">{t.bet}</Badge>{" "}
                        {known ? <Badge tone="accent">{t.already}</Badge> : null}
                      </span>
                    ) : (
                      <span className="min-w-0">
                        <span className="font-medium">{h.symbol}</span> · {h.name}
                        {h.exchange ? <span className="text-text-muted"> · {h.exchange}</span> : null}{" "}
                        {known ? <Badge tone="accent">{t.already}</Badge> : null}
                      </span>
                    )}
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          {found?.from === "bet" ? (
            <button type="button" className={`${buttonClass.ghost} self-start`} onClick={() => void runSearch("yahoo")} disabled={status === "searching"}>
              {t.searchYahoo}
            </button>
          ) : null}
          {value.symbol ? <LookupLine info={info} source={value.mode === "bet" ? "bet" : "yahoo"} /> : null}
        </div>
      ) : null}

      {value.mode === "akk" ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <TextField
              name={`${uid}-series`}
              label={t.akkQuery}
              hint={t.akkQueryHint}
              className="grow"
              value={seriesQuery}
              onChange={(e) => setSeriesQuery(e.target.value)}
              onKeyDown={onSeriesKey}
              autoComplete="off"
              maxLength={32}
              error={errors[errorKey]}
            />
            <button type="button" className={buttonClass.secondary} onClick={() => void runSeriesSearch()} disabled={seriesStatus === "searching"}>
              <Search aria-hidden="true" size={16} />
              {t.search}
            </button>
          </div>
          <p role="status" className="text-sm text-text-muted">
            {seriesStatus === "searching" ? t.searching : seriesHits ? (seriesHits.length ? fill(t.count, { count: seriesHits.length }) : t.akkNone) : ""}
          </p>
          {seriesStatus === "error" ? <FormMessage error="akkUnavailable" /> : null}
          {seriesHits?.length ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t.results}</legend>
              {seriesHits.map((h) => {
                const known = bySeries.get(h.series.toUpperCase());
                return (
                  <label key={h.series} className="flex cursor-pointer items-start gap-2 rounded-xl border border-control px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                    <input
                      type="radio"
                      name={`${uid}-series-hit`}
                      checked={value.mode === "akk" && value.symbol.toUpperCase() === h.series.toUpperCase()}
                      onChange={() => pickSeries(h)}
                      className="mt-1 accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      {seriesLine(h)} {known ? <Badge tone="accent">{t.already}</Badge> : null}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}
        </div>
      ) : null}

      {value.mode === "manual" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField
            name={`${uid}-name`}
            label={t.manualName}
            className="sm:col-span-3"
            value={value.name}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            error={errors[`${errorKey}.name`]}
            hint={sameManual ? t.sameManual : undefined}
          />
          <SelectField
            name={`${uid}-currency`}
            label={t.manualCurrency}
            options={currencies.map((c) => ({ value: c, label: c }))}
            value={value.currency}
            onChange={(e) => onChange({ ...value, currency: e.target.value })}
            error={errors[`${errorKey}.currency`]}
          />
          <SelectField
            name={`${uid}-type`}
            label={t.manualType}
            className="sm:col-span-2"
            options={ASSET_CLASSES.map((c) => ({ value: c, label: m.assetClasses[c] }))}
            value={value.assetClass}
            onChange={(e) => onChange({ ...value, assetClass: e.target.value })}
            error={errors[`${errorKey}.assetClass`]}
          />
        </div>
      ) : null}
    </div>
  );
}
