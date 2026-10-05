import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LedgerEvent, Line } from "@/lib/finance/ledger";
import { D, type Day } from "@/lib/finance/money";
import { parseRates } from "@/lib/providers/akk";
import type { RateRow } from "./rules";
import { type BondFacts, type Observed, proposalsFor } from "./proposals";

let n = 0;
const line = (p: Partial<Line> & Pick<Line, "kind" | "role" | "accountId">, amount: string): Line => ({
  id: `l${++n}`, instrumentId: null, currency: "HUF", costAmount: null, costEstimated: false, costFxRefs: null, ...p, amount: new D(amount),
});
const ev = (type: LedgerEvent["type"], date: Day, lines: Line[]): LedgerEvent => ({
  id: `e${++n}`, type, date, createdAt: `${date}T10:00:00Z`, correctionKind: null, splitRatio: null, note: null, lines,
});
const buy = (acc: string, inst: string, date: Day, qty: string) =>
  ev("buy", date, [line({ kind: "position", role: "trade", accountId: acc, instrumentId: inst, costAmount: new D(qty) }, qty), line({ kind: "cash", role: "trade", accountId: acc }, `-${qty}`)]);

const m9: BondFacts = { instrumentId: "M9", name: "MÁP Plusz N2030/M9", series: "N2030/M9", kind: "mapp", tab: "MAPP", issue: "2025-09-02", maturity: "2030-09-25", check: "verified" };
const q4: BondFacts = { instrumentId: "Q4", name: "FixMÁP 2031/Q4", series: "2031/Q4", kind: "fixmap", tab: "MAP", issue: "2026-06-16", maturity: "2031-05-26", check: "verified" };
const bn: BondFacts = { instrumentId: "BN", name: "BMÁP 2027/N", series: "2027/N", kind: "bmap", tab: "MAP", issue: "2023-11-09", maturity: "2027-05-26", check: "verified" };

const history = parseRates(JSON.parse(readFileSync(path.join(process.cwd(), "src/lib/providers/__fixtures__/akk-full-rates.json"), "utf8")))
  .filter((r) => r.series === "2027/N")
  .map((r): RateRow => ({ start: r.start, end: r.end, rate: r.rate }));
const obs = (settle: Day, coupon: string, checkResult: Observed["checkResult"] = "ok"): Observed => ({ settle, coupon: new D(coupon), checkResult });

const run = (bonds: BondFacts[], events: LedgerEvent[], today: Day, extra: { rates?: Map<string, RateRow[]>; observations?: Map<string, Observed[]> } = {}) =>
  proposalsFor({ bonds, events, today, rates: extra.rates ?? new Map(), observations: extra.observations ?? new Map() });

