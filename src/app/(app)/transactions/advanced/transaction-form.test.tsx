import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/result";
import type { EventType } from "@/lib/finance/ledger";

const challengeAndVerify = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { mfa: { listFactors: async () => ({ data: { totp: [{ id: "factor-1" }] }, error: null }), challengeAndVerify } },
  }),
}));

const { TransactionForm } = await import("./transaction-form");

const accounts = [
  { id: "acc-1", label: "Részvényszámla", group: "Bróker", trackingStart: "2026-01-01" },
  { id: "acc-2", label: "TBSZ", group: "Bank", trackingStart: "2026-03-01" },
];
const instruments = [
  { id: "ins-1", label: "Apple (AAPL)", currency: "USD", valuation: "market" as const },
  { id: "ins-2", label: "Hold", currency: "HUF", valuation: "manual" as const },
];

function setup(action = vi.fn<(fd: FormData) => Promise<ActionResult>>().mockResolvedValue({ ok: true }), initialType?: EventType) {
  render(
    <TransactionForm accounts={accounts} instruments={instruments} currencies={["HUF", "EUR", "USD"]} today="2026-09-26" initialType={initialType} action={action} />,
  );
  return action;
}
const chooseType = (label: string) => userEvent.selectOptions(screen.getByLabelText("Típus"), label);
const labels = () => screen.getAllByText((_, el) => el?.tagName === "LABEL").map((l) => l.textContent?.replace(/\s*\(nem kötelező\)/, "") ?? "");

beforeEach(() => challengeAndVerify.mockReset());

