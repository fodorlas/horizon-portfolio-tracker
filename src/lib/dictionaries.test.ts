/** The English dictionary mirrors the Hungarian one (spec 2026-10-01 §3.1, §5.1). */
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import hu from "../../messages/hu.json";

type Leaf = [path: string, value: string];
const leaves = (x: unknown, p = ""): Leaf[] =>
  typeof x === "string"
    ? [[p, x]]
    : Array.isArray(x)
      ? x.flatMap((v, i) => leaves(v, `${p}[${i}]`))
      : Object.entries(x as object).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
const HU = new Map(leaves(hu));
const EN = new Map(leaves(en));
// Proper names the spec keeps (§2.2), and the accented letters they carry.
const KEPT = /BÉT|ÁKK|MÁP|FixMÁP|BMÁP|PMÁP/g;

describe("the English dictionary", () => {
  it("has exactly the Hungarian keys (arrays of the same length)", () => {
    expect([...EN.keys()].sort()).toEqual([...HU.keys()].sort());
  });

  it("keeps every placeholder", () => {
    const wrong = [...HU].filter(([k, v]) => JSON.stringify(placeholders(v)) !== JSON.stringify(placeholders(EN.get(k) ?? "")));
    expect(wrong.map(([k]) => k)).toEqual([]);
  });

  it("has no empty text", () => {
    expect([...EN].filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });

  it("has no Hungarian accented letter outside the kept proper names", () => {
    const left = [...EN].filter(([, v]) => /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/.test(v.replace(KEPT, "")));
    expect(left.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });

  it("reads right when a count is 1: no \"1 days\", \"1 transactions\" (English needs the plural, Hungarian does not)", () => {
    const one = (v: string) => v.replace(/\{\w+\}/g, "1");
    const wrong = [...EN].filter(([, v]) => /\b1 (?!is\b|was\b|has\b)(?:[A-Za-z]+ ){0,2}[a-z]+s\b/.test(one(v)));
    expect(wrong.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });
});
