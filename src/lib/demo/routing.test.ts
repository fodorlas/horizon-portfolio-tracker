import { describe, expect, it } from "vitest";
import { demoRequestDecision, demoSecurityPolicy } from "./routing";

describe("demoRequestDecision", () => {
  it("uses the real Horizon pages in read-only demo mode", () => {
    for (const path of ["/", "/positions", "/transactions", "/accounts", "/instruments", "/prices", "/settings", "/transactions/new", "/transactions/advanced"]) {
      expect(demoRequestDecision(path, true), path).toEqual({ kind: "pass" });
    }
  });

  it("keeps authentication, APIs, and unknown pages outside demo mode", () => {
    expect(demoRequestDecision("/demo", true)).toEqual({ kind: "redirect", to: "/" });
    expect(demoRequestDecision("/login", true)).toEqual({ kind: "redirect", to: "/" });
    expect(demoRequestDecision("/api/refresh", true)).toEqual({ kind: "redirect", to: "/" });
    expect(demoRequestDecision("/unknown", true)).toEqual({ kind: "redirect", to: "/" });
  });

  it("blocks every write request in demo mode", () => {
    expect(demoRequestDecision("/", true, "POST")).toEqual({ kind: "block" });
    expect(demoRequestDecision("/transactions", true, "POST")).toEqual({ kind: "block" });
    expect(demoRequestDecision("/demo/reset", true, "POST")).toEqual({ kind: "pass" });
  });

  it("hides the demo route when live mode is selected", () => {
    expect(demoRequestDecision("/demo", false)).toEqual({ kind: "redirect", to: "/" });
    expect(demoRequestDecision("/demo/reset", false, "POST")).toEqual({ kind: "redirect", to: "/" });
    expect(demoRequestDecision("/positions", false)).toEqual({ kind: "pass" });
  });
});

describe("demoSecurityPolicy", () => {
  it("allows connections only to the app origin", () => {
    expect(demoSecurityPolicy("nonce", false)).toContain("connect-src 'self'");
    expect(demoSecurityPolicy("nonce", false)).not.toMatch(/supabase|https?:/i);
    expect(demoSecurityPolicy("nonce", false)).not.toContain("upgrade-insecure-requests");
  });
});
