import { describe, expect, it } from "vitest";
import type { FxRow } from "@/lib/finance/fx";
import { D, type Dec } from "@/lib/finance/money";
import { type BuildContext, buildTransaction, type TxInput, type TxPayload } from "./build";
import { endOfDayBudapest, parseDecimal } from "./parse";

const fxRow = (id: string, base: string, quote: string, rate: string, rateDate = "2026-02-02"): FxRow => ({
  id, base, quote, rate, rateDate, source: "MNB", status: "ok", supersedesId: null, fetchedAt: "2026-02-02T12:00:00Z",
});

const holdings = new Map<string, Dec>([["A|US", new D(10)]]);

const ctx: BuildContext = {
  today: "2026-09-26",
  locale: "hu",
  accounts: new Map([
    ["A", { trackingStart: "2026-01-01" }],
    ["B", { trackingStart: "2026-03-01" }],
  ]),
  instruments: new Map([
    ["US", { currency: "USD", valuation: "market" as const }],
    ["HU", { currency: "HUF", valuation: "market" as const }],
    ["BOND", { currency: "HUF", valuation: "manual" as const }],
    ["MAPP", { currency: "HUF", valuation: "market" as const, priceSource: "akk" }],
  ]),
  fxRows: [fxRow("usdhuf", "USD", "HUF", "350"), fxRow("eurhuf", "EUR", "HUF", "400")],
  holding: (a, i) => holdings.get(`${a}|${i}`) ?? new D(0),
  priceOn: (i) => (i === "US" ? new D("120") : null),
};

function ok(input: TxInput): TxPayload {
  const r = buildTransaction(input, ctx);
  if (!r.ok) throw new Error(`unexpected errors: ${JSON.stringify(r.errors)}`);
  return r.payload;
}
function errors(input: TxInput) {
  const r = buildTransaction(input, ctx);
  if (r.ok) throw new Error("expected errors");
  return r.errors;
}
const brief = (p: TxPayload) => p.lines.map((l) => [l.kind, l.accountId, l.instrumentId, l.currency, l.amount, l.role, l.costAmount, l.costEstimated]);

describe("parseDecimal", () => {
  it.each([
    ["1234.5", "1234.5"],
    ["1 234,5", "1234.5"],
    ["1 234,50", "1234.5"],
    ["1.234,5", "1234.5"],
    ["0,0000000001", "1e-10"],
    ["−12", "-12"],
  ])("%s → %s", (raw, expected) => {
    const p = parseDecimal(raw);
    expect(p.ok && p.value.toString()).toBe(expected);
  });

  it.each([
    ["abc", "number"],
    ["1,2,3", "number"],
    ["", "number"],
    ["1e5", "number"],
    ["0,00000000001", "decimals"],
    ["1234567890123456789", "number"],
  ])("%s is refused (%s)", (raw, error) => {
    expect(parseDecimal(raw)).toEqual({ ok: false, error });
  });
});

describe("endOfDayBudapest", () => {
  it("follows winter and summer time", () => {
    expect(endOfDayBudapest("2026-03-01")).toBe("2026-03-01T22:59:59.000Z");
    expect(endOfDayBudapest("2026-07-01")).toBe("2026-07-01T21:59:59.000Z");
  });
});

describe("buy", () => {
  const base = { type: "buy", date: "2026-02-02", accountId: "A", instrumentId: "US", quantity: "10", price: "100,5" };

  it("the fee is part of the cost; FX refs for HUF, EUR and USD are stored", () => {
    const p = ok({ ...base, fee: "1" });
    expect(brief(p)).toEqual([
      ["position", "A", "US", "USD", "10", "trade", "1006", false],
      ["cash", "A", null, "USD", "-1005", "trade", null, false],
      ["cash", "A", null, "USD", "-1", "fee", null, false],
    ]);
    // HUF direct, EUR as a cross through HUF (both MNB legs), USD needs none.
    expect(p.lines[0].costFxRefs).toEqual({ HUF: ["usdhuf"], EUR: ["usdhuf", "eurhuf"], USD: [] });
  });

  it("a fee in another currency is converted with select_fx on the trade day", () => {
    const p = ok({ ...base, fee: "700", feeCurrency: "HUF" });
    // 700 HUF ÷ 350 = 2 USD
    expect(p.lines[0].costAmount).toBe("1007");
    expect(p.lines[0].costFxRefs?.fee).toEqual(["usdhuf"]);
    expect(p.lines[2]).toMatchObject({ currency: "HUF", amount: "-700", role: "fee" });
  });

  it("without a rate for the fee nothing is guessed", () => {
    expect(errors({ ...base, fee: "5", feeCurrency: "GBP" })).toEqual({ fee: "noFxFee" });
  });

  it("an exact total replaces quantity × price", () => {
    const p = ok({ ...base, price: "", total: "1004,99" });
    expect(p.lines[1].amount).toBe("-1004.99");
    expect(p.lines[0].costAmount).toBe("1004.99");
  });

  it("price or total is required", () => {
    expect(errors({ ...base, price: "" })).toEqual({ price: "required" });
  });
});

