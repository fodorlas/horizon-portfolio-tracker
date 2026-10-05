import { existsSync, readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const localKeys = existsSync(".env.local")
  ? readFileSync(".env.local", "utf8").split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      return match ? [match[1]] : [];
    })
  : [];
const childEnv: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
childEnv.DEMO_MODE = "true";
childEnv.NEXT_PUBLIC_DEMO_MODE = "true";
for (const name of new Set([...Object.keys(process.env), ...localKeys])) {
  if (/^(?:NEXT_PUBLIC_SUPABASE_|SUPABASE_)/.test(name) || /^(?:DATABASE_URL|DB_URL|POSTGRES_URL|POSTGRES_PRISMA_URL|POSTGRES_URL_NON_POOLING|DIRECT_URL)$/.test(name)) {
    childEnv[name] = "";
  }
}

const baseURL = "http://127.0.0.1:3101";

export default defineConfig({
  testDir: "./tests/demo",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 }, baseURL, trace: "retain-on-failure" },
  webServer: {
    command: `npm run build -- --webpack && npx next start -H 127.0.0.1 -p 3101`,
    url: `${baseURL}/demo`,
    env: childEnv,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
