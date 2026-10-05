import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const status = vi.hoisted(() => ({ pending: false }));
vi.mock("next/link", async (original) => ({ ...(await original<typeof import("next/link")>()), useLinkStatus: () => status }));

const { PendingLabel } = await import("./pending-label");

describe("PendingLabel", () => {
  it("while its page loads, the label pulses and says so to a screen reader; nothing moves (2026-09-30)", () => {
    status.pending = true;
    render(<PendingLabel>6 hónap</PendingLabel>);
    const label = screen.getByText("6 hónap", { exact: false });
    expect(label).toHaveClass("animate-pulse");
    expect(label).toHaveTextContent("6 hónap (betöltés…)");
  });

  it("otherwise only the label", () => {
    status.pending = false;
    const { container } = render(<PendingLabel>6 hónap</PendingLabel>);
    expect(container.textContent).toBe("6 hónap");
    expect(container.firstElementChild).not.toHaveClass("animate-pulse");
  });
});
