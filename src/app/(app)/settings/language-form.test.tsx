import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/i18n-provider";
import { LanguageForm } from "./language-form";

describe("LanguageForm", () => {
  it("names each language in itself, under a two-language title, in either UI language", () => {
    for (const locale of ["hu", "en"] as const) {
      const { unmount } = render(
        <I18nProvider locale={locale}>
          <LanguageForm current={locale} action={vi.fn()} />
        </I18nProvider>,
      );
      // RadioGroup is a fieldset with a legend: role "group".
      const group = screen.getByRole("group", { name: "Nyelv / Language" });
      expect(group).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Magyar" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "English" })).toBeInTheDocument();
      unmount();
    }
  });

  it("saves at once on a change", async () => {
    const action = vi.fn<(fd: FormData) => Promise<{ ok: true }>>(async () => ({ ok: true }));
    render(<LanguageForm current="hu" action={action} />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    await vi.waitFor(() => expect(action).toHaveBeenCalled());
    expect(action.mock.calls[0][0].get("language")).toBe("en");
  });
});
