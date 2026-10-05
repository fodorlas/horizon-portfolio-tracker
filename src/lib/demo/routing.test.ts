import { describe, expect, it } from "vitest";
import { demoRequestDecision, demoSecurityPolicy } from "./routing";

describe("demoRequestDecision", () => {
  it("sends the demo root and every live app route to the isolated demo page", () => {
    expect(demoRequestDecision("/", true)).toEqual({ kind: "redirect", to: "/demo" });
    expect(demoRequestDecision("/transactions/new", true)).toEqual({ kind: "redirect", to: "/demo" });
  });

  it("allows only the demo page in demo mode", () => {
    expect(demoRequestDecision("/demo", true)).toEqual({ kind: "pass" });
    expect(demoRequestDecision("/api/refresh", true)).toEqual({ kind: "redirect", to: "/demo" });
  });

  it("hides the demo route when live mode is selected", () => {
    expect(demoRequestDecision("/demo", false)).toEqual({ kind: "redirect", to: "/" });
    expect(demoRequestDecision("/positions", false)).toEqual({ kind: "pass" });
  });
});

describe("demoSecurityPolicy", () => {
  it("allows connections only to the app origin", () => {
    expect(demoSecurityPolicy("nonce", false)).toContain("connect-src 'self'");
    expect(demoSecurityPolicy("nonce", false)).not.toMatch(/supabase|https?:/i);
  });
});
