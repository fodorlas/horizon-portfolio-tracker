import { describe, expect, it } from "vitest";
import cases from "../../../tests/fixtures/fx-selection-cases.json";
import { FxDirectionError, applyRate, convert, effectiveRows, selectFx, type FxRow } from "./fx";
import { D, money } from "./money";

const rows: FxRow[] = cases.rows.map((r, i) => ({
  id: r.key,
  base: r.base,
  quote: r.quote,
  rate: r.rate,
  rateDate: r.rateDate,
  source: r.source as FxRow["source"],
  status: r.status as FxRow["status"],
  supersedesId: (r as { supersedes?: string }).supersedes ?? null,
  fetchedAt: `2026-09-26T10:00:${String(i).padStart(2, "0")}Z`,
}));

describe("selectFx – shared cases (same file drives the SQL test)", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const sel = selectFx(rows, c.from, c.to, c.day);
      expect(sel.kind).toBe(c.expect.kind);
      if (sel.kind === "rate" && c.expect.kind === "rate") {
        expect(sel.source).toBe(c.expect.source);
        expect(sel.method).toBe(c.expect.method);
        expect(sel.rateDate).toBe(c.expect.rateDate);
        expect(sel.rate.toDecimalPlaces(10).toString()).toBe(new D(c.expect.rate!).toDecimalPlaces(10).toString());
        expect(sel.rowIds).toEqual(c.expect.rows);
        expect([sel.base, sel.quote]).toEqual([c.from, c.to]);
      }
    });
  }
});

describe("effectiveRows", () => {
  it("drops suspect, broker and superseded rows; corrections inherit the slot", () => {
    const eff = effectiveRows(rows);
    const ids = eff.map((e) => e.row.id);
    expect(ids).not.toContain("m6"); // suspect
    expect(ids).not.toContain("b1"); // broker
    expect(ids).not.toContain("m4"); // superseded by c1
    const c1 = eff.find((e) => e.row.id === "c1")!;
    expect([c1.source, c1.rateDate]).toEqual(["MNB", "2026-09-24"]);
  });

  it("a suspect correction does not hide the original", () => {
    const withBadFix: FxRow[] = [
      ...rows,
      { ...rows[0], id: "bad", source: "manual", status: "suspect", supersedesId: "m1", rate: "1" },
    ];
    expect(effectiveRows(withBadFix).map((e) => e.row.id)).toContain("m1");
  });

  it("the latest of duplicate standalone manual rows wins", () => {
    const dup: FxRow[] = [
      { ...rows[10], id: "old", rate: "400", fetchedAt: "2026-09-20T08:00:00Z" },
      { ...rows[10], id: "new", rate: "410", fetchedAt: "2026-09-21T08:00:00Z" },
    ];
    const sel = selectFx(dup, "GBP", "HUF", "2026-09-26");
    expect(sel.kind === "rate" && sel.rowIds).toEqual(["new"]);
  });
});

describe("applyRate / convert", () => {
  const eurHuf = { base: "EUR", quote: "HUF", rate: new D("364.42") };

  it("converts in the stated direction", () => {
    const r = applyRate(money("100", "EUR"), eurHuf);
    expect([r.amount.toString(), r.currency]).toEqual(["36442", "HUF"]);
  });

  it("refuses the wrong direction instead of silently inverting", () => {
    expect(() => applyRate(money("100", "HUF"), eurHuf)).toThrow(FxDirectionError);
  });

  it("round-trips within rounding", () => {
    const there = selectFx(rows, "USD", "EUR", "2026-09-26");
    const back = selectFx(rows, "EUR", "USD", "2026-09-26");
    const m = convert(convert(money("1000", "USD"), "EUR", there)!, "USD", back)!;
    expect(m.amount.toDecimalPlaces(8).toString()).toBe("1000");
  });

  it("returns null for a missing rate and passes same-currency amounts through", () => {
    expect(convert(money("1", "GBP"), "HUF", { kind: "missing" })).toBeNull();
    const same = money("5", "HUF");
    expect(convert(same, "HUF", { kind: "identity" })).toBe(same);
  });
});
