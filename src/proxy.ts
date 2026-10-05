import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { evaluateSession, routeRequest, type SessionClaims } from "@/lib/auth/session-state";
import { readAppMode } from "@/lib/demo/config";
import { demoRequestDecision, demoSecurityPolicy } from "@/lib/demo/routing";

/**
 * Runs before every page request:
 *  1. a per-request CSP nonce,
 *  2. Supabase session refresh (cookies),
 *  3. routing between /login, /mfa and the app (plan §1.3).
 *
 * This is routing only. Whether data is visible is decided by RLS in the
 * database (owner membership, approved factor, TOTP freshness).
 */

function contentSecurityPolicy(nonce: string, supabaseUrl: string) {
  const isDev = process.env.NODE_ENV === "development";
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are needed by charts and Next's runtime; scripts stay strict.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${supabaseUrl}${isDev ? " ws:" : ""}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const { demo } = readAppMode(process.env);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  if (demo) {
    const decision = demoRequestDecision(request.nextUrl.pathname, true, request.method);
    const csp = demoSecurityPolicy(nonce, process.env.NODE_ENV === "development");
    if (decision.kind === "redirect") {
      const response = NextResponse.redirect(new URL(decision.to, request.url));
      response.headers.set("Content-Security-Policy", csp);
      return response;
    }
    if (decision.kind === "block") {
      const response = NextResponse.json({ error: "demo_read_only" }, { status: 405 });
      response.headers.set("Content-Security-Policy", csp);
      return response;
    }
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }
  const csp = contentSecurityPolicy(nonce, supabaseUrl);
  const demoDecision = demoRequestDecision(request.nextUrl.pathname, false);
  if (demoDecision.kind === "redirect") {
    const response = NextResponse.redirect(new URL(demoDecision.to, request.url));
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Verifies the JWT (JWKS) and refreshes it when needed.
  const { data } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? null) as SessionClaims | null;
  const state = evaluateSession(claims, Math.floor(Date.now() / 1000));

  const decision = routeRequest(state, {
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    isServerAction: request.method === "POST" && request.headers.has("next-action"),
    next: request.nextUrl.searchParams.get("next"),
  });
  if (decision.kind === "pass") return withSecurityHeaders(response, csp);

  const res = NextResponse.redirect(new URL(decision.to, request.url));
  // Keep refreshed auth cookies on redirects too.
  for (const c of response.cookies.getAll()) res.cookies.set(c);
  return withSecurityHeaders(res, csp);
}

function withSecurityHeaders(res: NextResponse, csp: string) {
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
