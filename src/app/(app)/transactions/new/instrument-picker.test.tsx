import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LookupLine } from "./instrument-picker";

describe("LookupLine", () => {
  it("a BÉT that cannot be reached says so, not Yahoo (#45)", () => {
    render(<LookupLine info="error" source="bet" />);
    expect(screen.getByRole("alert")).toHaveTextContent("A BÉT most nem érhető el. Próbáld újra, vagy add meg kézzel az árat.");
  });

  it("a BÉT paper found: its code, currency and kind (#45)", () => {
    render(<LookupLine info={{ symbol: "TESZTETF", name: "TESZTETF", currency: "EUR", assetClass: "etf", exchange: "BÉT", close: null }} source="bet" />);
    expect(screen.getByText("TESZTETF · EUR · ETF")).toBeInTheDocument();
  });

  it("a BÉT code without data says why it may be and what to do instead (#43)", () => {
    render(<LookupLine info={null} source="bet" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A BÉT nem ad adatot ehhez a kódhoz: nincs a listáján, vagy egy éve nincs rá adata. Kézi értékű tételként felviheted.",
    );
  });
});
