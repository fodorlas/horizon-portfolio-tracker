import { describe, expect, it } from "vitest";
import { D } from "./finance/money";
import { i18nFor } from "./i18n";

const f = i18nFor("hu").f;

// Intl uses no-break spaces as group separators in hu-HU.
const norm = (s: string) => s.replace(/ | /g, " ");

describe("format", () => {
  it("money: forint without decimals, others with two", () => {
    expect(norm(f.money(new D("48215300.4"), "HUF"))).toBe("48 215 300 Ft");
    expect(norm(f.money(new D("12450.5"), "USD"))).toBe("12 450,50 USD");
    expect(norm(f.money(new D("-5"), "EUR"))).toBe("−5,00 EUR");
  });

  it("keeps precision beyond float range", () => {
    expect(norm(f.money(new D("12345678901234567.89"), "USD"))).toBe("12 345 678 901 234 567,89 USD");
  });

  it("changes carry an arrow and a sign, not only colour", () => {
    expect(f.change(new D("312400"), "HUF")).toEqual({ text: "▲ +312 400 Ft", direction: "up" });
    expect(norm(f.change(new D("-1234.4"), "HUF").text)).toBe("▼ −1234 Ft"); // hu-HU groups from 5 digits
    expect(f.change(new D("0.004"), "EUR").direction).toBe("flat");
  });

  it("percent", () => {
    expect(norm(f.percent(new D("0.0065")))).toBe("+0,65%");
    expect(norm(f.percent(new D("-0.123")))).toBe("−12,30%");
    expect(norm(f.percent(new D("0.38"), 0, false))).toBe("38%");
  });

  it("quantity", () => {
    expect(f.quantity(new D("10"))).toBe("10");
    expect(f.quantity(new D("0.025"))).toBe("0,025");
  });

  it("day", () => {
    expect(f.day("2026-09-26")).toBe("2026. szept. 26.");
  });

  it("day with the weekday, for the header", () => {
    expect(f.longDay("2026-09-27")).toBe("2026. szept. 27., vasárnap");
    expect(f.longDay("2026-09-28")).toBe("2026. szept. 28., hétfő");
  });

  it("greeting follows the Budapest clock", () => {
    expect(f.greeting(new Date("2026-09-26T05:30:00Z"))).toBe("Jó reggelt!"); // 07:30 CEST
    expect(f.greeting(new Date("2026-09-26T12:00:00Z"))).toBe("Szép napot!");
    expect(f.greeting(new Date("2026-09-26T17:00:00Z"))).toBe("Jó estét!"); // 19:00
    expect(f.greeting(new Date("2026-09-26T21:30:00Z"))).toBe("Jó éjszakát!"); // 23:30
  });

  it("FX rate and short day", () => {
    expect(f.rate(new D("356.12"))).toBe("356,12");
    expect(f.rate(new D("1.083145"))).toBe("1,0831");
    expect(f.shortDay("2026-03-05")).toBe("márc. 5.");
  });
  it("greeting: the band edges on the Budapest clock (CEST = UTC+2)", () => {
    const at = (utc: string) => f.greeting(new Date(`2026-09-26T${utc}Z`));
    expect(at("02:59:00")).toBe("Jó éjszakát!"); // 04:59
    expect(at("03:00:00")).toBe("Jó reggelt!"); // 05:00
    expect(at("07:59:00")).toBe("Jó reggelt!"); // 09:59
    expect(at("08:00:00")).toBe("Szép napot!"); // 10:00
    expect(at("15:59:00")).toBe("Szép napot!"); // 17:59
    expect(at("16:00:00")).toBe("Jó estét!"); // 18:00
    expect(at("19:59:00")).toBe("Jó estét!"); // 21:59
    expect(at("20:00:00")).toBe("Jó éjszakát!"); // 22:00
  });

  it("moment: 'ma' only on the same Budapest day", () => {
    // 23:30 Budapest on 26 Sept is 21:30Z; 00:30 Budapest on 27 Sept is 22:30Z on the 26th.
    expect(f.moment("2026-09-26T21:30:00Z", new Date("2026-09-26T21:45:00Z"))).toBe("ma 23:30");
    expect(norm(f.moment("2026-09-26T21:30:00Z", new Date("2026-09-26T22:30:00Z")))).toBe("szept. 26. 23:30");
  });
});

describe("price: a unit price keeps up to four decimals (#76)", () => {
  it("an ÁKK price per 1 Ft face value no longer shows as 1 Ft; never fewer decimals than the currency's", () => {
    expect(norm(f.price(new D("1.0123456"), "HUF"))).toBe("1,0123 Ft");
    expect(norm(f.price(new D("18250"), "HUF"))).toBe("18 250 Ft");
    expect(norm(f.price(new D("4365.5"), "HUF"))).toBe("4365,5 Ft");
    expect(norm(f.price(new D("98.7600021"), "EUR"))).toBe("98,76 EUR");
    expect(norm(f.price(new D("98.7"), "EUR"))).toBe("98,70 EUR");
  });
});

describe("format in English (en-GB, spec 2026-10-01 §2.4)", () => {
  const e = i18nFor("en").f;
  it("price (#76)", () => {
    expect(norm(e.price(new D("1.0123456"), "HUF"))).toBe("HUF 1.0123");
    expect(e.price(new D("98.76"), "EUR")).toBe("€98.76");
  });
  it("money, change, percent, quantity, rate", () => {
    expect(norm(e.money(new D("-1234567.5"), "HUF"))).toBe("−HUF 1,234,568");
    expect(e.money(new D("-1234567.5"), "EUR")).toBe("−€1,234,567.50");
    expect(norm(e.change(new D("312400"), "HUF").text)).toBe("▲ +HUF 312,400");
    expect(e.percent(new D("0.0065"))).toBe("+0.65%");
    expect(e.quantity(new D("0.025"))).toBe("0.025");
    expect(e.rate(new D("356.12"))).toBe("356.12");
  });
  it("days", () => {
    expect(e.day("2026-09-27")).toBe("27 Sept 2026");
    expect(e.longDay("2026-09-27")).toBe("Sunday, 27 Sept 2026");
    expect(e.shortDay("2026-09-26")).toBe("26 Sept");
  });
  it("moment and greeting", () => {
    expect(e.moment("2026-09-26T12:02:00Z", new Date("2026-09-26T15:00:00Z"))).toBe("today 14:02");
    expect(e.moment("2026-09-26T12:02:00Z", new Date("2026-09-27T15:00:00Z"))).toBe("26 Sept, 14:02");
    expect(e.greeting(new Date("2026-09-26T05:30:00Z"))).toBe("Good morning!");
    expect(e.greeting(new Date("2026-09-26T12:00:00Z"))).toBe("Hello!");
    expect(e.greeting(new Date("2026-09-26T17:00:00Z"))).toBe("Good evening!");
    expect(e.greeting(new Date("2026-09-26T21:30:00Z"))).toBe("Good night!");
  });
});

describe("typed: a number the way the form field takes it back", () => {
  it("decimal comma in Hungarian, point in English, never grouped", () => {
    expect(i18nFor("hu").f.typed(new D("1234.5"))).toBe("1234,5");
    expect(i18nFor("en").f.typed(new D("1234.5"))).toBe("1234.5");
    expect(i18nFor("hu").f.typed("0.0611")).toBe("0,0611");
    expect(i18nFor("en").f.typed("-3")).toBe("-3");
  });
});
