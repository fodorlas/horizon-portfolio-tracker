import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/lib/providers/http";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/refresh/service", () => ({ realSources: () => false }));
// The invented BÉT, or one that cannot be reached.
const bet = vi.hoisted(() => ({ down: false }));
vi.mock("@/lib/refresh/fake", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/refresh/fake")>();
  return {
    ...actual,
    fakeBet: (today: string, wanted?: string[]) => {
      const source = actual.fakeBet(today, wanted);
      return bet.down ? { ...source, papers: async () => Promise.reject(new ProviderError("http_5xx")) } : source;
    },
  };
});
const { searchMarket } = await import("./symbols");

const TODAY = "2026-09-28";

describe("searchMarket: Tőzsdei papír keresése (spec 2026-09-28 §12/3)", () => {
  it("the BÉT first: a hit there is the answer", async () => {
    bet.down = false;
    const r = await searchMarket("betfakeq1", TODAY, "auto");
    expect(r).toMatchObject({ from: "bet", betDown: false });
    expect(r.hits).toEqual([{ symbol: "BETFAKEQ1", name: "BETFAKEQ1", exchange: "BÉT", assetClass: "stock", source: "bet" }]);
  });

  it("nothing on the BÉT: Yahoo's hits", async () => {
    bet.down = false;
    const r = await searchMarket("FAKEQ1", TODAY, "auto");
    expect(r).toMatchObject({ from: "yahoo", betDown: false });
    expect(r.hits.map((h) => [h.symbol, h.source])).toEqual([["FAKEQ1", "yahoo"]]);
  });

  it("asked for Yahoo: the BÉT is not searched", async () => {
    bet.down = false;
    expect(await searchMarket("betfakeq1", TODAY, "yahoo")).toEqual({ hits: [], from: "yahoo", betDown: false });
  });

  it("the BÉT cannot be reached: Yahoo's hits, and it says so", async () => {
    bet.down = true;
    const r = await searchMarket("FAKEQ2", TODAY, "auto");
    expect(r).toMatchObject({ from: "yahoo", betDown: true });
    expect(r.hits.map((h) => h.symbol)).toEqual(["FAKEQ2"]);
  });
});
