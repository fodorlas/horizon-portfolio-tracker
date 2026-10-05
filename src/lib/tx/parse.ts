/**
 * Parsing user input the Hungarian way: "1 234,56" and "1234.56" both mean
 * 1234.56; in English the point is the decimal separator (spec 2026-10-01 §2.5).
 * Amounts become decimals straight from the text, never via floats.
 */
import { TZDate } from "@date-fns/tz";
import { D, type Day, type Dec, isDay } from "@/lib/finance/money";
import type { Locale } from "@/lib/prefs-shared";

/** numeric(28,10): 18 integer and 10 fractional digits. */
const MAX_INT_DIGITS = 18;
export const MAX_DECIMALS = 10;

export type ParsedNumber = { ok: true; value: Dec } | { ok: false; error: "number" | "decimals" | "ambiguous" };

/**
 * "1,234.56" in English: commas only as thousands groups, the first group not led by 0 ("0,025" is a
 * Hungarian-habit decimal, not 25); anything else is refused, never read as another number (spec 2026-10-01 §2.5).
 */
const EN_GROUPED = /^-?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/;
/** "389,125": one comma group and no point is 389.125 by Hungarian habit, so it is refused as ambiguous (owner, 2026-10-01). */
const EN_ONE_GROUP = /^-?\d{1,3},\d{3}$/;

export function parseDecimal(raw: string, locale: Locale = "hu"): ParsedNumber {
  // Spaces of any kind are digit-group separators.
  let s = raw.replace(/[\s  ]/g, "").replace(/[−–]/g, "-");
  if (locale === "en") {
    if (s.includes(",")) {
      if (!EN_GROUPED.test(s)) return { ok: false, error: "number" };
      if (EN_ONE_GROUP.test(s)) return { ok: false, error: "ambiguous" };
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    // With both separators, the comma is the decimal one ("1.234,5").
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return { ok: false, error: "number" };
  if (m[2].replace(/^0+/, "").length > MAX_INT_DIGITS) return { ok: false, error: "number" };
  if ((m[3]?.length ?? 0) > MAX_DECIMALS) return { ok: false, error: "decimals" };
  return { ok: true, value: new D(s) };
}

/** Last moment of a Budapest calendar day, as an ISO timestamp (manual prices "as of" a day). */
export function endOfDayBudapest(day: Day): string {
  if (!isDay(day)) throw new Error(`Not a day: ${day}`);
  const [y, m, d] = day.split("-").map(Number);
  return new Date(new TZDate(y, m - 1, d, 23, 59, 59, "Europe/Budapest").getTime()).toISOString();
}
