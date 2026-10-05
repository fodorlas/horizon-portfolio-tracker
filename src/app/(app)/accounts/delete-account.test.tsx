import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/result";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { mfa: {} } }) }));
const { DeleteAccount } = await import("./delete-account");

describe("DeleteAccount – everything on the account, after its name is typed", () => {
  it("shows what goes and deletes only after the name matches", async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));
    render(<DeleteAccount accountId="A" name="Részvényszámla" summary={{ entries: 3, events: 1, values: 2, transfers: 1, lastOfBroker: true, instruments: ["Hold", "OTP"] }} action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Részvényszámla törlése" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Törlődik: 3 tétel, 1 haladó művelet és 2 kézi érték.");
    expect(dialog).toHaveTextContent("Az átvezetések a másik számláról is törlődnek (1 db).");
    expect(dialog).toHaveTextContent("A bróker is törlődik");
    expect(dialog).toHaveTextContent("Ezek az eszközök is törlődnek az áraikkal együtt, mert máshol nincs tételük: Hold, OTP.");

    const submit = screen.getByRole("button", { name: "Végleges törlés" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/írd be a számla nevét/), "Részvény");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/írd be a számla nevét/), "számla ");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    const fd = (action.mock.calls[0] as unknown as [FormData])[0];
    expect([fd.get("id"), fd.get("confirmName")]).toEqual(["A", "Részvényszámla "]);
  });
});
