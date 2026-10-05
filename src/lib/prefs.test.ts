import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));

import { getPrefs } from "./prefs";
import { LANG_COOKIE } from "./prefs-shared";

describe("getPrefs: the UI language (spec 2026-10-01 §3.2)", () => {
  beforeEach(() => jar.clear());

  it("Hungarian without the cookie", async () => {
    expect((await getPrefs()).locale).toBe("hu");
  });

  it("Hungarian for any value not offered", async () => {
    for (const v of ["", "xx", "HU", "EN"]) {
      jar.set(LANG_COOKIE, v);
      expect((await getPrefs()).locale, v).toBe("hu");
    }
  });

  it("the cookie's own language when it is offered", async () => {
    jar.set(LANG_COOKIE, "hu");
    expect((await getPrefs()).locale).toBe("hu");
  });

  it("English when the cookie says so", async () => {
    jar.set(LANG_COOKIE, "en");
    expect((await getPrefs()).locale).toBe("en");
  });
});
