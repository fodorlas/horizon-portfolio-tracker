import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "./i18n-provider";
import { useServerForm } from "./server-form";

function Form({ action }: { action: (fd: FormData) => Promise<{ ok: true }> }) {
  const form = useServerForm(action);
  return (
    <form onSubmit={form.onSubmit}>
      <input name="amount" defaultValue="1,234.5" />
      <button type="submit">Save</button>
    </form>
  );
}

describe("useServerForm: the form says which language it was filled in (spec 2026-10-01 §2.5)", () => {
  it("sends inputLocale with the provider's language", async () => {
    const action = vi.fn<(fd: FormData) => Promise<{ ok: true }>>(async () => ({ ok: true }));
    render(
      <I18nProvider locale="en">
        <Form action={action} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(action).toHaveBeenCalled());
    const fd = action.mock.calls[0][0];
    expect(fd.get("inputLocale")).toBe("en");
    expect(fd.get("amount")).toBe("1,234.5");
  });
});
