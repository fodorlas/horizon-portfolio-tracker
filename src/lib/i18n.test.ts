import { describe, expect, it } from "vitest";
import { fill, i18nFor } from "./i18n";

describe("i18nFor (spec 2026-10-01 §3)", () => {
  it("Hungarian: the dictionary, fill and the formatters with the dictionary's words", () => {
    const i = i18nFor("hu");
    expect(i.locale).toBe("hu");
    expect(i.m.nav.positions).toBe("Pozíciók");
    expect(i.fill).toBe(fill);
    // 14:02 in Budapest (CEST), the same Budapest day.
    expect(i.f.moment("2026-09-26T12:02:00Z", new Date("2026-09-26T15:00:00Z"))).toBe("ma 14:02");
    expect(i.f.greeting(new Date("2026-09-26T05:30:00Z"))).toBe("Jó reggelt!");
  });

  it("is built once per language", () => {
    expect(i18nFor("hu")).toBe(i18nFor("hu"));
  });

  it("English: its own dictionary and formatters", () => {
    const i = i18nFor("en");
    expect(i.locale).toBe("en");
    expect(i.m.nav.positions).toBe("Positions");
    expect(i.f.day("2026-09-27")).toBe("27 Sept 2026");
    expect(i18nFor("en")).not.toBe(i18nFor("hu"));
  });
});
