import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const reset = vi.fn();
vi.mock("./actions", () => ({ requestPasswordReset: (...args: unknown[]) => reset(...args) }));
const { ForgotForm } = await import("./forgot-form");

describe("ForgotForm", () => {
  it("answers the same way whether or not the address is known", async () => {
    reset.mockResolvedValue({ status: "sent" });
    render(<ForgotForm />);
    await userEvent.type(screen.getByLabelText("E-mail-cím"), "valaki@example.hu");
    await userEvent.click(screen.getByRole("button", { name: "Link küldése" }));
    expect(await screen.findByText(/Ha a cím ismert, elküldtük a levelet/)).toBeInTheDocument();
    expect((reset.mock.calls[0][1] as FormData).get("email")).toBe("valaki@example.hu");
    expect(screen.getByRole("link", { name: "Vissza a belépéshez" })).toHaveAttribute("href", "/login");
  });
});
