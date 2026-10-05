import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const signIn = vi.fn();
vi.mock("./actions", () => ({ signIn: (...args: unknown[]) => signIn(...args) }));

const { LoginForm } = await import("./login-form");

describe("LoginForm", () => {
  it("has labelled e-mail and password fields with the right autocomplete hints", () => {
    render(<LoginForm next="/positions" />);
    expect(screen.getByLabelText("E-mail-cím")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Jelszó")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("Jelszó")).toHaveAttribute("type", "password");
  });

  it("sends the sanitised next path and shows one generic error", async () => {
    signIn.mockResolvedValue({ error: "invalid" });
    render(<LoginForm next="/positions" />);

    await userEvent.type(screen.getByLabelText("E-mail-cím"), "a@b.hu");
    await userEvent.type(screen.getByLabelText("Jelszó"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Belépés" }));

    expect(await screen.findByText("Hibás e-mail-cím vagy jelszó.")).toBeInTheDocument();
    const formData = signIn.mock.calls[0][1] as FormData;
    expect(formData.get("next")).toBe("/positions");
  });

  it("explains rate limiting separately", async () => {
    signIn.mockResolvedValue({ error: "rate-limited" });
    render(<LoginForm next="/" />);
    await userEvent.type(screen.getByLabelText("E-mail-cím"), "a@b.hu");
    await userEvent.type(screen.getByLabelText("Jelszó"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Belépés" }));
    expect(await screen.findByText(/Túl sok próbálkozás/)).toBeInTheDocument();
  });
});
