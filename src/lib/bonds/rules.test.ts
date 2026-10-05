import { describe, expect, it } from "vitest";
import { D, type Day } from "@/lib/finance/money";
import { accruedMatches, accruedPercent, addMonths, bondKind, entitled, historyPeriods, interestAmount, periodOn, periodPercent, steppedPeriods } from "./rules";

const pct = (kind: Parameters<typeof periodPercent>[0], annual: string, start: Day, end: Day, maturity: Day) =>
  periodPercent(kind, new D(annual), { start, end }, maturity).toFixed(2);

describe("bondKind: the ÁKK security types the rules cover", () => {
  it("both MÁP Plusz kinds capitalise alike; bonds of the exchange are not ours", () => {
    expect(bondKind("MÁP Plusz")).toBe("mapp");
    expect(bondKind("MÁPP_T")).toBe("mapp");
    expect(bondKind("FixMÁP")).toBe("fixmap");
    expect(bondKind("PMÁP")).toBe("pmap");
    expect(bondKind("BMÁP")).toBe("bmap");
    expect(bondKind("KTV")).toBeNull();
  });
});

describe("addMonths: the same day of the month, or the month's last day", () => {
  it("steps and clamps", () => {
    expect(addMonths("2031-08-31", -3)).toBe("2031-05-31");
    expect(addMonths("2031-05-31", -3)).toBe("2031-02-28");
    expect(addMonths("2028-05-31", -3)).toBe("2028-02-29");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2025-12-15", 1)).toBe("2026-01-15");
  });
});

describe("steppedPeriods: interest days step back from maturity; a short first stub joins the next period", () => {
  it("MÁP Plusz 2031/M5: 32-day stub → one long first period (offering: 2026.07.20 – 2027.08.21)", () => {
    const p = steppedPeriods("2026-07-20", "2031-08-21", "mapp");
    expect(p[0]).toEqual({ start: "2026-07-20", end: "2027-08-21" });
    expect(p[1]).toEqual({ start: "2027-08-21", end: "2028-08-21" });
    expect(p).toHaveLength(5);
    expect(p.at(-1)!.end).toBe("2031-08-21");
  });

  it("N2030/M9: 2025.09.02 – 2026.09.25 is the first period", () => {
    expect(steppedPeriods("2025-09-02", "2030-09-25", "mapp")[0]).toEqual({ start: "2025-09-02", end: "2026-09-25" });
  });

  it("FixMÁP 2031/Q4: a 71-day stub of a 92-day quarter stays a short first period; 20 interest days", () => {
    const p = steppedPeriods("2026-06-16", "2031-05-26", "fixmap");
    expect(p[0]).toEqual({ start: "2026-06-16", end: "2026-08-26" });
    expect(p[1]).toEqual({ start: "2026-08-26", end: "2026-11-26" });
    expect(p).toHaveLength(20);
  });

  it("FixMÁP 2029/Q1: a 4-day stub joins the next quarter (offering: 2026.07.20 – 2026.10.24)", () => {
    expect(steppedPeriods("2026-07-20", "2029-07-24", "fixmap")[0]).toEqual({ start: "2026-07-20", end: "2026-10-24" });
  });
});

describe("historyPeriods: BMÁP and PMÁP periods as the ÁKK history lists them", () => {
  it("sorted, and the first one starts on the issue day, not on the offering's first day", () => {
    const rows = [
      { start: "2026-05-23", end: "2027-05-23", rate: new D("4.50") },
      { start: "2025-10-01", end: "2026-05-23", rate: new D("6.00") },
    ];
    expect(historyPeriods("2025-10-02", rows)).toEqual([
      { start: "2025-10-02", end: "2026-05-23", rate: new D("6.00") },
      { start: "2026-05-23", end: "2027-05-23", rate: new D("4.50") },
    ]);
  });
});

