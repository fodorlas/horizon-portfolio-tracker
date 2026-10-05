import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    // Load local test settings from .env.local when present.
    env: loadEnv(mode, process.cwd(), ""),
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "tests/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        // Runs against the local Supabase database; every scenario is rolled back.
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["tests/rls/**/*.test.ts", "tests/auth/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["**/*.test.ts", "**/__fixtures__/**", "src/lib/supabase/**", "src/lib/auth/server.ts"],
      // The finance core must stay ≥ 90% covered (plan §8).
      thresholds: { "src/lib/finance/**": { lines: 90, branches: 90, functions: 90, statements: 90 } },
    },
  },
}));
