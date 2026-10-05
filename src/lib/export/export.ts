/**
 * Manual export (plan §6): everything as JSON, and CSV for spreadsheets.
 * Amounts stay exact decimal strings. CSV: comma separator, dot decimals,
 * CRLF (RFC 4180); text cells that a spreadsheet would run as a formula are
 * prefixed with an apostrophe (CSV injection). The UTF-8 BOM is added as bytes
 * by the download itself (a leading U+FEFF does not survive the RSC transport).
 */
import type { Loaded } from "@/lib/data/load";
import type { Dec } from "@/lib/finance/money";
import type { Names } from "@/lib/views/names";
import type { PositionsModel } from "@/lib/views/portfolio";

export const EXPORT_VERSION = 1;

type Cell = string | Dec | number | boolean | null | undefined;

const isDec = (v: unknown): v is Dec => typeof v === "object" && v !== null && "toFixed" in v;

function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (isDec(v)) s = v.toFixed();
  else if (typeof v === "number" || typeof v === "boolean") s = String(v);
  else s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

function omitOwner<T extends { owner_id?: string }>(row: T): Omit<T, "owner_id"> {
  const rest: Partial<T> = { ...row };
  delete rest.owner_id;
  return rest as Omit<T, "owner_id">;
}

export function exportJson(data: Loaded, exportedAt: string): string {
  const doc = {
    format: "horizon-export",
    version: EXPORT_VERSION,
    exportedAt,
    notice: "Portfolio-analysis estimates, not tax figures. Amounts are exact decimal strings.",
    institutions: data.institutions.map(omitOwner),
    accounts: data.accountMeta.map(omitOwner),
    instruments: data.instrumentMeta.map(omitOwner),
    events: data.events.map((e) => ({
      id: e.id,
      type: e.type,
      date: e.date,
      createdAt: e.createdAt,
      correctionKind: e.correctionKind,
      splitRatio: e.splitRatio?.toFixed() ?? null,
      note: e.note,
      lines: e.lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        accountId: l.accountId,
        instrumentId: l.instrumentId,
        currency: l.currency,
        amount: l.amount.toFixed(),
        role: l.role,
        costAmount: l.costAmount?.toFixed() ?? null,
        costEstimated: l.costEstimated,
        costFxRefs: l.costFxRefs,
      })),
    })),
    priceQuotes: data.logs.quotes.map(omitOwner),
    manualValuations: data.logs.valuations.map(omitOwner),
    fxRates: data.logs.fx,
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

export function transactionsCsv(data: Pick<Loaded, "events">, names: Names, typeLabel: (t: string) => string): string {
  const header = [
    "date", "event_id", "type", "type_label", "correction_kind", "split_ratio", "note", "account_id", "account",
    "instrument_id", "instrument", "line_kind", "role", "currency", "amount", "cost_amount", "cost_estimated",
  ];
  const events = [...data.events].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const rows = events.flatMap((e) =>
    e.lines.map((l): Cell[] => [
      e.date, e.id, e.type, typeLabel(e.type), e.correctionKind, e.splitRatio, e.note, l.accountId, names.account.get(l.accountId),
      l.instrumentId, l.instrumentId ? names.instrument.get(l.instrumentId) : null, l.kind, l.role, l.currency, l.amount, l.costAmount,
      l.costAmount === null ? null : l.costEstimated,
    ]),
  );
  return toCsv(header, rows);
}

export function positionsCsv(model: PositionsModel, names: Names): string {
  const header = [
    "account_id", "account", "instrument_id", "instrument", "kind", "quantity", "currency", "price", "value_source", "value_as_of",
    "value", "value_display", "display_currency", "cost", "cost_estimated", "unrealized", "realized", "income_net",
  ];
  const rows: Cell[][] = [
    ...model.positions.map((p): Cell[] => [
      p.accountId, names.account.get(p.accountId), p.instrumentId, names.instrument.get(p.instrumentId), "position", p.quantity, p.currency,
      p.price, p.valueSource, p.valueAsOf, p.native, p.display, model.currency, p.cost, p.costEstimated, p.unrealized, p.realized, p.incomeNet,
    ]),
    ...model.cash.map((c): Cell[] => [
      c.accountId, names.account.get(c.accountId), null, null, "cash", null, c.currency, null, null, model.today, c.amount, c.display,
      model.currency, null, null, null, null, null,
    ]),
  ];
  return toCsv(header, rows);
}
