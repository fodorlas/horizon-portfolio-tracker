import { describe, expect, it } from "vitest";
import { D, ZERO, addDays, dec, businessDaysBetween, daysBetween, isCurrency, isDay, isWeekday, money, todayInBudapest } from "./money";

describe("money", () => {
  it("decimal arithmetic has no float artefacts", () => {
    expect(new D("0.1").plus("0.2").toString()).toBe("0.3");
    expect(money("7", "HUF").amount.times("1.1").toString()).toBe("7.7");
  });

  it("helpers build decimals", () => {
    expect(dec("1.5").plus(ZERO).toString()).toBe("1.5");
  });

  it("validates currencies and days", () => {
    expect(isCurrency("HUF")).toBe(true);
    expect(isCurrency("huf")).toBe(false);
    expect(isCurrency("HUFF")).toBe(false);
    expect(isDay("2026-09-26")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("26-09-2026")).toBe(false);
  });

  it("does calendar arithmetic across month, year and DST boundaries", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30"); // EU DST starts 03-29
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
    expect(daysBetween("2026-09-26", "2026-09-20")).toBe(-6);
  });

  it("counts weekdays", () => {
    expect(isWeekday("2026-09-26")).toBe(false); // Saturday
    expect(isWeekday("2026-09-28")).toBe(true); // Monday
    expect(businessDaysBetween("2026-09-25", "2026-09-28")).toBe(1); // Fri → Mon
    expect(businessDaysBetween("2026-09-21", "2026-09-25")).toBe(4);
  });

  it("today is taken in the Budapest time zone", () => {
    // 23:30 UTC on 30 Sep is already 1 Oct in Budapest (UTC+2 in summer).
    expect(todayInBudapest(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10-01");
    expect(todayInBudapest(new Date("2026-12-31T22:59:00Z"))).toBe("2026-12-31");
  });
});
