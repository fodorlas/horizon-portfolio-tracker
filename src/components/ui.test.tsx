import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Modal } from "./modal";
import { Card, PageHeader } from "./ui";

describe("Card", () => {
  it("carries its id, so a link can point at it (/#pending); a titled card is a named region", () => {
    const { container } = render(
      <>
        <Card id="pending" title="Ellenőrzésre vár (1)">x</Card>
        <Card id="hero">y</Card>
      </>,
    );
    expect(container.querySelector("#pending")).toBe(screen.getByRole("region", { name: "Ellenőrzésre vár (1)" }));
    expect(container.querySelector("#hero")?.textContent).toBe("y");
  });
});

describe("titles", () => {
  it("page and dialog titles are set in the text face: Fraunces' j and J hang below the line", () => {
    render(
      <>
        <PageHeader title="Új tétel" />
        <Modal open onClose={() => {}} title="Új eszköz">
          x
        </Modal>
      </>,
    );
    for (const heading of [screen.getByRole("heading", { level: 1 }), screen.getByRole("heading", { level: 2, hidden: true })]) {
      expect(heading).not.toHaveClass("font-serif");
      expect(heading).toHaveClass("font-semibold");
    }
  });
});