describe("sell", () => {
  it("cannot sell more than held", () => {
    expect(errors({ type: "sell", date: "2026-02-10", accountId: "A", instrumentId: "US", quantity: "11", price: "1" })).toEqual({ quantity: "insufficient" });
  });
  it("records units out, cash in and the fee", () => {
    const p = ok({ type: "sell", date: "2026-02-10", accountId: "A", instrumentId: "US", quantity: "4", price: "120", fee: "2" });
    expect(brief(p)).toEqual([
      ["position", "A", "US", "USD", "-4", "trade", null, false],
      ["cash", "A", null, "USD", "480", "trade", null, false],
      ["cash", "A", null, "USD", "-2", "fee", null, false],
    ]);
  });
});

describe("income", () => {
  it("dividend: gross income naming the payer, tax apart", () => {
    const p = ok({ type: "dividend", date: "2026-02-15", accountId: "A", instrumentId: "US", gross: "10", tax: "1,5" });
    expect(brief(p)).toEqual([
      ["cash", "A", "US", "USD", "10", "income", null, false],
      ["cash", "A", null, "USD", "-1.5", "tax", null, false],
    ]);
  });
  it("interest has no payer instrument", () => {
    const p = ok({ type: "interest", date: "2026-02-15", accountId: "A", currency: "HUF", gross: "120" });
    expect(brief(p)).toEqual([["cash", "A", null, "HUF", "120", "income", null, false]]);
  });
  it("a government security's cash interest names the paper, in its currency, so its proposal counts as recorded", () => {
    const p = ok({ type: "interest", date: "2026-08-26", accountId: "A", instrumentId: "MAPP", currency: "EUR", gross: "7 500" });
    expect(brief(p)).toEqual([["cash", "A", "MAPP", "HUF", "7500", "income", null, false]]);
    expect(errors({ type: "interest", date: "2026-08-26", accountId: "A", instrumentId: "HU", currency: "HUF", gross: "10" }).instrumentId).toBe("unknown");
  });
  it("dividend reinvestment: the new units cost what was reinvested (gross − tax by default)", () => {
    const p = ok({ type: "dividend_reinvest", date: "2026-02-16", accountId: "A", instrumentId: "US", gross: "10", tax: "1.5", quantity: "0,07" });
    expect(brief(p)).toEqual([
      ["cash", "A", "US", "USD", "10", "income", null, false],
      ["cash", "A", null, "USD", "-1.5", "tax", null, false],
      ["cash", "A", null, "USD", "-8.5", "trade", null, false],
      ["position", "A", "US", "USD", "0.07", "trade", "8.5", false],
    ]);
  });
});

describe("interest_reinvest (Kamatjóváírás, állampapír)", () => {
  it("a MÁP Plusz interest in papers: 1 Ft nominal per forint, at its own cost", () => {
    const p = ok({ type: "interest_reinvest", date: "2026-09-25", accountId: "A", instrumentId: "MAPP", gross: "61 100" });
    expect(brief(p)).toEqual([
      ["cash", "A", "MAPP", "HUF", "61100", "income", null, false],
      ["cash", "A", null, "HUF", "-61100", "trade", null, false],
      ["position", "A", "MAPP", "HUF", "61100", "trade", "61100", false],
    ]);
  });

  it("only for ÁKK papers; a maturity is never typed here", () => {
    expect(errors({ type: "interest_reinvest", date: "2026-09-25", accountId: "A", instrumentId: "HU", gross: "10" }).instrumentId).toBe("unknown");
    expect(errors({ type: "maturity", date: "2026-09-25", accountId: "A" }).type).toBe("unknown");
  });
});

