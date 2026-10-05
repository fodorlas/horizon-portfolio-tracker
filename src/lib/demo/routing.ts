export type DemoRequestDecision = { kind: "pass" } | { kind: "block" } | { kind: "redirect"; to: "/" };

const READ_ONLY_PAGES = new Set([
  "/",
  "/positions",
  "/transactions",
  "/transactions/new",
  "/transactions/advanced",
  "/accounts",
  "/instruments",
  "/prices",
  "/settings",
]);

/** Keep public demo requests on the real read-only Horizon pages and sample data. */
export function demoRequestDecision(pathname: string, demo: boolean, method = "GET"): DemoRequestDecision {
  if (demo) {
    if (pathname === "/demo") return { kind: "redirect", to: "/" };
    if (pathname === "/demo/reset") return method === "POST" ? { kind: "pass" } : { kind: "redirect", to: "/" };
    if (method !== "GET" && method !== "HEAD") return { kind: "block" };
    const entryEdit = /^\/transactions\/[^/]+\/edit$/.test(pathname);
    return READ_ONLY_PAGES.has(pathname) || entryEdit ? { kind: "pass" } : { kind: "redirect", to: "/" };
  }
  return pathname === "/demo" || pathname.startsWith("/demo/") ? { kind: "redirect", to: "/" } : { kind: "pass" };
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
  ].join("; ");
}
