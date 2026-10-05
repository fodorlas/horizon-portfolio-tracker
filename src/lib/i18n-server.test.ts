import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));

import { i18nFor } from "./i18n";
import { formLocale, getI18n } from "./i18n-server";
import { LANG_COOKIE } from "./prefs-shared";

beforeEach(() => jar.clear());

describe("getI18n", () => {
  it("the request's language: Hungarian without the cookie", async () => {
    expect(await getI18n()).toBe(i18nFor("hu"));
  });
});

describe("formLocale: the language the form was filled in (spec 2026-10-01 §2.5)", () => {
  it("the form's own field wins over the cookie", async () => {
    jar.set(LANG_COOKIE, "hu");
    const fd = new FormData();
    fd.set("inputLocale", "en");
    expect(await formLocale(fd)).toBe("en");
  });

  it("without a valid field: the cookie's language", async () => {
    jar.set(LANG_COOKIE, "en");
    const fd = new FormData();
    fd.set("inputLocale", "xx");
    expect(await formLocale(fd)).toBe("en");
    expect(await formLocale(new FormData())).toBe("en");
  });
});
