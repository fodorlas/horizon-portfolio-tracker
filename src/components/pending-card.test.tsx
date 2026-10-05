import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/result";
import type { PendingCard as Card } from "@/lib/views/pending";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { mfa: {} } }) }));
const { DismissedList, PendingCard } = await import("./pending-card");

type Action = (fd: FormData) => Promise<ActionResult>;
const basis = { start: "2026-08-26", end: "2026-11-26", days: 92, annual: "6.8", rateSource: "history" as const, method: "act_360" as const, uncertain: false, missing: null };
const card = (over: Partial<Card> = {}): Card => ({
  id: "p1", kind: "interest", due: "2026-11-26", nominal: "500000", percent: "1.74", amount: "8700", basis, edited: false,
  instrumentName: "BMÁP 2027/N", accountName: "Kincstár · Értékpapír", status: "open", blockedBy: null, ...over,
});
function setup(c: Card) {
  const actions = { approve: vi.fn<Action>(async () => ({ ok: true })), snooze: vi.fn<Action>(async () => ({ ok: true })), dismiss: vi.fn<Action>(async () => ({ ok: true })), restore: vi.fn<Action>(async () => ({ ok: true })) };
  render(<PendingCard card={c} actions={actions} />);
  return actions;
}
const sent = (fn: ReturnType<typeof vi.fn<Action>>) => Object.fromEntries(fn.mock.calls[0][0].entries());

