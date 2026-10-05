import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the password-reset e-mail link lands (plan §1.6 A).
 *
 *  - `code`: the reset was requested in the app (PKCE). Supabase verified the
 *    e-mail token and sends a one-time code; exchanging it needs the verifier
 *    cookie, so the link works only in the browser that asked for it.
 *  - `token_hash` + `type=recovery`: the same, for a custom e-mail template
 *    (needs own SMTP on the free plan) and for the e2e test (admin link).
 *
 * Either way the result is a password-only (aal1) session: the TOTP step comes
 * next, and only then the new password (stricter than the plan's order).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code") ?? "";
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const valid = (v: string) => /^[A-Za-z0-9_-]{16,200}$/.test(v);

  const supabase = await createClient();
  let ok = false;
  if (valid(code)) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (url.searchParams.get("type") === "recovery" && valid(tokenHash)) {
    ok = !(await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash })).error;
  }
  const to = ok ? `/mfa?next=${encodeURIComponent("/settings/password")}` : "/login?error=link";
  return NextResponse.redirect(new URL(to, url.origin));
}
