import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CurrencySwitcher } from "./currency-switcher";
import { PrivacyToggle } from "./privacy-toggle";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

describe("CurrencySwitcher", () => {
  it("offers HUF, EUR and USD, marks the current one and sends the choice", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(<CurrencySwitcher current="HUF" action={action} />);
    const group = screen.getByRole("group", { name: "Kijelzési deviza" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "HUF" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "USD" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByRole("button", { name: "EUR" }));
    expect(screen.getByRole("button", { name: "EUR" })).toHaveAttribute("aria-pressed", "true");
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect((action.mock.calls[0][0] as FormData).get("currency")).toBe("EUR");
  });
});

describe("PrivacyToggle", () => {
  it("blurs amounts via the html attribute and remembers it in a cookie", async () => {
    render(<PrivacyToggle initial={false} />);
    const eye = screen.getByRole("button", { name: "Összegek elrejtése" });
    expect(eye).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(eye);
    expect(eye).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveAttribute("data-private");
    expect(document.cookie).toContain("horizon_private=1");

    await userEvent.click(eye);
    expect(document.documentElement).not.toHaveAttribute("data-private");
    expect(document.cookie).toContain("horizon_private=0");
  });
});
