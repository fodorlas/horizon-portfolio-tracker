import { describe, expect, it } from "vitest";
import {
  STEP_UP_SECONDS,
  TOTP_FRESHNESS_SECONDS,
  evaluateSession,
  hasRecentStepUp,
  latestTotpAt,
  routeRequest,
  safeNextPath,
} from "./session-state";

const NOW = 1_790_000_000;
const user = { sub: "u1", session_id: "s1" };

describe("evaluateSession", () => {
  it("no claims → anonymous", () => {
    expect(evaluateSession(null, NOW)).toEqual({ kind: "anonymous" });
    expect(evaluateSession({}, NOW)).toEqual({ kind: "anonymous" });
  });

  it("password only (aal1) → needs TOTP", () => {
    const claims = { ...user, aal: "aal1", amr: [{ method: "password", timestamp: NOW - 10 }] };
    expect(evaluateSession(claims, NOW)).toEqual({ kind: "needs-totp", reason: "aal1" });
  });

  it("aal2 with a fresh TOTP → trusted", () => {
    const claims = { ...user, aal: "aal2", amr: [{ method: "totp", timestamp: NOW - 60 }, { method: "password", timestamp: NOW - 90 }] };
    expect(evaluateSession(claims, NOW)).toEqual({ kind: "trusted", totpAgeSeconds: 60 });
  });

  it("exactly 12 hours old is still trusted, one second more is stale", () => {
    const at = (age: number) => ({ ...user, aal: "aal2", amr: [{ method: "totp", timestamp: NOW - age }] });
    expect(evaluateSession(at(TOTP_FRESHNESS_SECONDS), NOW).kind).toBe("trusted");
    expect(evaluateSession(at(TOTP_FRESHNESS_SECONDS + 1), NOW)).toEqual({ kind: "needs-totp", reason: "stale" });
  });

  it("aal2 without any TOTP entry is not trusted", () => {
    const claims = { ...user, aal: "aal2", amr: [{ method: "password", timestamp: NOW }] };
    expect(evaluateSession(claims, NOW)).toEqual({ kind: "needs-totp", reason: "stale" });
  });

  it("uses the latest of several TOTP entries", () => {
    const claims = { ...user, aal: "aal2", amr: [{ method: "totp", timestamp: NOW - 50_000 }, { method: "totp", timestamp: NOW - 5 }] };
    expect(latestTotpAt(claims)).toBe(NOW - 5);
    expect(evaluateSession(claims, NOW).kind).toBe("trusted");
  });

  it("ignores legacy string amr entries", () => {
    expect(latestTotpAt({ ...user, aal: "aal2", amr: ["totp"] })).toBeNull();
  });

  it("clock skew (TOTP timestamp slightly in the future) counts as age 0", () => {
    const claims = { ...user, aal: "aal2", amr: [{ method: "totp", timestamp: NOW + 3 }] };
    expect(evaluateSession(claims, NOW)).toEqual({ kind: "trusted", totpAgeSeconds: 0 });
  });
});

describe("hasRecentStepUp", () => {
  const at = (age: number) => ({ ...user, aal: "aal2", amr: [{ method: "totp", timestamp: NOW - age }] });
  it("within 15 minutes → true, older → false", () => {
    expect(hasRecentStepUp(at(STEP_UP_SECONDS), NOW)).toBe(true);
    expect(hasRecentStepUp(at(STEP_UP_SECONDS + 1), NOW)).toBe(false);
    expect(hasRecentStepUp(null, NOW)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps same-site relative paths", () => {
    expect(safeNextPath("/positions?x=1")).toBe("/positions?x=1");
  });
  it("rejects absolute, protocol-relative and backslash URLs", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, undefined]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});

describe("routeRequest", () => {
  const anon = { kind: "anonymous" } as const;
  const stale = { kind: "needs-totp", reason: "stale" } as const;
  const trusted = { kind: "trusted", totpAgeSeconds: 10 } as const;
  const req = (pathname: string, extra: Partial<{ search: string; isServerAction: boolean; next: string | null }> = {}) => ({
    pathname, search: "", isServerAction: false, next: null, ...extra,
  });

  it("anonymous: only the login page, everything else goes there with next", () => {
    expect(routeRequest(anon, req("/login"))).toEqual({ kind: "pass" });
    expect(routeRequest(anon, req("/positions", { search: "?x=1" }))).toEqual({ kind: "redirect", to: "/login?next=%2Fpositions%3Fx%3D1" });
    expect(routeRequest(anon, req("/mfa"))).toEqual({ kind: "redirect", to: "/login?next=%2F" });
    expect(routeRequest(anon, req("/transactions/new", { isServerAction: true }))).toMatchObject({ kind: "redirect" });
  });

  it("stale TOTP: pages go to /mfa, server actions pass (they answer 'reauth' themselves)", () => {
    expect(routeRequest(stale, req("/transactions/new"))).toEqual({ kind: "redirect", to: "/mfa?next=%2Ftransactions%2Fnew" });
    expect(routeRequest(stale, req("/transactions/new", { isServerAction: true }))).toEqual({ kind: "pass" });
    expect(routeRequest(stale, req("/mfa"))).toEqual({ kind: "pass" });
    expect(routeRequest(stale, req("/login"))).toEqual({ kind: "redirect", to: "/mfa?next=%2F" });
  });

  it("trusted: login and MFA pages forward to a safe next path", () => {
    expect(routeRequest(trusted, req("/"))).toEqual({ kind: "pass" });
    expect(routeRequest(trusted, req("/mfa", { next: "/prices" }))).toEqual({ kind: "redirect", to: "/prices" });
    expect(routeRequest(trusted, req("/login", { next: "//evil.example" }))).toEqual({ kind: "redirect", to: "/" });
    expect(routeRequest(trusted, req("/login/forgot"))).toEqual({ kind: "redirect", to: "/" });
  });

  it("the forgotten-password page is for signed-out visitors; the e-mail link works in any state", () => {
    expect(routeRequest(anon, req("/login/forgot"))).toEqual({ kind: "pass" });
    expect(routeRequest(stale, req("/login/forgot"))).toEqual({ kind: "redirect", to: "/mfa?next=%2F" });
    for (const s of [anon, stale, trusted]) expect(routeRequest(s, req("/auth/confirm", { search: "?token_hash=x&type=recovery" }))).toEqual({ kind: "pass" });
  });

  it("unconfigured API routes are not public", () => {
    expect(routeRequest(anon, req("/api/other"))).toEqual({ kind: "redirect", to: "/login?next=%2Fapi%2Fother" });
  });

});
