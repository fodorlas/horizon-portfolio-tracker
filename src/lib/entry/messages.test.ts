import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { i18nFor } from "@/lib/i18n";

const { m } = i18nFor("hu");

/** Every error code the 4c code can return has a Hungarian text (messages.errors). */
const SOURCES = ["src/lib/entry/build.ts", "src/lib/actions/db-error.ts", "src/app/(app)/transactions/actions.ts", "src/app/(app)/transactions/lookup-actions.ts",
  "src/app/(app)/accounts/actions.ts", "src/app/(app)/instruments/actions.ts", "src/app/(app)/pending-actions.ts"];

describe("error texts", () => {
  it("exist for every code the entry builder and the 4c actions use", () => {
    const codes = new Set<string>();
    for (const f of SOURCES) {
      const src = readFileSync(path.join(process.cwd(), f), "utf8");
      for (const x of src.matchAll(/fail\([^,]+,\s*"([a-zA-Z]+)"\)/g)) codes.add(x[1]);
      for (const x of src.matchAll(/formError: "([a-zA-Z]+)"/g)) codes.add(x[1]);
      for (const x of src.matchAll(/errors: \{ [a-zA-Z.]+: "([a-zA-Z]+)" \}/g)) codes.add(x[1]);
    }
    expect(codes.size).toBeGreaterThan(20);
    const missing = [...codes].filter((c) => !(c in m.errors));
    expect(missing).toEqual([]);
  });
});
