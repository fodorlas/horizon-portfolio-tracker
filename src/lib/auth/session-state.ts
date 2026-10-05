/**
 * Session states (plan §1.3). Pure, so the routing rule is unit-tested.
 *
 * The database has the final word (RLS: approved factor, owner membership);
 * this only decides where to send the browser.
 */

/** A TOTP verification older than this needs a fresh code (plan §1.1). */
export const TOTP_FRESHNESS_SECONDS = 12 * 60 * 60;
/** Sensitive actions (export, factor management, …) need a code this recent. */
export const STEP_UP_SECONDS = 15 * 60;

export type AmrEntry = { method: string; timestamp: number };

export type SessionClaims = {
  sub?: string;
  aal?: string;
  amr?: AmrEntry[] | string[];
  session_id?: string;
};

export type SessionState =
  | { kind: "anonymous" }
  | { kind: "needs-totp"; reason: "aal1" | "stale" }
  | { kind: "trusted"; totpAgeSeconds: number };

/** Unix seconds of the latest TOTP verification in the token, if any. */
export function latestTotpAt(claims: SessionClaims): number | null {
  const amr = claims.amr ?? [];
  let latest: number | null = null;
  for (const entry of amr) {
    if (typeof entry === "object" && entry.method === "totp" && Number.isFinite(entry.timestamp)) {
      latest = latest === null ? entry.timestamp : Math.max(latest, entry.timestamp);
    }
  }
  return latest;
}

export function evaluateSession(claims: SessionClaims | null, nowSeconds: number): SessionState {
  if (!claims?.sub) return { kind: "anonymous" };
  if (claims.aal !== "aal2") return { kind: "needs-totp", reason: "aal1" };

  const totpAt = latestTotpAt(claims);
  // aal2 without a TOTP entry cannot come from our only factor type: treat as stale.
  if (totpAt === null) return { kind: "needs-totp", reason: "stale" };

  const age = nowSeconds - totpAt;
  if (age > TOTP_FRESHNESS_SECONDS) return { kind: "needs-totp", reason: "stale" };
  return { kind: "trusted", totpAgeSeconds: Math.max(0, age) };
}

/** True when the last TOTP verification is recent enough for a sensitive action. */
export function hasRecentStepUp(claims: SessionClaims | null, nowSeconds: number): boolean {
  const state = evaluateSession(claims, nowSeconds);
  return state.kind === "trusted" && state.totpAgeSeconds <= STEP_UP_SECONDS;
}

/** Only same-site relative paths are allowed as post-login destinations. */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export type RouteDecision = { kind: "pass" } | { kind: "redirect"; to: string };

export const ROUTES = {
  login: "/login",
  mfa: "/mfa",
  /** Only for signed-out visitors: a signed-in session is sent on. */
  signedOutOnly: ["/login", "/login/forgot"],
  /**
   * Reachable in any state: the e-mail link that starts a password reset and
   * the public privacy page.
   */
  open: ["/auth/confirm"],
};

/**
 * Where the proxy sends a request (plan §1.3).
 *
 * A server action call (POST with a Next-Action header) from a session whose
 * TOTP went stale is let through: the action answers "reauth", the page opens
 * the code dialog and resubmits, so the filled-in form is not lost. The action
 * itself refuses the work (requireTrustedSession) and RLS refuses the data.
 */
export function routeRequest(
  state: SessionState,
  req: { pathname: string; search: string; isServerAction: boolean; next: string | null },
  routes = ROUTES,
): RouteDecision {
  const here = req.pathname + req.search;
  const signedOutOnly = routes.signedOutOnly.includes(req.pathname);
  const isMfa = req.pathname === routes.mfa;

  if (routes.open.includes(req.pathname)) return { kind: "pass" };
  if (state.kind === "anonymous") {
    if (signedOutOnly) return { kind: "pass" };
    return { kind: "redirect", to: `${routes.login}?next=${encodeURIComponent(isMfa ? "/" : here)}` };
  }
  if (state.kind === "needs-totp") {
    if (isMfa || (req.isServerAction && !signedOutOnly)) return { kind: "pass" };
    return { kind: "redirect", to: `${routes.mfa}?next=${encodeURIComponent(signedOutOnly ? "/" : here)}` };
  }
  // Trusted: login and MFA pages have nothing more to do.
  if (signedOutOnly || isMfa) return { kind: "redirect", to: safeNextPath(req.next) };
  return { kind: "pass" };
}
