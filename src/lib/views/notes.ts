/**
 * The notes the app writes itself (spec 2026-10-01 §2.3): stored in Hungarian,
 * recognised by their text (views/entries.ts), shown in the UI language.
 */
import { ENTRY_AUTO_VALUE_NOTE, ENTRY_VALUE_NOTE } from "@/lib/entry/build";
import type { Messages } from "@/lib/i18n";
import { OPENING_PRICE_NOTE, OPENING_VALUE_NOTE } from "@/lib/tx/build";

const KEYS: Record<string, keyof Messages["notes"]> = {
  [OPENING_PRICE_NOTE]: "openingPrice",
  [OPENING_VALUE_NOTE]: "openingValue",
  [ENTRY_VALUE_NOTE]: "entryValue",
  [ENTRY_AUTO_VALUE_NOTE]: "entryAutoValue",
};

export function noteText(note: string | null, m: Messages): string {
  if (note === null) return "";
  const key = KEYS[note];
  return key ? m.notes[key] : note;
}
