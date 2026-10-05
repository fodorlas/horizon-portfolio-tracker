import { describe, expect, it } from "vitest";
import { readAppMode } from "./config";

describe("readAppMode", () => {
  it("keeps live mode as the default", () => {
    expect(readAppMode({})).toEqual({ demo: false });
  });

  it("enables demo mode only for the exact true value", () => {
    expect(readAppMode({ DEMO_MODE: "true" })).toEqual({ demo: true });
    expect(readAppMode({ DEMO_MODE: "1" })).toEqual({ demo: false });
  });

  it("rejects a client demo flag without the server demo flag", () => {
    expect(() => readAppMode({ NEXT_PUBLIC_DEMO_MODE: "true" })).toThrow(/DEMO_MODE.*server/i);
  });

  it("rejects demo mode when a Supabase or database connection value is set", () => {
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_TEST_DB_URL", "DATABASE_URL", "POSTGRES_URL_NON_POOLING"]) {
      expect(() => readAppMode({ DEMO_MODE: "true", [name]: "configured" })).toThrow(/demo mode.*supabase/i);
    }
  });

  it("does not include configured values in its error", () => {
    let thrown: unknown;
    try {
      readAppMode({ DEMO_MODE: "true", NEXT_PUBLIC_SUPABASE_URL: "do-not-print-this" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain("do-not-print-this");
  });

  it("accepts empty Supabase variables in demo mode", () => {
    expect(readAppMode({ DEMO_MODE: "true", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_TEST_DB_URL: "  " })).toEqual({ demo: true });
  });
});