describe("split", () => {
  it("1 → 4 on 10 units adds 30; the ratio is stored", () => {
    const p = ok({ type: "split", date: "2026-02-20", accountId: "A", instrumentId: "US", ratioFrom: "1", ratioTo: "4" });
    expect(p.event.splitRatio).toBe("4");
    expect(brief(p)).toEqual([["position", "A", "US", "USD", "30", "split", null, false]]);
  });
  it("a reverse split removes units", () => {
    const p = ok({ type: "split", date: "2026-02-20", accountId: "A", instrumentId: "US", ratioFrom: "5", ratioTo: "1" });
    expect(p.event.splitRatio).toBe("0.2");
    expect(p.lines[0].amount).toBe("-8");
  });
  it("needs a holding and a real ratio", () => {
    expect(errors({ type: "split", date: "2026-02-20", accountId: "B", instrumentId: "US", ratioFrom: "1", ratioTo: "2" })).toEqual({ instrumentId: "noHolding" });
    expect(errors({ type: "split", date: "2026-02-20", accountId: "A", instrumentId: "US", ratioFrom: "3", ratioTo: "3" })).toEqual({ ratioTo: "ratio" });
  });
});

describe("FX exchange", () => {
  it("sold and bought currency on one account, fee in the sold currency by default", () => {
    const p = ok({ type: "fx_exchange", date: "2026-02-21", accountId: "A", fromCurrency: "HUF", fromAmount: "400 000", toCurrency: "EUR", toAmount: "1000", fee: "500" });
    expect(brief(p)).toEqual([
      ["cash", "A", null, "HUF", "-400000", "fx", null, false],
      ["cash", "A", null, "EUR", "1000", "fx", null, false],
      ["cash", "A", null, "HUF", "-500", "fee", null, false],
    ]);
  });
  it("the two currencies must differ", () => {
    expect(errors({ type: "fx_exchange", date: "2026-02-21", accountId: "A", fromCurrency: "EUR", fromAmount: "1", toCurrency: "EUR", toAmount: "1" })).toEqual({ toCurrency: "sameCurrency" });
  });
});

describe("cash events", () => {
  const p = (type: string) => ok({ type, date: "2026-01-05", accountId: "A", currency: "huf", amount: "5000" }).lines[0];
  it("deposit +, withdrawal −, fee − (currency upper-cased)", () => {
    expect(p("deposit")).toMatchObject({ currency: "HUF", amount: "5000", role: "external" });
    expect(p("withdrawal")).toMatchObject({ amount: "-5000", role: "external" });
    expect(p("fee")).toMatchObject({ amount: "-5000", role: "fee" });
  });
});

describe("transfer", () => {
  it("moves cash or units between two own accounts", () => {
    const c = ok({ type: "transfer", date: "2026-04-01", accountId: "A", toAccountId: "B", asset: "cash", currency: "EUR", amount: "100" });
    expect(brief(c)).toEqual([
      ["cash", "A", null, "EUR", "-100", "transfer", null, false],
      ["cash", "B", null, "EUR", "100", "transfer", null, false],
    ]);
    const u = ok({ type: "transfer", date: "2026-04-01", accountId: "A", toAccountId: "B", asset: "position", instrumentId: "US", quantity: "3" });
    expect(brief(u)).toEqual([
      ["position", "A", "US", "USD", "-3", "transfer", null, false],
      ["position", "B", "US", "USD", "3", "transfer", null, false],
    ]);
  });
  it("not to the same account, not more than held", () => {
    expect(errors({ type: "transfer", date: "2026-04-01", accountId: "A", toAccountId: "A", asset: "cash", currency: "EUR", amount: "1" })).toEqual({ toAccountId: "sameAccount" });
    expect(errors({ type: "transfer", date: "2026-04-01", accountId: "A", toAccountId: "B", asset: "position", instrumentId: "US", quantity: "12" })).toEqual({ quantity: "insufficient" });
  });
});

describe("opening balance", () => {
  it("is always dated to the tracking start and brings the opening price", () => {
    const p = ok({ type: "opening_balance", date: "2026-09-01", accountId: "B", asset: "position", instrumentId: "US", quantity: "5", price: "200" });
    expect(p.event.date).toBe("2026-03-01");
    expect(brief(p)).toEqual([["position", "B", "US", "USD", "5", "opening", "1000", true]]);
    expect(p.extras.quotes).toEqual([
      { instrumentId: "US", price: "200", currency: "USD", asOf: "2026-03-01T22:59:59.000Z", note: "Nyitó ár (nyitó egyenleg)" },
    ]);
  });
  it("a known cost is kept and not marked estimated", () => {
    const p = ok({ type: "opening_balance", accountId: "B", asset: "position", instrumentId: "US", quantity: "5", price: "200", cost: "850" });
    expect(p.lines[0]).toMatchObject({ costAmount: "850", costEstimated: false });
  });
  it("a manually valued holding brings its value instead of a price", () => {
    const p = ok({ type: "opening_balance", accountId: "B", asset: "position", instrumentId: "BOND", quantity: "1", value: "250000" });
    expect(p.extras.valuations).toEqual([
      { accountId: "B", instrumentId: "BOND", value: "250000", currency: "HUF", asOf: "2026-03-01T22:59:59.000Z", note: "Nyitó érték (nyitó egyenleg)" },
    ]);
    expect(p.extras.quotes).toEqual([]);
  });
  it("the opening price is required for market-priced holdings", () => {
    expect(errors({ type: "opening_balance", accountId: "B", asset: "position", instrumentId: "US", quantity: "5" })).toEqual({ price: "required" });
  });
  it("cash opening", () => {
    expect(brief(ok({ type: "opening_balance", accountId: "A", asset: "cash", currency: "HUF", amount: "10000" }))).toEqual([
      ["cash", "A", null, "HUF", "10000", "opening", null, false],
    ]);
  });
});

