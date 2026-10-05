import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/result";
import type { RefreshSummary } from "@/lib/refresh/run";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { mfa: {} } }) }));
const { RefreshButton } = await import("./refresh-button");

const src = (source: "MNB" | "ECB" | "yahoo" | "bet", inserted: number, extra: Partial<RefreshSummary["sources"][number]> = {}) => ({
  source, items: 2, inserted, suspect: 0, unchecked: 0, errors: 0, skipped: 0, ...extra,
});
const run = async (summary: Partial<RefreshSummary>) => {
  const refresh: RefreshSummary = { runId: "r", sources: [], continued: 0, errors: [], splitWarnings: [], ...summary };
  render(<RefreshButton action={async (): Promise<ActionResult> => ({ ok: true, refresh })} lastAt={null} />);
  await userEvent.click(screen.getByRole("button", { name: "Frissítés" }));
};

describe("RefreshButton – what the owner needs to know, in one sentence", () => {
  it("new FX rates (MNB) and new prices; the ECB check and item counts stay on the prices page", async () => {
    await run({ sources: [src("MNB", 14), src("ECB", 30), src("yahoo", 3)] });
    expect(await screen.findByText("Frissítve: 14 új devizaárfolyam, 3 új ár.")).toBeInTheDocument();
    expect(screen.queryByText(/MNB|ECB|tétel/)).toBeNull();
    expect(screen.getByRole("link", { name: "Részletek az Árak oldalon" })).toHaveAttribute("href", "/prices");
  });

  it("nothing new: up to date", async () => {
    await run({ sources: [src("MNB", 0)] });
    expect(await screen.findByText("Minden naprakész.")).toBeInTheDocument();
  });

  it("BÉT prices count as prices; a BÉT failure names the BÉT", async () => {
    await run({ sources: [src("yahoo", 2), src("bet", 5)], errors: [{ source: "bet", item: "X", name: "ETFCETOPOTP", message: "http_5xx" }] });
    expect(await screen.findByText("Frissítve: 0 új devizaárfolyam, 7 új ár.")).toBeInTheDocument();
    expect(screen.getByText(/^BÉT, ETFCETOPOTP:/)).toBeInTheDocument();
  });

  it("failures and what to do still show", async () => {
    await run({ sources: [src("yahoo", 0)], errors: [{ source: "yahoo", item: "X", name: "Példa", message: "timeout" }], continued: 2 });
    expect(await screen.findByText(/Példa/)).toBeInTheDocument();
    expect(screen.getByText("2 tétel a következő frissítéssel folytatódik.")).toBeInTheDocument();
  });
});
