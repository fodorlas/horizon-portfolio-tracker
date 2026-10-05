import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/result";

const challengeAndVerify = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { mfa: { listFactors: async () => ({ data: { totp: [{ id: "f1" }] }, error: null }), challengeAndVerify } } }),
}));
const { ExportPanel } = await import("./export-panel");

const file = { name: "horizon-export-2026-09-26.json", type: "application/json", content: "{}" };
const csv = { name: "horizon-transactions-2026-09-26.csv", type: "text/csv;charset=utf-8", content: "date\r\n" };
let clicked: string[] = [];

beforeEach(() => {
  clicked = [];
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("ExportPanel", () => {
  it("sends the chosen kind and downloads the returned file", async () => {
    const action = vi.fn<(fd: FormData) => Promise<ActionResult>>().mockResolvedValue({ ok: true, file });
    render(<ExportPanel action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Minden adat (JSON)" }));
    expect(await screen.findByText(`Letöltve: ${file.name}`)).toBeInTheDocument();
    expect((action.mock.calls[0][0] as FormData).get("kind")).toBe("json");
    expect(clicked).toEqual([file.name]);
  });

  it("a code older than 15 minutes asks for a fresh one first (step-up)", async () => {
    const action = vi.fn<(fd: FormData) => Promise<ActionResult>>().mockResolvedValueOnce({ ok: false, reauth: true }).mockResolvedValueOnce({ ok: true, file: csv });
    challengeAndVerify.mockResolvedValue({ error: null });
    render(<ExportPanel action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Könyvelési sorok (CSV)" }));
    const dialog = await screen.findByRole("dialog", { name: "Add meg újra a kódot" });
    expect(clicked).toEqual([]);
    await userEvent.type(within(dialog).getByLabelText("6 jegyű kód"), "123456");
    await userEvent.click(within(dialog).getByRole("button", { name: "Ellenőrzés és folytatás" }));
    await screen.findByText(`Letöltve: ${csv.name}`);
    expect((action.mock.calls[1][0] as FormData).get("kind")).toBe("transactions");
    expect(clicked).toEqual([csv.name]);
    // A CSV gets the UTF-8 BOM as bytes in front, so spreadsheets read the accents right.
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(csv.content)]);
  });
});
