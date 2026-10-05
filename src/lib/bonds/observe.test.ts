import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { D } from "@/lib/finance/money";
import { type AkkRow, parsePrices, parseRates } from "@/lib/providers/akk";
import { type BondTerms, observe } from "./observe";
import { accruedPercent } from "./rules";

const dir = path.join(process.cwd(), "src/lib/providers/__fixtures__");
const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as unknown;
const bySeries = (rows: AkkRow[]) => new Map(rows.map((r) => [r.series, r]));
const mapp = bySeries(parsePrices("MAPP", read("akk-full-mapp.json")));
const map = bySeries(parsePrices("MAP", read("akk-full-map.json")));
const rates = parseRates(read("akk-full-rates.json"));
const TODAY = "2026-09-28";

const m5: BondTerms = { instrumentId: "i-m5", name: "MÁP Plusz 2031/M5", series: "2031/M5", kind: "mapp", tab: "MAPP", issue: "2026-07-20", maturity: "2031-08-21" };
const n27: BondTerms = { instrumentId: "i-n", name: "BMÁP 2027/N", series: "2027/N", kind: "bmap", tab: "MAP", issue: "2023-11-09", maturity: "2027-05-26" };

describe("observe: one instrument against today's ÁKK rows (spec §4.1, §4.3, §5.4)", () => {
  it("a listed series: today's price per 1 Ft, the reading, and a matching self-check", () => {
    const o = observe(m5, mapp, [], TODAY);
    expect(o.quote).toEqual({ instrumentId: "i-m5", price: "0.999589", currency: "HUF", asOf: "2026-09-28T21:59:59.000Z", source: "akk" });
    expect(o.observation).toEqual({
      instrumentId: "i-m5", day: TODAY, bid: "99", ask: "100", accrued: "0.9589", coupon: "5", settleDate: "2026-09-28", checkResult: "ok",
    });
    expect(o.check).toBe("verified");
    expect(o.log).toBe("ok");
  });

  it("a rule that does not match is not verified, and the log says so", () => {
    const wrong = new Map(mapp);
    wrong.set("2031/M5", { ...mapp.get("2031/M5")!, coupon: new D("5.25") });
    const o = observe(m5, wrong, [], TODAY);
    expect(o.observation?.checkResult).toBe("mismatch");
    expect(o.check).toBe("mismatch");
    expect(o.log).toBe("rule_mismatch");
    expect(o.quote).not.toBeNull(); // the value is the ÁKK's own either way
  });

  it("a series missing from the list before its maturity: no price, the last one stays", () => {
    const o = observe(m5, new Map(), [], TODAY);
    expect(o).toEqual({ quote: null, observation: null, check: null, log: "not_listed" });
  });

  it("from the maturity on: the nominal at 100%, on the maturity day, whatever the list says", () => {
    const o = observe({ ...m5, maturity: "2026-09-20" }, new Map(), [], TODAY);
    expect(o.quote).toEqual({ instrumentId: "i-m5", price: "1", currency: "HUF", asOf: "2026-09-20T21:59:59.000Z", source: "akk" });
    expect(o.observation).toBeNull();
    expect(o.check).toBeNull();
    expect(o.log).toBe("matured");
  });

  it("a T+2 settle day past an interest day checks the new period, not today's (#35)", () => {
    // 2031/M5 pays on 2027-08-21. On Thursday 2027-08-19 the ÁKK settles on Monday 2027-08-23 (20 August is a holiday):
    // its accrued interest is two days of the new period.
    const annual = new D("5.5");
    const accrued = accruedPercent("mapp", annual, "2027-08-21", "2027-08-23", m5.maturity).toDecimalPlaces(4);
    const row = new Map([["2031/M5", { ...mapp.get("2031/M5")!, settle: "2027-08-23", accrued, coupon: annual }]]);
    const o = observe(m5, row, [], "2027-08-19");
    expect(o.observation).toMatchObject({ day: "2027-08-19", settleDate: "2027-08-23", checkResult: "ok" });
    expect(o.check).toBe("verified");
    // The same figure against the old period (as if read on today's date) would not match.
    expect(accruedPercent("mapp", annual, "2026-07-20", "2027-08-19", m5.maturity).toDecimalPlaces(4).eq(accrued)).toBe(false);
  });

  it("on the interest day itself the accrued interest is 0 for any rate: the reading decides nothing", () => {
    // 2031/M5's first period starts on its issue day, 2026-07-20.
    const onStart = new Map([["2031/M5", { ...mapp.get("2031/M5")!, settle: "2026-07-20", accrued: new D(0), coupon: new D("9.99") }]]);
    const o = observe(m5, onStart, [], "2026-07-20");
    expect(o.observation?.checkResult).toBe("no_rate");
    expect(o.check).toBeNull(); // the stored check stays as it is
    expect(o.log).toBe("ok");
    expect(o.quote).not.toBeNull();
  });

  it("BMÁP checks with its history; without it the rate is unknown, which is not a mismatch", () => {
    const withHistory = observe(n27, map, rates.filter((r) => r.series === "2027/N"), TODAY);
    expect(withHistory.check).toBe("verified");
    expect(withHistory.observation?.coupon).toBeNull();
    const without = observe(n27, map, [], TODAY);
    expect(without.observation?.checkResult).toBe("no_rate");
    expect(without.check).toBe("unknown");
    expect(without.log).toBe("ok");
  });
});
