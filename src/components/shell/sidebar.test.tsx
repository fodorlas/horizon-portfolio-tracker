import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const { Sidebar } = await import("./sidebar");

const spacing = (el: HTMLElement) => [...el.classList].filter((c) => /^(px|gap|justify)-/.test(c)).sort();

describe("Sidebar", () => {
  it("the Új tétel button lines up with the menu: left-aligned, the same padding and gap (the owner's request, 2026-09-30)", () => {
    render(<Sidebar footer={null} />);
    const button = screen.getByRole("link", { name: "Új tétel" });
    const item = screen.getByRole("link", { name: "Pozíciók" });
    expect(button).not.toHaveClass("justify-center");
    expect(spacing(button)).toEqual(spacing(item));
  });
});
