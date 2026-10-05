/**
 * The language boundaries (spec 2026-10-01 §3.6): only the language module
 * reads the dictionaries, only the formatters name a display locale, and
 * the page language comes from the request.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "__fixtures__" ? [] : sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
const SRC = sources(path.join(root, "src"));
const rel = (f: string) => path.relative(root, f);
const containing = (re: RegExp) => SRC.filter((f) => re.test(readFileSync(f, "utf8"))).map(rel).sort();

describe("language boundaries", () => {
  it("only src/lib/i18n.ts reads the dictionaries", () => {
    expect(containing(/messages\/[a-z]+\.json/)).toEqual(["src/lib/i18n.ts"]);
  });

  it("only src/lib/format.ts names a display locale", () => {
    expect(containing(/"hu-HU"|"en-GB"\s*\}/)).toEqual(["src/lib/format.ts"]);
  });

  it("the page language comes from the request", () => {
    expect(readFileSync(path.join(root, "src/app/layout.tsx"), "utf8")).not.toMatch(/\blang="/);
  });
});
