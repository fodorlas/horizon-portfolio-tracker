import { describe, expect, it } from "vitest";
import { ENTRY_AUTO_VALUE_NOTE, ENTRY_VALUE_NOTE } from "@/lib/entry/build";
import { i18nFor } from "@/lib/i18n";
import { OPENING_PRICE_NOTE, OPENING_VALUE_NOTE } from "@/lib/tx/build";
import { noteText } from "./notes";

describe("noteText: the app's own notes in the UI language (spec 2026-10-01 §2.3)", () => {
  it("Hungarian: exactly the stored text", () => {
    const { m } = i18nFor("hu");
    for (const n of [ENTRY_VALUE_NOTE, ENTRY_AUTO_VALUE_NOTE, OPENING_PRICE_NOTE, OPENING_VALUE_NOTE]) expect(noteText(n, m)).toBe(n);
  });

  it("English: the four in English", () => {
    const { m } = i18nFor("en");
    expect(noteText(OPENING_PRICE_NOTE, m)).toBe("Opening price (opening balance)");
    expect(noteText(OPENING_VALUE_NOTE, m)).toBe("Opening value (opening balance)");
    expect(noteText(ENTRY_VALUE_NOTE, m)).toBe("Entry: new total given");
    expect(noteText(ENTRY_AUTO_VALUE_NOTE, m)).toBe("Entry: previous value ± deposit/withdrawal");
  });

  it("the owner's own notes as written, none as empty", () => {
    const { m } = i18nFor("en");
    expect(noteText("Kimutatás szerint", m)).toBe("Kimutatás szerint");
    expect(noteText(null, m)).toBe("");
  });
});
