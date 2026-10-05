import { getDefaultNormalizer, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { i18nFor } from "@/lib/i18n";
import { DayNight, WeatherBadge } from "./weather";

const i18n = i18nFor("hu");

describe("WeatherBadge", () => {
  it("an icon, the city, a few words and the temperature, with the source on hover", () => {
    const { container } = render(<WeatherBadge weather={{ kind: "rain", isDay: false, temperature: -3 }} i18n={i18n} />);
    // Kept as typed: the no-break space before °C must survive.
    expect(screen.getByText("Budapest · Eső, −3\u00a0°C", { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) })).toBeVisible();
    expect(container.firstElementChild).toHaveAttribute("title", "Időjárás: Open-Meteo.com");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("clear sky is a sun by day and a moon by night", () => {
    const icon = (isDay: boolean) => {
      const { container, unmount } = render(<WeatherBadge weather={{ kind: "clear", isDay, temperature: 20 }} i18n={i18n} />);
      const cls = container.querySelector("svg")?.getAttribute("class") ?? "";
      unmount();
      return cls;
    };
    expect(icon(true)).toContain("lucide-sun");
    expect(icon(false)).toContain("lucide-moon");
    expect(screen.queryByText(/Derült/)).toBeNull();
  });
});

describe("DayNight: no weather, only day or night", () => {
  it("an icon with its name for screen readers", () => {
    const { container, rerender } = render(<DayNight isDay i18n={i18n} />);
    expect(screen.getByText("Nappal")).toHaveClass("sr-only");
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("lucide-sun");
    rerender(<DayNight isDay={false} i18n={i18n} />);
    expect(screen.getByText("Éjszaka")).toHaveClass("sr-only");
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("lucide-moon");
  });
});
