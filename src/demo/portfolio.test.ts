import { describe, expect, it } from "vitest";
import { DEMO_SEED } from "./seed";
import { demoPortfolio } from "./portfolio";
import { runLedger } from "@/lib/finance/ledger";
import { D } from "@/lib/finance/money";
import { fxFnFromRows, valueAt } from "@/lib/finance/valuation";

describe("demoPortfolio", () => {
  it("builds the existing portfolio model from fictional seed data", () => {
    const today = "2026-10-05";
    const data = demoPortfolio(today);
    const state = runLedger(data.events, fxFnFromRows(data.fxRows), today);

    expect(data.accountMeta.map((account) => account.name)).toEqual(DEMO_SEED.accounts.map((account) => account.name));
    expect(data.instrumentMeta).toHaveLength(DEMO_SEED.assets.length);
    expect(state.errors).toEqual([]);
    for (const cash of DEMO_SEED.cash) {
      expect((state.cash.get(`${cash.accountId}|${cash.currency}`)?.amount ?? new D(0)).eq(new D(cash.amount)), `${cash.accountId} ${cash.currency}`).toBe(true);
    }
    for (const position of DEMO_SEED.positions) {
      expect(state.positions.get(`${position.accountId}|${position.assetId}`)?.qty.eq(new D(position.units)), `${position.accountId} ${position.assetId}`).toBe(true);
    }
    expect(valueAt(data, today, "HUF").complete).toBe(true);
    expect(valueAt(data, today, "HUF").total.gt(0)).toBe(true);
  });
});