describe("proposalsFor: interest days and maturities the owner should see (spec §5, §6.2)", () => {
  it("MÁP Plusz: the first crediting, with no rate seen for that period → no amount (decision 12)", () => {
    const [p, ...rest] = run([m9], [buy("A", "M9", "2025-09-10", "1000000")], "2026-09-28");
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ instrumentId: "M9", accountId: "A", kind: "interest_reinvest", due: "2026-09-25", nominal: new D(1000000), percent: null, amount: null });
    expect(p.basis).toMatchObject({ start: "2025-09-02", end: "2026-09-25", days: 388, annual: null, rateSource: null, method: "act_act", uncertain: false, missing: "rate" });
  });

  it("MÁP Plusz with a checked reading in that period: 6.11% of 1 000 000 = 61 100 Ft", () => {
    const [p] = run([m9], [buy("A", "M9", "2025-09-10", "1000000")], "2026-09-28", { observations: new Map([["M9", [obs("2025-12-01", "5.75")]]]) });
    expect(p.percent?.toFixed()).toBe("6.11");
    expect(p.amount?.toFixed()).toBe("61100");
    expect(p.basis).toMatchObject({ annual: "5.75", rateSource: "observed", missing: null });
  });

  it("a reading whose settle day is in the next period does not count for this one", () => {
    const [p] = run([m9], [buy("A", "M9", "2025-09-10", "1000000")], "2026-09-28", { observations: new Map([["M9", [obs("2026-09-25", "6.00")]]]) });
    expect(p.amount).toBeNull();
  });

  it("a holding changed within 14 days: the second weekday before, flagged uncertain", () => {
    // Due Friday 2026-09-25: the second weekday before is Wednesday 2026-09-23.
    const events = [buy("A", "M9", "2025-09-10", "1000000"), buy("A", "M9", "2026-09-24", "500000")];
    const [p] = run([m9], events, "2026-09-28");
    expect(p.nominal.toFixed()).toBe("1000000");
    expect(p.basis.uncertain).toBe(true);
  });

  it("FixMÁP: quarterly cash interest, the short first quarter included", () => {
    const ps = run([q4], [buy("A", "Q4", "2026-07-01", "500000")], "2026-12-01", { observations: new Map([["Q4", [obs("2026-12-01", "6")]]]) });
    expect(ps.map((p) => [p.kind, p.due, p.percent?.toFixed(), p.amount?.toFixed()])).toEqual([
      ["interest", "2026-08-26", "1.16", "5800"],
      ["interest", "2026-11-26", "1.5", "7500"],
    ]);
  });

  it("BMÁP: each quarter at its own rate from the ÁKK history, days over 360", () => {
    const ps = run([bn], [buy("A", "BN", "2026-01-10", "1000000")], "2026-09-28", { rates: new Map([["2027/N", history]]) });
    expect(ps.map((p) => [p.due, p.basis.annual, p.percent?.toFixed(), p.amount?.toFixed(), p.basis.method, p.basis.rateSource])).toEqual([
      ["2026-02-26", "7.73", "1.98", "19800", "act_360", "history"],
      ["2026-05-26", "7.6", "1.88", "18800", "act_360", "history"],
      ["2026-08-26", "7.38", "1.89", "18900", "act_360", "history"],
    ]);
  });

  it("a maturity repays the whole holding; its interest follows the same rules", () => {
    const short = { ...q4, instrumentId: "S", series: "2026/X", issue: "2025-09-20", maturity: "2026-09-20" };
    const ps = run([short], [buy("A", "S", "2026-05-01", "200000")], "2026-09-28", { observations: new Map([["S", [obs("2026-09-01", "6")]]]) });
    expect(ps.at(-1)).toMatchObject({ kind: "maturity", due: "2026-09-20", nominal: new D(200000) });
    expect(ps.at(-1)?.amount?.toFixed()).toBe("3000"); // a full quarter: 1.50%
  });

  it("nothing where the ledger already has that event (a manual one included)", () => {
    const credited = ev("interest_reinvest", "2026-09-25", [
      line({ kind: "cash", role: "income", accountId: "A", instrumentId: "M9" }, "61100"),
      line({ kind: "cash", role: "trade", accountId: "A" }, "-61100"),
      line({ kind: "position", role: "trade", accountId: "A", instrumentId: "M9", costAmount: new D(61100) }, "61100"),
    ]);
    expect(run([m9], [buy("A", "M9", "2025-09-10", "1000000"), credited], "2026-09-28")).toEqual([]);
    // A cash interest typed on the Haladó form with the paper named (tx/build.ts).
    const paid = ev("interest", "2026-08-26", [line({ kind: "cash", role: "income", accountId: "A", instrumentId: "Q4" }, "5800")]);
    const ps = run([q4], [buy("A", "Q4", "2026-07-01", "500000"), paid], "2026-12-01");
    expect(ps.map((p) => p.due)).toEqual(["2026-11-26"]);
  });

  it("the same series on two accounts: one proposal each, with that account's nominal", () => {
    const ps = run([m9], [buy("A", "M9", "2025-09-10", "1000000"), buy("B", "M9", "2025-09-10", "300000")], "2026-09-28");
    expect(ps.map((p) => [p.accountId, p.nominal.toFixed()])).toEqual([["A", "1000000"], ["B", "300000"]]);
  });

  it("a series whose check does not match: no amount, marked unverified", () => {
    const [p] = run([{ ...m9, check: "mismatch" }], [buy("A", "M9", "2025-09-10", "1000000")], "2026-09-28", { observations: new Map([["M9", [obs("2025-12-01", "5.75")]]]) });
    expect(p.amount).toBeNull();
    expect(p.basis.missing).toBe("unverified");
  });

  it("a series not checked yet: no amount either, but marked unchecked, not as a mismatch (#30)", () => {
    const [p] = run([{ ...m9, check: "unknown" }], [buy("A", "M9", "2025-09-10", "1000000")], "2026-09-28", { observations: new Map([["M9", [obs("2025-12-01", "5.75")]]]) });
    expect(p.amount).toBeNull();
    expect(p.basis.missing).toBe("unchecked");
  });

  it("nothing before the owner held the paper, nothing in the future", () => {
    expect(run([m9], [buy("A", "M9", "2026-09-26", "1000000")], "2026-09-28")).toEqual([]);
  });
});
