import { describe, expect, it } from "vitest";
import { accountSchema, allowedPriceSource, fxSchema, instrumentSchema, passwordSchema, priceSchema, priceSourceChoices, supersedeSchema, valuationSchema } from "./schemas";

const TODAY = "2026-09-26";
const ID = "3f0e8a8e-6d2a-4a57-9b7e-2f1c0d6f9a11";
const codes = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));

describe("form schemas", () => {
  it("account: tracking start is a real day, not in the future", () => {
    expect(accountSchema(TODAY).safeParse({ institutionId: ID, name: "IBKR", accountType: "normal", trackingStart: "2026-01-01" }).success).toBe(true);
    expect(codes(accountSchema(TODAY).safeParse({ institutionId: "x", name: " ", accountType: "gold", trackingStart: "2026-09-27" }))).toEqual({
      institutionId: "unknown",
      name: "required",
      accountType: "unknown",
      trackingStart: "future",
    });
  });

  it("instrument: currency upper-cased, ISIN checked, empty optionals become null", () => {
    const r = instrumentSchema.safeParse({ name: "OTP", assetClass: "stock", currency: "huf", isin: "hu0000061726", ticker: "", valuation: "market", priceSource: "manual", staleAfterDays: "" });
    expect(r.success && r.data).toMatchObject({ currency: "HUF", isin: "HU0000061726", ticker: null, staleAfterDays: null });
    expect(codes(instrumentSchema.safeParse({ name: "X", assetClass: "stock", currency: "EURO", isin: "HU123", valuation: "market", priceSource: "manual", staleAfterDays: "0" }))).toEqual({
      currency: "currency",
      isin: "isin",
      staleAfterDays: "number",
    });
  });

  it("instrument: a Yahoo-priced one needs its symbol", () => {
    const base = { name: "VWCE", assetClass: "etf", currency: "EUR", valuation: "market", priceSource: "yahoo", staleAfterDays: "" };
    expect(codes(instrumentSchema.safeParse({ ...base, providerSymbol: "" }))).toEqual({ providerSymbol: "symbolRequired" });
    expect(instrumentSchema.safeParse({ ...base, providerSymbol: "VWCE.DE" }).success).toBe(true);
    expect(instrumentSchema.safeParse({ ...base, valuation: "manual", providerSymbol: "" }).success).toBe(true);
  });

  it("instrument: a BÉT-priced one needs its BÉT code", () => {
    const base = { name: "CETOP", assetClass: "etf", currency: "EUR", valuation: "market", priceSource: "bet", staleAfterDays: "" };
    expect(codes(instrumentSchema.safeParse({ ...base, providerSymbol: "" }))).toEqual({ providerSymbol: "symbolRequired" });
    expect(instrumentSchema.safeParse({ ...base, providerSymbol: "ETFCETOPOTP" }).success).toBe(true);
  });

  it("instrument: the page offers only sources it can set up, and keeps the one an instrument already has (#38)", () => {
    expect(priceSourceChoices()).toEqual(["manual", "yahoo", "bet"]);
    expect(priceSourceChoices("yahoo")).toEqual(["manual", "yahoo", "bet"]);
    // An ÁKK paper (made by the entry form) and an old Finnhub/BAMOSZ one keep their own.
    expect(priceSourceChoices("akk")).toEqual(["manual", "yahoo", "bet", "akk"]);
    expect(priceSourceChoices("bamosz")).toEqual(["manual", "yahoo", "bet", "bamosz"]);
    expect(allowedPriceSource("bet", null)).toBe(true);
    expect(allowedPriceSource("finnhub", null)).toBe(false);
    expect(allowedPriceSource("bamosz", "yahoo")).toBe(false);
    expect(allowedPriceSource("akk", "manual")).toBe(false);
    expect(allowedPriceSource("akk", "akk")).toBe(true);
  });

  it("instrument: a BÉT code is kept as the BÉT writes it (capitals, no spaces, no Yahoo .BD ending)", () => {
    const base = { name: "CETOP", assetClass: "etf", currency: "EUR", valuation: "market", priceSource: "bet", staleAfterDays: "" };
    const code = (providerSymbol: string) => {
      const r = instrumentSchema.safeParse({ ...base, providerSymbol });
      return r.success ? r.data.providerSymbol : null;
    };
    expect(code(" etfcetopotp ")).toBe("ETFCETOPOTP");
    expect(code("otp.bd")).toBe("OTP");
    expect(code("ETFC ETOP OTP")).toBe("ETFCETOPOTP");
    // A Yahoo symbol stays as typed.
    expect(instrumentSchema.safeParse({ ...base, priceSource: "yahoo", providerSymbol: "otp.bd" }).data?.providerSymbol).toBe("otp.bd");
  });

  it("manual price: Hungarian decimal, positive, a reason is required", () => {
    const r = priceSchema(TODAY, "hu").safeParse({ instrumentId: ID, day: "2026-09-25", price: "1 234,5", note: "Bróker kivonat" });
    expect(r.success && r.data.price).toBe("1234.5");
    expect(codes(priceSchema(TODAY, "hu").safeParse({ instrumentId: ID, day: "2026-09-25", price: "0", note: "" }))).toEqual({ price: "positive", note: "noteRequired" });
  });

  it("manual FX rate: two different currencies", () => {
    expect(codes(fxSchema(TODAY, "hu").safeParse({ base: "EUR", quote: "eur", day: "2026-09-25", rate: "1", note: "x" }))).toEqual({ quote: "sameCurrency" });
  });

  it("manual value may be zero; a correction needs a reason", () => {
    expect(valuationSchema(TODAY, "hu").safeParse({ accountId: ID, instrumentId: ID, day: "2026-09-25", value: "0" }).success).toBe(true);
    expect(codes(supersedeSchema("hu").safeParse({ supersedesId: ID, amount: "abc", note: " " }))).toEqual({ amount: "number", note: "noteRequired" });
  });

  it("password: the project's rules, and the two entries must match", () => {
    const pw = (password: string, confirm = password) => codes(passwordSchema.safeParse({ password, confirm }));
    expect(pw("Aa1aaaaaaaaa")).toEqual({});
    expect(pw("Aa1aaaaaaaa")).toEqual({ password: "passwordShort" });
    expect(pw("aaaaaaaaaaa1")).toEqual({ password: "passwordRules" });
    expect(pw("Aa1" + "ő".repeat(35))).toEqual({ password: "passwordLong" }); // 73 bytes
    expect(pw("Aa1aaaaaaaaa", "Aa1aaaaaaaab")).toEqual({ confirm: "passwordMismatch" });
  });
});