describe("periodPercent: the offering documents' own figures", () => {
  it("MÁP Plusz long first periods: 6.11% and 5.44%", () => {
    expect(pct("mapp", "5.75", "2025-09-02", "2026-09-25", "2030-09-25")).toBe("6.11");
    expect(pct("mapp", "5.00", "2026-07-20", "2027-08-21", "2031-08-21")).toBe("5.44");
  });

  it("a full year is the annual rate, even with 29 February in it", () => {
    expect(pct("mapp", "6.00", "2026-09-25", "2027-09-25", "2030-09-25")).toBe("6.00");
    expect(pct("mapp", "6.25", "2027-09-25", "2028-09-25", "2030-09-25")).toBe("6.25");
  });

  it("FixMÁP: a short first quarter 1.16%, a long one 1.44%, a full quarter a quarter of the rate", () => {
    expect(pct("fixmap", "6.00", "2026-06-16", "2026-08-26", "2031-05-26")).toBe("1.16");
    expect(pct("fixmap", "5.50", "2026-07-20", "2026-10-24", "2029-07-24")).toBe("1.44");
    expect(pct("fixmap", "6.00", "2026-08-26", "2026-11-26", "2031-05-26")).toBe("1.50");
  });

  it("PMÁP 2036/I1 short first period: 2.66%", () => {
    expect(pct("pmap", "4.50", "2026-07-20", "2027-02-21", "2036-02-21")).toBe("2.66");
  });

  it("BMÁP counts days over 360: 2027/N first period 2.82%", () => {
    expect(pct("bmap", "9.31", "2023-11-09", "2024-02-26", "2027-05-26")).toBe("2.82");
  });
});

describe("interestAmount: 4 decimals per 1 Ft, times the nominal, whole forints, half up", () => {
  it("rounds the general way, not to even", () => {
    expect(interestAmount(new D("6.11"), new D(1_000_000)).toFixed()).toBe("61100");
    expect(interestAmount(new D("1.16"), new D(1_234_567)).toFixed()).toBe("14321");
    expect(interestAmount(new D("0.5"), new D(100)).toFixed()).toBe("1");
    expect(interestAmount(new D("1.157"), new D(10_000)).toFixed()).toBe("116");
  });
});

describe("accruedMatches: the owner's four series against the ÁKK on 2026-09-28 (settle day)", () => {
  it("each agrees to 4 decimals", () => {
    expect(accruedMatches("mapp", new D("5.00"), "2026-07-20", "2026-09-28", "2031-08-21", new D("0.9589"))).toBe(true);
    expect(accruedMatches("mapp", new D("6.00"), "2026-09-25", "2026-09-28", "2030-09-25", new D("0.0493"))).toBe(true);
    expect(accruedMatches("bmap", new D("6.80"), "2026-08-26", "2026-09-28", "2027-05-26", new D("0.6233"))).toBe(true);
    expect(accruedMatches("fixmap", new D("7.00"), "2026-07-22", "2026-09-28", "2027-01-22", new D("1.2935"))).toBe(true);
  });

  it("a wrong period start or rate does not", () => {
    expect(accruedMatches("mapp", new D("5.00"), "2026-08-21", "2026-09-28", "2031-08-21", new D("0.9589"))).toBe(false);
    expect(accruedMatches("bmap", new D("7.38"), "2026-08-26", "2026-09-28", "2027-05-26", new D("0.6233"))).toBe(false);
  });

  it("accruedPercent is 0 on the interest day itself", () => {
    expect(accruedPercent("fixmap", new D(6), "2026-08-26", "2026-08-26", "2031-05-26").toFixed()).toBe("0");
  });
});

describe("periodOn: start ≤ day < end", () => {
  const ps = [{ start: "2026-01-01", end: "2026-04-01" }, { start: "2026-04-01", end: "2026-07-01" }];
  it("the interest day belongs to the next period", () => {
    expect(periodOn(ps, "2026-04-01")).toBe(ps[1]);
    expect(periodOn(ps, "2026-03-31")).toBe(ps[0]);
    expect(periodOn(ps, "2026-07-01")).toBeNull();
  });
});

describe("entitled: the 14-day rule instead of a holiday calendar (spec §5.1)", () => {
  // Interest day Monday 2026-09-28; its second weekday before is Thursday 2026-09-24.
  const due = "2026-09-28";
  it("unchanged for 14 days: the holding at the end of the day before, certain", () => {
    const r = entitled(() => new D(1000), due);
    expect(r).toEqual({ nominal: new D(1000), uncertain: false });
  });

  it("changed inside the window: the end of the second weekday before, uncertain", () => {
    const at = (d: Day) => (d >= "2026-09-25" ? new D(1500) : new D(1000));
    expect(entitled(at, due)).toEqual({ nominal: new D(1000), uncertain: true });
  });
});
