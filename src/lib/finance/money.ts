/**
 * Money primitives. Amounts are decimal.js values, never JS floats.
 * A calendar day is a Europe/Budapest date written as "YYYY-MM-DD".
 */
import Decimal from "decimal.js";

// 34 significant digits (IEEE 754 decimal128), plenty for numeric(28,10) inputs.
export const D = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });
export type Dec = InstanceType<typeof D>;

export type Currency = string; // ISO 4217, validated at the edges
export const DISPLAY_CURRENCIES = ["HUF", "EUR", "USD"] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export type Money = { amount: Dec; currency: Currency };

export const dec = (v: Decimal.Value) => new D(v);
export const ZERO = new D(0);

export function money(amount: Decimal.Value, currency: Currency): Money {
  return { amount: new D(amount), currency };
}

export function isCurrency(v: string): boolean {
  return /^[A-Z]{3}$/.test(v);
}

/** Calendar-day arithmetic on "YYYY-MM-DD" strings (UTC-based, no DST issues). */
export type Day = string;

export function isDay(v: string): v is Day {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export function addDays(day: Day, n: number): Day {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: Day, b: Day): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Monday–Friday. Public holidays are ignored: this only drives staleness hints. */
export function isWeekday(day: Day): boolean {
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  return wd !== 0 && wd !== 6;
}

/** Weekdays strictly after `from` up to and including `to`. */
export function businessDaysBetween(from: Day, to: Day): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWeekday(d)) n++;
  return n;
}

/** Today's calendar day in Budapest. */
// Made once: building a formatter is far dearer than using it, and every price row's day comes through here.
const BUDAPEST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" });

export function todayInBudapest(now: Date = new Date()): Day {
  return BUDAPEST_DAY.format(now);
}
