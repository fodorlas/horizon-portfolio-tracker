import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import hu from "../../../messages/hu.json";
import { parseDecimal } from "./parse";

const value = (raw: string, locale: "hu" | "en") => {
  const p = parseDecimal(raw, locale);
  return p.ok ? p.value.toString() : p.error;
};

describe("parseDecimal in English (spec 2026-10-01 §2.5)", () => {
  it.each([
    ["1,234.56", "1234.56"],
    ["1234.56", "1234.56"],
    ["0.5", "0.5"],
    ["12,345,678", "12345678"],
    ["−1,000.5", "-1000.5"],
    [" 1 234.5 ", "1234.5"],
  ])("%s → %s", (raw, expected) => expect(value(raw, "en")).toBe(expected));

  it.each([
    ["1234,5", "number"],
    ["1.234,56", "number"],
    ["0,5", "number"],
    ["1,23", "number"],
    ["1,2345", "number"],
    ["1.2.3", "number"],
    [",5", "number"],
  ])("%s is refused, never another number", (raw, error) => expect(value(raw, "en")).toBe(error));

  it.each([["0,025"], ["0,925"], ["00,123"], ["-0,500"]])("%s (a Hungarian-habit decimal below 1) is refused, never ×1000", (raw) => {
    expect(value(raw, "en")).toBe("number");
  });

  it.each([["389,125"], ["1,234"], ["-1,000"], [" 389,125 "]])(
    "%s (one comma group, no point: 389.125 by Hungarian habit) is refused as ambiguous (owner, 2026-10-01)",
    (raw) => expect(value(raw, "en")).toBe("ambiguous"),
  );

  it.each([
    ["1,234.00", "1234"],
    ["1,234,567", "1234567"],
    ["1,234,567.5", "1234567.5"],
  ])("%s with a point or two groups stays unambiguous → %s", (raw, expected) => expect(value(raw, "en")).toBe(expected));

  it.each(["number", "decimals", "ambiguous"])("the %s refusal has its own text in both languages (not the generic fallback)", (code) => {
    expect(hu.errors).toHaveProperty(code);
    expect(en.errors).toHaveProperty(code);
  });

  it("too many decimals stays its own error", () => {
    expect(value("0.00000000001", "en")).toBe("decimals");
  });
});

describe("parseDecimal in Hungarian: unchanged", () => {
  it.each([
    ["1234.5", "1234.5"],
    ["1 234,5", "1234.5"],
    ["1.234,5", "1234.5"],
  ])("%s → %s (also the default)", (raw, expected) => {
    expect(value(raw, "hu")).toBe(expected);
    const p = parseDecimal(raw);
    expect(p.ok && p.value.toString()).toBe(expected);
  });
});
