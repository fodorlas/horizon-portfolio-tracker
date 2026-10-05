/** The export stays Hungarian whatever the UI language (spec 2026-10-01 §2.2). */
import { describe, expect, it, vi } from "vitest";
import type { Loaded } from "@/lib/data/load";
import { D } from "@/lib/finance/money";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/guard", () => ({ guarded: (fn: () => unknown) => fn(), formFields: vi.fn(), zodErrors: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/prefs", () => ({ getPrefs: async () => ({ currency: "HUF", privacy: false, theme: "system", locale: "en" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name === "horizon_lang" ? { name, value: "en" } : undefined) }) }));
vi.mock("@/lib/data/load", () => ({ loadPortfolio: vi.fn() }));

import { loadPortfolio } from "@/lib/data/load";
import { exportData } from "./actions";

// Invented: one account, one deposit.
const data = {
  institutions: [{ id: "B1", name: "Példa Bróker" }],
  accountMeta: [{ id: "A1", institution_id: "B1", name: "Fő" }],
  instrumentMeta: [],
  events: [
    {
      id: "e1", type: "deposit", date: "2026-02-01", createdAt: "2026-02-01T10:00:00Z", correctionKind: null, splitRatio: null, note: null,
      lines: [{ id: "l1", kind: "cash", accountId: "A1", instrumentId: null, currency: "EUR", amount: new D("100"), role: "external", costAmount: null, costEstimated: false, costFxRefs: null }],
    },
  ],
} as unknown as Loaded;

describe("exportData with the English UI", () => {
  it("writes the Hungarian event type names", async () => {
    vi.mocked(loadPortfolio).mockResolvedValue(data);
    const fd = new FormData();
    fd.set("kind", "transactions");
    const r = await exportData(fd);
    expect(r.ok).toBe(true);
    const content = r.ok ? (r.file?.content ?? "") : "";
    expect(content).toContain(",deposit,Befizetés,");
    expect(content).not.toContain("Deposit");
  });
});
