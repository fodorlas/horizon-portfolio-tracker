/**
 * Number, money and date formatting in the UI language (spec 2026-10-01 §2.4).
 * Decimals are passed to Intl as strings, so no precision is lost on the way
 * to the screen.
 */
import type { Dec } from "./finance/money";
import type { Locale } from "./prefs-shared";

const MINUS = "−"; // typographic minus

/** The Intl locale of each UI language. */
const INTL: Record<Locale, string> = { hu: "hu-HU", en: "en-GB" };

/** The formatters' words, from the dictionary (messages.format). */
export type FormatWords = { today: string; greetings: { morning: string; day: string; evening: string; night: string } };

export type Formatters = {
  /** "48 215 300 Ft", "12 450,50 USD". */
  money(value: Dec, currency: string, decimals?: number): string;
  /** A unit price: up to four decimals when it has them ("1,0123 Ft", an ÁKK price per 1 Ft face value), never fewer than the currency's (#76). */
  price(value: Dec, currency: string): string;
  /** "▲ +312 400 Ft" / "▼ −1234 Ft" / "0 Ft" – the sign never relies on colour alone. */
  change(value: Dec, currency: string): { text: string; direction: "up" | "down" | "flat" };
  /** A rate such as 0.0065 → "+0,65%". */
  percent(rate: Dec, decimals?: number, signed?: boolean): string;
  /** Up to 10 decimals, trailing zeros dropped: "10", "0,025". */
  quantity(q: Dec): string;
  /** An FX rate: up to 4 decimals, "356,12" / "1,0831". */
  rate(r: Dec): string;
  /** "2026-09-26" → "2026. szept. 26." */
  day(day: string): string;
  /** "2026-09-27" → "2026. szept. 27., vasárnap" */
  longDay(day: string): string;
  /** "márc. 5." – short axis labels. */
  shortDay(day: string): string;
  /** A moment in Budapest time: "ma 14:02", or "szept. 26. 14:02" on another day. */
  moment(iso: string, now?: Date): string;
  /** Greeting for the Budapest hour of `now`. */
  greeting(now?: Date): string;
  /** A number for a form field: no grouping, the language's decimal separator ("1234,5" / "1234.5"). */
  typed(value: Dec | string): string;
};

/** Decimal places shown for a currency: forint has none in practice. */
export const moneyDecimals = (currency: string) => (currency === "HUF" ? 0 : 2);
const PRICE_DECIMALS = 4;

function fmt(f: Intl.NumberFormat, value: Dec, decimals: number): string {
  // Intl accepts decimal strings (ES2023): exact, no float detour.
  return f.format(value.toFixed(decimals) as unknown as number).replace(/-/g, MINUS);
}

const budapestDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" });
const budapestHour = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Budapest" });
const utcDay = (day: string) => new Date(`${day}T00:00:00Z`);

/** One language's formatters; build once per language (i18nFor does). */
export function formatters(locale: Locale, words: FormatWords): Formatters {
  const tag = INTL[locale];
  const numbers = new Map<string, Intl.NumberFormat>();
  const nf = (key: string, opts: Intl.NumberFormatOptions) => {
    let f = numbers.get(key);
    if (!f) numbers.set(key, (f = new Intl.NumberFormat(tag, opts)));
    return f;
  };
  const dayF = new Intl.DateTimeFormat(tag, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  const longDayF = new Intl.DateTimeFormat(tag, { year: "numeric", month: "short", day: "numeric", weekday: "long", timeZone: "UTC" });
  const shortDayF = new Intl.DateTimeFormat(tag, { month: "short", day: "numeric", timeZone: "UTC" });
  const dateTimeF = new Intl.DateTimeFormat(tag, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Budapest" });
  const timeF = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Budapest" });

  const money = (value: Dec, currency: string, decimals = moneyDecimals(currency)) =>
    fmt(nf(`m:${currency}:${decimals}`, { style: "currency", currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }), value, decimals);

  return {
    money,
    price(value, currency) {
      const min = moneyDecimals(currency);
      const max = Math.max(min, PRICE_DECIMALS);
      return fmt(nf(`pr:${currency}`, { style: "currency", currency, minimumFractionDigits: min, maximumFractionDigits: max }), value, max);
    },
    change(value, currency) {
      const rounded = value.toDecimalPlaces(moneyDecimals(currency));
      if (rounded.isZero()) return { text: money(rounded.abs(), currency), direction: "flat" };
      const up = rounded.gt(0);
      return { text: `${up ? "▲ +" : `▼ ${MINUS}`}${money(rounded.abs(), currency)}`, direction: up ? "up" : "down" };
    },
    percent(rate, decimals = 2, signed = true) {
      const f = nf(`p:${decimals}:${signed}`, { style: "percent", minimumFractionDigits: decimals, maximumFractionDigits: decimals, signDisplay: signed ? "exceptZero" : "auto" });
      return fmt(f, rate, decimals + 2);
    },
    quantity: (q) => fmt(nf("q", { maximumFractionDigits: 10 }), q, 10),
    rate: (r) => fmt(nf("r", { minimumFractionDigits: 2, maximumFractionDigits: 4 }), r, 4),
    day: (day) => dayF.format(utcDay(day)),
    longDay: (day) => longDayF.format(utcDay(day)),
    shortDay: (day) => shortDayF.format(utcDay(day)),
    moment(iso, now = new Date()) {
      const d = new Date(iso);
      return budapestDay.format(d) === budapestDay.format(now) ? `${words.today} ${timeF.format(d)}` : dateTimeF.format(d);
    },
    greeting(now = new Date()) {
      const hour = Number(budapestHour.format(now));
      if (hour >= 5 && hour < 10) return words.greetings.morning;
      if (hour >= 10 && hour < 18) return words.greetings.day;
      if (hour >= 18 && hour < 22) return words.greetings.evening;
      return words.greetings.night;
    },
    typed(value) {
      const s = typeof value === "string" ? value : value.toFixed();
      return locale === "hu" ? s.replace(".", ",") : s;
    },
  };
}
