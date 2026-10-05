/**
 * Input schemas for the simple forms (plan: Zod at the edges). Error messages
 * are keys of messages.errors. Amounts stay decimal strings.
 */
import { z } from "zod";
import { isCurrency, isDay } from "@/lib/finance/money";
import type { Locale } from "@/lib/prefs-shared";
import { parseDecimal } from "@/lib/tx/parse";

export const text = (max: number) => z.string({ error: "required" }).trim().min(1, "required").max(max, "tooLong");
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "tooLong")
    .optional()
    .transform((v) => (v ? v : null));
export const id = z.uuid({ error: "unknown" });
export const currency = z
  .string({ error: "required" })
  .trim()
  .toUpperCase()
  .refine(isCurrency, "currency");

/** A calendar day, not after `today`. */
export const pastDay = (today: string) =>
  z
    .string({ error: "required" })
    .refine((v) => v.length > 0, "required")
    .refine(isDay, "date")
    .refine((v) => v <= today, "future");

/** A decimal typed in the form's language, as a canonical string (spec 2026-10-01 §2.5). */
export const decimal = (opts: { positive?: boolean; nonNegative?: boolean }, locale: Locale) =>
  z.string({ error: "required" }).transform((raw, ctx) => {
    if (!raw.trim()) {
      ctx.addIssue({ code: "custom", message: "required" });
      return z.NEVER;
    }
    const p = parseDecimal(raw, locale);
    if (!p.ok) {
      ctx.addIssue({ code: "custom", message: p.error });
      return z.NEVER;
    }
    if (opts.positive && p.value.lte(0)) ctx.addIssue({ code: "custom", message: "positive" });
    if (opts.nonNegative && p.value.lt(0)) ctx.addIssue({ code: "custom", message: "nonNegative" });
    return p.value.toFixed();
  });

export const ACCOUNT_TYPES = ["normal", "tbsz", "nyesz"] as const;
export const ASSET_CLASSES = ["stock", "etf", "fund", "bond", "managed", "other"] as const;
export const PRICE_SOURCES = ["manual", "yahoo", "bet", "finnhub", "akk", "bamosz"] as const;
/**
 * What the Instruments page can set up. An ÁKK paper comes from the entry form (with its
 * terms); Finnhub and BAMOSZ have no fetcher, so choosing them would leave the price manual.
 */
export const SETTABLE_PRICE_SOURCES = ["manual", "yahoo", "bet"] as const;
const settable = (s: string) => (SETTABLE_PRICE_SOURCES as readonly string[]).includes(s);
/** The page's choices: the settable sources, and the one the instrument already has. */
export const priceSourceChoices = (current?: string | null): string[] =>
  current && !settable(current) ? [...SETTABLE_PRICE_SOURCES, current] : [...SETTABLE_PRICE_SOURCES];
/** A source the page may save: a settable one, or the instrument's own (null for a new one). */
export const allowedPriceSource = (next: string, current: string | null): boolean => settable(next) || next === current;

export const institutionSchema = z.object({ name: text(100) });

export const accountSchema = (today: string) =>
  z.object({
    institutionId: id,
    name: text(100),
    accountType: z.enum(ACCOUNT_TYPES, { error: "unknown" }),
    trackingStart: pastDay(today),
  });

export const instrumentSchema = z.object({
  name: text(120),
  assetClass: z.enum(ASSET_CLASSES, { error: "unknown" }),
  currency,
  ticker: optionalText(32),
  isin: optionalText(12)
    .transform((v) => v?.toUpperCase() ?? null)
    .refine((v) => v === null || /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(v), "isin"),
  exchange: optionalText(32),
  valuation: z.enum(["market", "manual"], { error: "unknown" }),
  priceSource: z.enum(PRICE_SOURCES, { error: "unknown" }),
  providerSymbol: optionalText(64),
  staleAfterDays: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        ctx.addIssue({ code: "custom", message: "number" });
        return z.NEVER;
      }
      return n;
    }),
  })
  // The refresh prices a Yahoo or BÉT instrument by its symbol or code: without one it would silently stay unpriced.
  .refine((v) => !(v.valuation === "market" && (v.priceSource === "yahoo" || v.priceSource === "bet") && !v.providerSymbol), { path: ["providerSymbol"], message: "symbolRequired" })
  // A BÉT code as the BÉT writes it, so it shows and matches the search hit: "otp.bd" (the Yahoo form) is OTP.
  .transform((v) => (v.priceSource === "bet" && v.providerSymbol ? { ...v, providerSymbol: v.providerSymbol.toUpperCase().replace(/\s/g, "").replace(/\.BD$/, "") } : v));

const note = (required: boolean) =>
  required ? z.string({ error: "noteRequired" }).trim().min(1, "noteRequired").max(500, "noteTooLong") : optionalText(500);

export const priceSchema = (today: string, locale: Locale) =>
  z.object({ instrumentId: id, day: pastDay(today), price: decimal({ positive: true }, locale), note: note(true) });

export const fxSchema = (today: string, locale: Locale) =>
  z
    .object({ base: currency, quote: currency, day: pastDay(today), rate: decimal({ positive: true }, locale), note: note(true) })
    .refine((v) => v.base !== v.quote, { path: ["quote"], message: "sameCurrency" });

export const valuationSchema = (today: string, locale: Locale) =>
  z.object({ accountId: id, instrumentId: id, day: pastDay(today), value: decimal({ nonNegative: true }, locale), note: note(false) });

/** A correction replaces one row; only the number and the reason are new. */
export const supersedeSchema = (locale: Locale) => z.object({ supersedesId: id, amount: decimal({ positive: true }, locale), note: note(true) });
export const supersedeValuationSchema = (locale: Locale) => z.object({ supersedesId: id, amount: decimal({ nonNegative: true }, locale), note: note(true) });

/** The project's password rules (supabase/config.toml): ≥ 12, lower + upper + digit; bcrypt reads 72 bytes. */
export const passwordSchema = z
  .object({
    password: z
      .string({ error: "required" })
      .min(12, "passwordShort")
      .refine((v) => new TextEncoder().encode(v).length <= 72, "passwordLong")
      .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), "passwordRules"),
    confirm: z.string({ error: "required" }),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "passwordMismatch" });
