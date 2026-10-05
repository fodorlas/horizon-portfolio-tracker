import type { LedgerEvent, Line } from "@/lib/finance/ledger";
import type { I18n } from "@/lib/i18n";

const sign = (negative: boolean, text: string) => (negative ? text.replace(/^−?/, "−") : `+${text}`);

// Units first, then the money in a natural reading order; fees and taxes last.
const ROLE_ORDER = ["trade", "split", "opening", "transfer", "correction", "fx", "income", "external", "fee", "tax"];
const rank = (l: Line) => (l.kind === "position" ? 0 : 1) * 100 + ROLE_ORDER.indexOf(l.role) * 2 + (l.amount.isNegative() ? 0 : 1);

/**
 * The lines of one event in a compact, readable form: "+10 db · −1 005,00 USD · díj: −1,00 USD".
 * Manual-valued items (`manual`) count units only internally: an acquisition
 * shows its cost, a disposal nothing (its money line says it).
 */
export function EventLines({ event, manual, i18n }: { event: LedgerEvent; manual?: ReadonlySet<string>; i18n: I18n }) {
  const { m, fill, f } = i18n;
  const roles = m.transactions.roles as Record<string, string>;
  const internal = (l: Line) => l.kind === "position" && l.instrumentId !== null && manual?.has(l.instrumentId) === true;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
      {[...event.lines].filter((l) => !internal(l) || l.costAmount !== null).sort((a, b) => rank(a) - rank(b)).map((l) => {
        const neg = l.amount.isNegative();
        const text = internal(l)
          ? sign(false, f.money(l.costAmount!, l.currency))
          : l.kind === "position"
            ? fill(m.transactions.unitsSigned, { qty: sign(neg, f.quantity(l.amount.abs())) })
            : sign(neg, f.money(l.amount.abs(), l.currency));
        const role = roles[l.role];
        return (
          <li key={l.id} className="amount whitespace-nowrap">
            {role ? <span className="text-text-muted">{role}: </span> : null}
            {text}
          </li>
        );
      })}
    </ul>
  );
}

/** Instrument(s) an event concerns, for list columns. */
export function eventInstruments(event: LedgerEvent): string[] {
  return [...new Set(event.lines.map((l) => l.instrumentId).filter((x): x is string => x !== null))];
}

/** The instruments' names for a list; a transaction that moves money only (a deposit, a fee, an exchange) is "Készpénz". */
export function eventInstrumentNames(event: LedgerEvent, names: ReadonlyMap<string, string>, i18n: I18n): string {
  const ids = eventInstruments(event);
  return ids.length ? ids.map((i) => names.get(i)).join(", ") : i18n.m.assetClasses.cash;
}

export function eventAccounts(event: LedgerEvent): string[] {
  return [...new Set(event.lines.map((l) => l.accountId))];
}
