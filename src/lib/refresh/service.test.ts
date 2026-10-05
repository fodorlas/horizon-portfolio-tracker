import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { realSources } = await import("./service");

describe("which sources answer", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses sample sources by default", () => {
    vi.stubEnv("HORIZON_LIVE_PROJECT_REF", "");
    expect(realSources("https://sampleproject123.supabase.co")).toBe(false);
  });

  it("enables real sources only for the explicitly configured project host", () => {
    vi.stubEnv("HORIZON_LIVE_PROJECT_REF", "sampleproject123");
    expect(realSources("https://sampleproject123.supabase.co")).toBe(true);
    expect(realSources("https://otherproject456.supabase.co")).toBe(false);
    expect(realSources("https://sampleproject123.supabase.co.evil.example")).toBe(false);
    expect(realSources("http://localhost:54321")).toBe(false);
    expect(realSources("not a url")).toBe(false);
  });
});
