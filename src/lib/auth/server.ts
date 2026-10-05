import "server-only";
import { createClient } from "@/lib/supabase/server";
import { evaluateSession, hasRecentStepUp, type SessionClaims, type SessionState } from "./session-state";

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function readClaims(): Promise<SessionClaims | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims ?? null) as SessionClaims | null;
}

export async function getSessionState(): Promise<SessionState> {
  return evaluateSession(await readClaims(), nowSeconds());
}

export class ReauthRequired extends Error {
  constructor(readonly stepUp: boolean) {
    super("reauth_required");
  }
}

/**
 * First line of defence for server actions and route handlers (plan §1.5):
 * rejects early with a clear error. RLS still enforces the same rule in the
 * database, so skipping this call could never expose data.
 */
export async function requireTrustedSession(opts: { stepUp?: boolean } = {}) {
  const claims = await readClaims();
  const state = evaluateSession(claims, nowSeconds());
  if (state.kind !== "trusted") throw new ReauthRequired(false);
  if (opts.stepUp && !hasRecentStepUp(claims, nowSeconds())) throw new ReauthRequired(true);
  return claims as SessionClaims & { sub: string };
}
