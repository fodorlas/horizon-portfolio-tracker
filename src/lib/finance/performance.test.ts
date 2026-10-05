import { describe, expect, it } from "vitest";
import { D } from "./money";
import { effectivePeriod, modifiedDietz } from "./performance";

const d = (v: string | number) => new D(v);

describe("modifiedDietz – day convention (plan §4)", () => {
  it("the plan's example: 30-day period, deposit on day 10 weighs 20/30", () => {
    // S = 1 Sep, E = 30 Sep, deposit of 30 000 on 10 Sep (d − S = 9).
    const r = modifiedDietz(d(100_000), d(135_000), [{ day: "2026-09-10", amount: d(30_000) }], "2026-09-01", "2026-09-30");
    expect(r.denominator.toString()).toBe("120000"); // 100 000 + 30 000 × 20/30
    expect(r.valueChange.toString()).toBe("35000");
    expect(r.netFlow.toString()).toBe("30000");
    expect(r.result.toString()).toBe("5000");
    expect(r.returnRate!.toDecimalPlaces(8).toString()).toBe("0.04166667");
  });

  it("a flow on the first day weighs (T−1)/T, on the last day 0", () => {
    const first = modifiedDietz(d(1000), d(1000), [{ day: "2026-09-01", amount: d(300) }], "2026-09-01", "2026-09-30");
    expect(first.denominator.toString()).toBe("1290"); // 1000 + 300 × 29/30
    const last = modifiedDietz(d(1000), d(1300), [{ day: "2026-09-30", amount: d(300) }], "2026-09-30", "2026-09-30");
    expect(last.denominator.toString()).toBe("1000"); // weight 0
    expect(last.result.toString()).toBe("0"); // same-day deposit is not a gain
  });

  it("flows outside [S, E] are ignored", () => {
    const r = modifiedDietz(d(1000), d(1100), [{ day: "2026-08-31", amount: d(500) }, { day: "2026-10-01", amount: d(500) }], "2026-09-01", "2026-09-30");
    expect(r.netFlow.toString()).toBe("0");
    expect(r.returnRate!.toString()).toBe("0.1");
  });

  it("withdrawals reduce the base", () => {
    const r = modifiedDietz(d(1000), d(600), [{ day: "2026-09-16", amount: d(-500) }], "2026-09-01", "2026-09-30");
    // weight (30 − 16)/30 = 14/30
    expect(r.denominator.toDecimalPlaces(6).toString()).toBe("766.666667");
    expect(r.result.toString()).toBe("100");
  });

  it("not meaningful: empty start and a last-day deposit", () => {
    const r = modifiedDietz(d(0), d(1000), [{ day: "2026-09-30", amount: d(1000) }], "2026-09-01", "2026-09-30");
    expect(r.notMeaningful).toBe(true);
    expect(r.returnRate).toBeNull();
    expect(r.result.toString()).toBe("0");
  });

  it("not meaningful: denominator below 1 % of the scale", () => {
    // 100 − 103 × 29/30 ≈ 0.43 > 0, but below 1 % of max(100, 103) = 1.03.
    const r = modifiedDietz(d(100), d(0), [{ day: "2026-09-01", amount: d(-103) }], "2026-09-01", "2026-09-30");
    expect(r.denominator.gt(0) && r.denominator.lt("1.03")).toBe(true);
    expect(r.notMeaningful).toBe(true);
    expect(r.returnRate).toBeNull();
  });

  it("warns about large flows relative to the starting value", () => {
    expect(modifiedDietz(d(1000), d(1200), [{ day: "2026-09-15", amount: d(101) }], "2026-09-01", "2026-09-30").largeFlows).toBe(true);
    expect(modifiedDietz(d(1000), d(1200), [{ day: "2026-09-15", amount: d(100) }], "2026-09-01", "2026-09-30").largeFlows).toBe(false);
    expect(modifiedDietz(d(1000), d(1200), [], "2026-09-01", "2026-09-30").largeFlows).toBe(false);
  });

  it("rejects an inverted period", () => {
    expect(() => modifiedDietz(d(1), d(1), [], "2026-09-02", "2026-09-01")).toThrow();
  });
});

describe("effectivePeriod", () => {
  it("starts the day after the tracking start at the earliest", () => {
    expect(effectivePeriod("2026-01-01", "2026-09-30", "2026-03-01")).toEqual({ start: "2026-03-02", end: "2026-09-30", truncated: true });
    expect(effectivePeriod("2026-06-01", "2026-09-30", "2026-03-01")).toEqual({ start: "2026-06-01", end: "2026-09-30", truncated: false });
  });
  it("is empty when the whole period is before tracking", () => {
    expect(effectivePeriod("2026-01-01", "2026-03-01", "2026-03-01")).toBeNull();
  });
});
