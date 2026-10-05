import { describe, expect, it } from "vitest";
import { localeForMode } from "./prefs-shared";

describe("localeForMode", () => {
  it("uses English for a demo without a stored language and Hungarian for live mode", () => {
    expect(localeForMode(undefined, true)).toBe("en");
    expect(localeForMode(undefined, false)).toBe("hu");
  });

  it("uses the demo default regardless of live preference cookies", () => {
    expect(localeForMode("hu", true)).toBe("en");
  });

  it("keeps a valid stored language in live mode", () => {
    expect(localeForMode("en", false)).toBe("en");
  });

  it("ignores invalid stored values", () => {
    expect(localeForMode("fr", true)).toBe("en");
    expect(localeForMode("fr", false)).toBe("hu");
  });
});