describe("correction", () => {
  const base = { type: "correction", date: "2026-03-10", accountId: "A", note: "Egyeztetés a bróker kivonatával" };
  it("always needs a note", () => {
    expect(errors({ ...base, note: "", correctionKind: "missing_flow", direction: "in", currency: "HUF", amount: "1" })).toEqual({ note: "noteRequired" });
  });
  it("missing flow: an external flow with the chosen direction", () => {
    const p = ok({ ...base, correctionKind: "missing_flow", direction: "out", currency: "HUF", amount: "300" });
    expect(p.event.correctionKind).toBe("missing_flow");
    expect(brief(p)).toEqual([["cash", "A", null, "HUF", "-300", "external", null, false]]);
  });
  it("reconciliation of units in: cost is the day's market value, estimated", () => {
    const p = ok({ ...base, correctionKind: "reconciliation", direction: "in", asset: "position", instrumentId: "US", quantity: "2" });
    expect(brief(p)).toEqual([["position", "A", "US", "USD", "2", "correction", "240", true]]);
  });
  it("without a price for the day, one has to be given", () => {
    expect(errors({ ...base, correctionKind: "reconciliation", direction: "in", asset: "position", instrumentId: "HU", quantity: "2" })).toEqual({ price: "noPrice" });
  });
  it("reconciliation of units out has no cost", () => {
    const p = ok({ ...base, correctionKind: "reconciliation", direction: "out", asset: "position", instrumentId: "US", quantity: "2" });
    expect(brief(p)).toEqual([["position", "A", "US", "USD", "-2", "correction", null, false]]);
  });
});

describe("common checks", () => {
  const dep = { type: "deposit", accountId: "B", currency: "HUF", amount: "1" };
  it("the date: valid, not in the future, after the tracking start", () => {
    expect(errors({ ...dep, date: "2026-02-30" })).toEqual({ date: "date" });
    expect(errors({ ...dep, date: "2026-09-27" })).toEqual({ date: "future" });
    expect(errors({ ...dep, date: "2026-03-01" })).toEqual({ date: "beforeStart" });
  });
  it("unknown type, account or instrument", () => {
    expect(errors({ type: "gift" })).toEqual({ type: "unknown" });
    expect(errors({ ...dep, date: "2026-04-01", accountId: "X" })).toEqual({ accountId: "unknown" });
  });
  it("numbers: required, positive, parsed", () => {
    expect(errors({ ...dep, date: "2026-04-01", amount: "" })).toEqual({ amount: "required" });
    expect(errors({ ...dep, date: "2026-04-01", amount: "-5" })).toEqual({ amount: "positive" });
    expect(errors({ ...dep, date: "2026-04-01", amount: "öt" })).toEqual({ amount: "number" });
  });
  it("the note has a length limit", () => {
    expect(errors({ ...dep, date: "2026-04-01", note: "x".repeat(501) })).toEqual({ note: "noteTooLong" });
  });
});

describe("numbers in the form's language (spec 2026-10-01 §2.5)", () => {
  const english: BuildContext = { ...ctx, locale: "en" };
  const buy = { type: "buy", date: "2026-02-02", accountId: "A", instrumentId: "US", quantity: "10", price: "1,234.5" };

  it("English: point decimal, comma thousands", () => {
    const r = buildTransaction(buy, english);
    expect(r.ok && brief(r.payload)[1]).toEqual(["cash", "A", null, "USD", "-12345", "trade", null, false]);
  });

  it("English refuses a Hungarian-style number", () => {
    const r = buildTransaction({ ...buy, price: "1234,5" }, english);
    expect(!r.ok && r.errors.price).toBe("number");
  });
});