describe("TransactionForm – fields per event type (plan §2)", () => {
  const cases: [string, string[]][] = [
    ["Vétel", ["Eszköz", "Darab", "Egységár", "Pontos összeg", "Díj", "A díj devizája"]],
    ["Eladás", ["Eszköz", "Darab", "Egységár", "Pontos összeg", "Díj", "A díj devizája"]],
    ["Osztalék", ["Kifizető eszköz", "Deviza", "Bruttó összeg", "Levont adó"]],
    ["Osztalék újrabefektetése", ["Eszköz", "Bruttó összeg", "Levont adó", "Darab", "Újrabefektetett összeg"]],
    ["Részvényfelosztás (split)", ["Eszköz", "Régi darab", "Új darab"]],
    ["Devizaváltás", ["Eladott deviza", "Eladott összeg", "Vett deviza", "Kapott összeg", "Díj", "A díj devizája"]],
    ["Befizetés", ["Deviza", "Összeg"]],
    ["Kivét", ["Deviza", "Összeg"]],
    ["Díj", ["Deviza", "Összeg"]],
    ["Kamat", ["Deviza", "Bruttó összeg", "Levont adó"]],
  ];
  it.each(cases)("%s", async (type, expected) => {
    setup();
    await chooseType(type);
    const shown = labels();
    for (const l of ["Típus", "Dátum", "Számla", "Megjegyzés", ...expected]) expect(shown, type).toContain(l);
    if (!expected.some((l) => l.includes("Eszköz"))) expect(shown).not.toContain("Eszköz");
  });

  it("interest: a government security can be named; without one the form stays as it was", async () => {
    const bonds = [...instruments, { id: "ins-3", label: "FixMÁP 2031/Q4", currency: "HUF", valuation: "market" as const, bond: true }];
    const action = vi.fn<(fd: FormData) => Promise<ActionResult>>().mockResolvedValue({ ok: true });
    render(<TransactionForm accounts={accounts} instruments={bonds} currencies={["HUF", "EUR"]} today="2026-09-26" initialType="interest" action={action} />);
    const paper = screen.getByLabelText(/^Állampapír/);
    expect(within(paper).getAllByRole("option").map((o) => o.textContent)).toEqual(["Nincs – a számlán lévő pénz kamata", "FixMÁP 2031/Q4"]);
    expect(screen.getByLabelText(/^Deviza/)).toBeInTheDocument();
    await userEvent.selectOptions(paper, "FixMÁP 2031/Q4");
    expect(screen.queryByLabelText(/^Deviza/)).toBeNull();
    await userEvent.type(screen.getByLabelText("Bruttó összeg"), "7500");
    await userEvent.click(screen.getByRole("button", { name: "Rögzítés" }));
    expect(Object.fromEntries(action.mock.calls[0][0])).toMatchObject({ type: "interest", instrumentId: "ins-3", gross: "7500" });
  });

  it("interest without government securities: no paper field", async () => {
    setup(undefined, "interest");
    expect(screen.queryByLabelText(/^Állampapír/)).toBeNull();
  });

  it("transfer: two accounts, then cash or units", async () => {
    setup();
    await chooseType("Átvezetés saját számlák között");
    expect(labels()).toEqual(expect.arrayContaining(["Honnan (számla)", "Hová (számla)", "Deviza", "Összeg"]));
    await userEvent.click(screen.getByRole("radio", { name: "Értékpapír" }));
    expect(labels()).toEqual(expect.arrayContaining(["Eszköz", "Darab"]));
    expect(labels()).not.toContain("Összeg");
  });

  it("opening balance: no date input, the tracking start is shown; price or value by instrument", async () => {
    setup(undefined, "opening_balance");
    expect(screen.queryByLabelText("Dátum")).toBeNull();
    expect(screen.getByText(/követési kezdőnapja: 2026\. jan\. 1\./)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Számla"), "TBSZ");
    expect(screen.getByText(/követési kezdőnapja: 2026\. márc\. 1\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Értékpapír" }));
    expect(labels()).toEqual(expect.arrayContaining(["Egységár a nyitónapon", "Eredeti bekerülési érték"]));
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "Hold · HUF");
    expect(labels()).toContain("Érték a nyitónapon");
    expect(labels()).not.toContain("Egységár a nyitónapon");
  });

  it("correction: kind, direction and a required note", async () => {
    setup(undefined, "correction");
    expect(labels()).toEqual(expect.arrayContaining(["Megjegyzés (kötelező)", "Deviza", "Összeg"]));
    await userEvent.click(screen.getByRole("radio", { name: /Egyeztetési eltérés/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Értékpapír" }));
    expect(labels()).toEqual(expect.arrayContaining(["Eszköz", "Darab", "Egységár"]));
    await userEvent.click(screen.getByRole("radio", { name: /^Ki/ }));
    expect(labels()).not.toContain("Egységár");
  });
});

describe("TransactionForm – submitting", () => {
  it("sends the typed values; a field error is shown and nothing typed is lost", async () => {
    const action = setup(vi.fn().mockResolvedValue({ ok: false, errors: { quantity: "insufficient" } }), "sell");
    await userEvent.type(screen.getByLabelText("Darab"), "1000");
    await userEvent.type(screen.getByLabelText("Egységár"), "1,5");
    await userEvent.click(screen.getByRole("button", { name: "Rögzítés" }));

    expect(await screen.findByText("Ezen a napon nincs ennyi darab a számlán.")).toBeInTheDocument();
    expect(screen.getByLabelText("Darab")).toHaveValue("1000");
    expect(screen.getByLabelText("Darab")).toHaveAttribute("aria-invalid", "true");
    const fd = action.mock.calls[0][0] as FormData;
    expect(Object.fromEntries(fd)).toMatchObject({ type: "sell", date: "2026-09-26", accountId: "acc-1", instrumentId: "ins-1", quantity: "1000", price: "1,5" });
  });

  it("after a success the amounts start empty, the type and account stay", async () => {
    setup(undefined, "deposit");
    await userEvent.selectOptions(screen.getByLabelText("Számla"), "TBSZ");
    await userEvent.type(screen.getByLabelText("Összeg"), "5000");
    await userEvent.click(screen.getByRole("button", { name: "Rögzítés" }));
    expect(await screen.findByText("Rögzítve.")).toBeInTheDocument();
    expect(screen.getByLabelText("Összeg")).toHaveValue("");
    expect(screen.getByLabelText("Típus")).toHaveValue("deposit");
    expect(screen.getByLabelText("Számla")).toHaveValue("acc-2");
  });

  it("a stale TOTP opens the code dialog; after the code the same form is sent again (plan §1.3)", async () => {
    const action = vi
      .fn<(fd: FormData) => Promise<ActionResult>>()
      .mockResolvedValueOnce({ ok: false, reauth: true })
      .mockResolvedValueOnce({ ok: true });
    challengeAndVerify.mockResolvedValueOnce({ error: { message: "bad" } }).mockResolvedValueOnce({ error: null });
    setup(action, "deposit");
    await userEvent.type(screen.getByLabelText("Összeg"), "777");
    await userEvent.type(screen.getByLabelText(/Megjegyzés/), "ne vesszen el");
    await userEvent.click(screen.getByRole("button", { name: "Rögzítés" }));

    const dialog = await screen.findByRole("dialog", { name: "Add meg újra a kódot" });
    expect(screen.getByLabelText("Összeg")).toHaveValue("777"); // the form is still there

    await userEvent.type(within(dialog).getByLabelText("6 jegyű kód"), "123456");
    await userEvent.click(within(dialog).getByRole("button", { name: "Ellenőrzés és folytatás" }));
    expect(await within(dialog).findByText(/A kód nem megfelelő/)).toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);

    await userEvent.clear(within(dialog).getByLabelText("6 jegyű kód"));
    await userEvent.type(within(dialog).getByLabelText("6 jegyű kód"), "654321");
    await userEvent.click(within(dialog).getByRole("button", { name: "Ellenőrzés és folytatás" }));

    expect(await screen.findByText("Rögzítve.")).toBeInTheDocument();
    expect(challengeAndVerify).toHaveBeenLastCalledWith({ factorId: "factor-1", code: "654321" });
    expect(action).toHaveBeenCalledTimes(2);
    expect(action.mock.calls[1][0]).toBe(action.mock.calls[0][0]);
    expect((action.mock.calls[1][0] as FormData).get("note")).toBe("ne vesszen el");
  });

  it("without accounts it points to the accounts page", () => {
    render(<TransactionForm accounts={[]} instruments={[]} currencies={["HUF"]} today="2026-09-26" action={vi.fn()} />);
    expect(screen.getByText("Tranzakcióhoz előbb számla kell.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Számlák" })).toHaveAttribute("href", "/accounts");
  });
});
