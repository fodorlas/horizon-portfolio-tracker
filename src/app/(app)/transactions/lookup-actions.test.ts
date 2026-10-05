import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/lib/providers/http";

vi.mock("server-only", () => ({}));
// The session check is the guard's own concern (tests/auth); here only what the action does inside it.
vi.mock("@/lib/actions/guard", () => ({ guarded: (fn: () => unknown) => fn() }));
vi.mock("@/lib/entry/akk-source", () => ({ akkRows: vi.fn(), seriesKey: (s: string) => s }));
const sources = vi.hoisted(() => ({ betSource: vi.fn(), symbolSource: vi.fn(), searchMarket: vi.fn() }));
vi.mock("@/lib/entry/symbols", () => sources);

const { symbolInfo } = await import("./lookup-actions");

const fails = async () => {
  throw new ProviderError("http_5xx");
};

describe("symbolInfo", () => {
  beforeEach(() => {
    sources.betSource.mockReset().mockReturnValue({ papers: fails, history: fails });
    sources.symbolSource.mockReset().mockReturnValue({ info: fails, search: fails });
  });

  it("a BÉT that cannot be reached is the BÉT's error, Yahoo's is Yahoo's (#45)", async () => {
    expect(await symbolInfo("TESZTETF", "2026-09-28", "bet")).toEqual({ ok: false, formError: "betUnavailable" });
    expect(await symbolInfo("FAKEABC", "2026-09-28", "yahoo")).toEqual({ ok: false, formError: "yahooUnavailable" });
  });

  it("an unknown source asks no one (#45)", async () => {
    expect(await symbolInfo("OTP", "2026-09-28", "BET" as never)).toEqual({ ok: true, info: null });
    expect(sources.symbolSource).not.toHaveBeenCalled();
    expect(sources.betSource).not.toHaveBeenCalled();
  });
});
