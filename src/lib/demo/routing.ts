export type DemoRequestDecision = { kind: "pass" } | { kind: "redirect"; to: "/" | "/demo" };

/** Keep all Supabase-backed pages and handlers outside the demo request path. */
export function demoRequestDecision(pathname: string, demo: boolean): DemoRequestDecision {
  if (demo) return pathname === "/demo" ? { kind: "pass" } : { kind: "redirect", to: "/demo" };
  return pathname === "/demo" ? { kind: "redirect", to: "/" } : { kind: "pass" };
}

/** A demo response has no external connection source in its policy. */
export function demoSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
