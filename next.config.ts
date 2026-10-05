import type { NextConfig } from "next";
import { readAppMode } from "./src/lib/demo/config";

// Validate before build output is produced or the server starts.
readAppMode(process.env);

// Baseline security headers. The nonce-based Content-Security-Policy arrives
// in phase 1 together with the auth proxy (plan §1, §9).
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
