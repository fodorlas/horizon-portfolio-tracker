import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "./i18n-provider";

function Probe() {
  const { locale, m, f } = useI18n();
  return <p>{`${locale}:${m.nav.positions}:${f.day("2026-09-27")}`}</p>;
}

describe("useI18n", () => {
  it("Hungarian outside a provider (component tests, error boundaries)", () => {
    render(<Probe />);
    expect(screen.getByText("hu:Pozíciók:2026. szept. 27.")).toBeInTheDocument();
  });

  it("the provider's language", () => {
    render(
      <I18nProvider locale="hu">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText("hu:Pozíciók:2026. szept. 27.")).toBeInTheDocument();
  });
});
