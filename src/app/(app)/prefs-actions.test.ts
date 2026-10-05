import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/guard", () => ({ guarded: (fn: () => unknown) => fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));

import { LANG_COOKIE } from "@/lib/prefs-shared";
import { setLanguage } from "./prefs-actions";

const form = (v: string) => {
  const fd = new FormData();
  fd.set("language", v);
  return fd;
};

describe("setLanguage (spec 2026-10-01 §3.2)", () => {
  beforeEach(() => set.mockClear());

  it("saves an offered language in the cookie, like the theme", async () => {
    expect(await setLanguage(form("en"))).toEqual({ ok: true });
    expect(set).toHaveBeenCalledWith(LANG_COOKIE, "en", expect.objectContaining({ path: "/", sameSite: "lax", httpOnly: true }));
  });

  it("refuses anything else", async () => {
    expect(await setLanguage(form("de"))).toEqual({ ok: false, formError: "invalid" });
    expect(set).not.toHaveBeenCalled();
  });
});
