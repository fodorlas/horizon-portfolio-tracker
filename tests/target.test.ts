import { describe, expect, it } from "vitest";
import { requireLocal, testTarget } from "./target";

describe("testTarget", () => {
  it("allows local Supabase API and database addresses", () => {
    expect(testTarget("postgresql://postgres:postgres@127.0.0.1:54322/postgres")).toBe("local");
    expect(testTarget("http://127.0.0.1:54321")).toBe("local");
    expect(testTarget("http://localhost:54321")).toBe("local");
    expect(testTarget("http://[::1]:54321")).toBe("local");
  });

  it("refuses remote Supabase hosts, look-alikes, malformed and missing addresses", () => {
    for (const address of ["https://example.supabase.co", "http://127.0.0.1.example.com:54321", "http://localhost.example.com", "not a url"]) {
      expect(() => testTarget(address)).toThrow(/local Supabase/);
    }
    expect(() => testTarget(undefined)).toThrow(/not set/);
    expect(() => testTarget("")).toThrow(/not set/);
  });
});

describe("requireLocal", () => {
  it("accepts loopback and refuses all remote or missing addresses", () => {
    expect(() => requireLocal("http://127.0.0.1:54321")).not.toThrow();
    expect(() => requireLocal("https://example.supabase.co")).toThrow(/local Supabase/);
    expect(() => requireLocal(undefined)).toThrow(/not set/);
  });
});