describe("PendingCard (spec §6.3–§6.4)", () => {
  it("a computed interest payment: its breakdown, where it came from, and where the money goes", async () => {
    const a = setup(card());
    expect(screen.getByRole("heading", { name: /Kamatfizetés · BMÁP 2027\/N/ })).toBeInTheDocument();
    expect(screen.getByText("Számolt – ÁKK-adatból (kamattörténet, Tényleges/360)")).toBeInTheDocument();
    expect(screen.getByText("Jogosult névérték").nextSibling?.textContent?.replace(/\s/g, " ")).toBe("500 000 Ft");
    expect(screen.getByText("6,8% · 1,74%")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /A számlán marad készpénzként/ })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Kivettem a számláról" }));
    await userEvent.click(screen.getByRole("button", { name: /^Jóváhagyom/ }));
    expect(sent(a.approve)).toMatchObject({ id: "p1", payout: "withdraw", edited: "0", seen: "2026-11-26|500000|8700" });
  });

  it("Módosítom opens the amount, the day and the note; the approval sends them as edited", async () => {
    const a = setup(card());
    expect(screen.queryByLabelText("Kamat (Ft)")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Módosítom/ }));
    await userEvent.clear(screen.getByLabelText("Kamat (Ft)"));
    await userEvent.type(screen.getByLabelText("Kamat (Ft)"), "8650");
    await userEvent.click(screen.getByRole("button", { name: /^Jóváhagyom/ }));
    expect(sent(a.approve)).toMatchObject({ id: "p1", amount: "8650", date: "2026-11-26", edited: "1" });
  });

  it("missing data: says so, and asks for the amount at once; a MÁP Plusz crediting has no payout choice", () => {
    setup(card({ kind: "interest_reinvest", amount: null, percent: null, basis: { ...basis, annual: null, rateSource: null, method: "act_act", missing: "rate" } }));
    expect(screen.getByText("Adat hiányzik – add meg a kimutatásod szerint")).toBeInTheDocument();
    expect(screen.getByLabelText("Jóváírt kamat (Ft)")).toHaveValue("");
    expect(screen.queryByRole("radio", { name: /A számlán marad/ })).toBeNull();
  });

  it("an unverified series and an uncertain entitlement are named", () => {
    setup(card({ amount: null, percent: null, basis: { ...basis, uncertain: true, missing: "unverified" } }));
    expect(screen.getByText("A sorozat számítása most nem egyezik az ÁKK-éval.")).toBeInTheDocument();
    expect(screen.getByText("Jogosultság bizonytalan – ellenőrizd a kimutatáson")).toBeInTheDocument();
  });

  it("a series not checked yet says so, not that it does not match (#30)", () => {
    setup(card({ amount: null, percent: null, basis: { ...basis, missing: "unchecked" } }));
    expect(screen.getByText("A Horizon ezt a sorozatot még nem tudta összevetni az ÁKK adataival.")).toBeInTheDocument();
    expect(screen.queryByText("A sorozat számítása most nem egyezik az ÁKK-éval.")).toBeNull();
  });

  it("a later proposal waits: Jóváhagyom is off and says which one comes first", () => {
    setup(card({ blockedBy: { due: "2026-08-26", kind: "interest" } }));
    expect(screen.getByRole("button", { name: /^Jóváhagyom/ })).toBeDisabled();
    expect(screen.getByText(/Előbb a 2026\. aug\. 26\. kamatfizetés javaslatot rendezd\./)).toBeInTheDocument();
    // A screen reader says why at the button itself (#36).
    expect(screen.getByRole("button", { name: /^Jóváhagyom/ })).toHaveAccessibleDescription(/^Előbb a 2026\. aug\. 26\. kamatfizetés javaslatot rendezd\./);
  });

  it("an approvable proposal's button has no such description", () => {
    setup(card());
    expect(screen.getByRole("button", { name: /^Jóváhagyom/ })).not.toHaveAttribute("aria-describedby");
  });

  it("Később and Elvetem send the proposal's id; a snoozed card is folded until opened", async () => {
    const a = setup(card({ status: "snoozed" }));
    expect(screen.getByText("Halasztva")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Jóváhagyom/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Kinyitás/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Elvetem/ }));
    expect(sent(a.dismiss)).toMatchObject({ id: "p1" });
  });

  it("every button names the proposal and the account it acts on, for a screen reader's list of buttons", () => {
    setup(card());
    const what = "2026. nov. 26. · Kamatfizetés · BMÁP 2027/N, Kincstár · Értékpapír";
    for (const b of ["Jóváhagyom", "Módosítom", "Később", "Elvetem"]) expect(screen.getByRole("button", { name: `${b}: ${what}` })).toBeInTheDocument();
  });

  it("a folded card's Kinyitás and a dismissed one's Visszaállítás name it too", () => {
    setup(card({ status: "snoozed" }));
    expect(screen.getByRole("button", { name: "Kinyitás: 2026. nov. 26. · Kamatfizetés · BMÁP 2027/N, Kincstár · Értékpapír" })).toBeInTheDocument();
    render(<DismissedList cards={[card({ status: "dismissed" })]} restore={vi.fn<Action>()} />);
    expect(screen.getByRole("button", { name: "Visszaállítás: 2026. nov. 26. · Kamatfizetés · BMÁP 2027/N, Kincstár · Értékpapír", hidden: true })).toBeInTheDocument();
  });

  it("a maturity shows the nominal repaid and its interest", () => {
    setup(card({ kind: "maturity", due: "2027-05-26", nominal: "500000", amount: "8900" }));
    expect(screen.getByText("Visszafizetett névérték")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Kivettem a számláról" })).toBeInTheDocument();
  });
});

describe("PendingCard after a status change", () => {
  it("folds when the page brings it back snoozed (Később)", async () => {
    const actions = { approve: vi.fn<Action>(), snooze: vi.fn<Action>(), dismiss: vi.fn<Action>(), restore: vi.fn<Action>() };
    const { rerender } = render(<PendingCard card={card()} actions={actions} />);
    expect(screen.getByRole("button", { name: /^Jóváhagyom/ })).toBeInTheDocument();
    rerender(<PendingCard card={card({ status: "snoozed" })} actions={actions} />);
    expect(screen.getByRole("button", { name: /^Kinyitás/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Jóváhagyom/ })).toBeNull();
  });
});
