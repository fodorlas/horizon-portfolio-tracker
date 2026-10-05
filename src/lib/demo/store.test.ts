import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_SEED } from "@/demo/seed";
import { executeDemoTrade, portfolioValue, readDemoState, resetDemoState, writeDemoState, DEMO_STORAGE_KEY } from "./store";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("demo state", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("starts from a copy of the fictional seed data", () => {
    const state = readDemoState(storage);
    expect(state).toEqual(DEMO_SEED);
    expect(state).not.toBe(DEMO_SEED);
    expect(state.institutions.map((a) => a.name)).toContain("Demo Broker");
  });

  it("records a buy, reduces cash, and marks the holding at its sample price", () => {
    const state = readDemoState(storage);
    const before = portfolioValue(state, "HUF");
    const next = executeDemoTrade(state, { action: "buy", accountId: "account-bet", assetId: "asset-otp", units: "2", price: "34000", date: "2026-10-04" });
    expect(next).not.toBe(state);
    expect(next.cash.find((row) => row.accountId === "account-bet" && row.currency === "HUF")?.amount).toBe("682000");
    expect(next.positions.find((row) => row.accountId === "account-bet" && row.assetId === "asset-otp")?.units).toBe("32");
    expect(portfolioValue(next, "HUF").eq(before.minus(3000))).toBe(true);
  });

  it("records a sale and rejects insufficient cash or holdings", () => {
    const state = readDemoState(storage);
    const next = executeDemoTrade(state, { action: "sell", accountId: "account-bet", assetId: "asset-otp", units: "1", price: "31000", date: "2026-10-04" });
    expect(next.cash.find((row) => row.accountId === "account-bet" && row.currency === "HUF")?.amount).toBe("781000");
    expect(next.positions.find((row) => row.accountId === "account-bet" && row.assetId === "asset-otp")?.units).toBe("29");
    expect(() => executeDemoTrade(state, { action: "buy", accountId: "account-bet", assetId: "asset-otp", units: "100", price: "34000" })).toThrowError("insufficient_cash");
    expect(() => executeDemoTrade(state, { action: "sell", accountId: "account-bet", assetId: "asset-otp", units: "100", price: "31000" })).toThrowError("insufficient_units");
  });

  it("persists and reloads only valid session data", () => {
    const next = executeDemoTrade(readDemoState(storage), { action: "buy", accountId: "account-bet", assetId: "asset-otp", units: "1", price: "32500", date: "2026-10-04" });
    writeDemoState(storage, next);
    expect(readDemoState(storage)).toEqual(next);
  });

  it("falls back to the seed for malformed session data and reset writes the seed", () => {
    storage.setItem("horizon.demo.v1", "{not-json");
    expect(readDemoState(storage)).toEqual(DEMO_SEED);
    const next = resetDemoState(storage);
    expect(next).toEqual(DEMO_SEED);
    expect(JSON.parse(storage.getItem("horizon.demo.v1")!)).toEqual(DEMO_SEED);
  });

  it("rejects structurally invalid session data", () => {
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ ...DEMO_SEED, cash: [{ accountId: "unknown", currency: "HUF", amount: "-1" }] }));
    expect(readDemoState(storage)).toEqual(DEMO_SEED);
  });

  it("uses the seed when browser storage is unavailable", () => {
    expect(readDemoState(null)).toEqual(DEMO_SEED);
    expect(writeDemoState(null, DEMO_SEED)).toBe(false);
  });

  it("falls back safely when browser storage throws", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readDemoState(blocked)).toEqual(DEMO_SEED);
    expect(writeDemoState(blocked, DEMO_SEED)).toBe(false);
  });
});
