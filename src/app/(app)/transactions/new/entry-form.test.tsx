import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/result";
import { emptyEntryInput, type EntryInput } from "@/lib/entry/input";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { mfa: {} } }) }));

const { EntryForm } = await import("./entry-form");

const institutions = [{ id: "BR", name: "Bróker" }, { id: "BANK", name: "Bank" }];
const accounts = [
  { id: "A", institutionId: "BR", name: "Részvényszámla", trackingStart: "2026-01-01" },
  { id: "K", institutionId: "BANK", name: "TBSZ", trackingStart: "2026-03-01" },
];
const instruments = [
  { id: "ST", name: "Példa", label: "Példa (PLDA)", currency: "EUR", valuation: "market" as const, symbol: "PLDA.DE" },
  { id: "HOLD", name: "Hold", label: "Hold", currency: "HUF", valuation: "manual" as const, symbol: null },
];
const holdings = [
  { accountId: "A", instrumentId: "ST", quantity: "10", value: null },
  { accountId: "A", instrumentId: "HOLD", quantity: "1000", value: "1200" },
];

type Action = (fd: FormData) => Promise<ActionResult>;

type Lookup = (symbol: string, day: string, source?: "yahoo" | "bet") => Promise<ActionResult>;
type Search = (q: string, where?: "auto" | "yahoo") => Promise<ActionResult>;

const yahooHit = (symbol: string, name: string, exchange: string) => ({ symbol, name, exchange, assetClass: "stock" as const, source: "yahoo" as const });
const betHit = (code: string, assetClass: "stock" | "etf") => ({ symbol: code, name: code, exchange: "BÉT", assetClass, source: "bet" as const });
/** The server's order (lookup-actions): the BÉT first; Yahoo when it has nothing, cannot be reached, or when asked. */
const marketSearch: Search = async (q, where = "auto") => {
  const u = q.toUpperCase();
  if (where === "auto" && u.startsWith("TESZT")) return { ok: true, hits: [betHit("TESZTETF", "etf")], from: "bet", betDown: false };
  if (where === "auto" && u === "OTP") return { ok: true, hits: [betHit("OTP", "stock")], from: "bet", betDown: false };
  if (where === "auto" && u === "RICHTER") return { ok: true, hits: [betHit("RICHTER", "stock")], from: "bet", betDown: false };
  const hits = u.startsWith("FAKE") ? [yahooHit("FAKEABC", "FAKEABC Fake Corp", "FAKE")] : [yahooHit("PLDA.DE", "Példa AG", "XETRA"), yahooHit("PLDA.MI", "Példa AG", "Milan")];
  return { ok: true, hits, from: "yahoo", betDown: where === "auto" && u === "LEALL" };
};

type Cash = { accountId: string; currency: string; steps: { day: string; balance: string }[] }[];

function setup(opts: { action?: Action; initial?: EntryInput; entryId?: string; initialAccount?: string; refresh?: () => Promise<ActionResult>; lookup?: Lookup; cash?: Cash; instruments?: typeof instruments; search?: Search } = {}) {
  const action = vi.fn<Action>(opts.action ?? (async () => ({ ok: true })));
  const refresh = vi.fn(opts.refresh ?? (async (): Promise<ActionResult> => ({ ok: true })));
  const search = vi.fn<Search>(opts.search ?? marketSearch);
  const lookup = vi.fn<Lookup>(
    opts.lookup ??
      (async (symbol) => ({
        ok: true,
        info: { symbol, name: `${symbol} Fake Corp`, currency: "EUR", assetClass: "stock", exchange: "FAKE", close: { day: "2026-09-24", price: "112.5" } },
      })),
  );
  render(
    <EntryForm
      institutions={institutions}
      accounts={accounts}
      instruments={opts.instruments ?? instruments}
      holdings={holdings}
      cash={opts.cash ?? []}
      currencies={["HUF", "EUR", "USD"]}
      today="2026-09-26"
      initial={opts.initial}
      initialAccount={opts.initialAccount}
      entryId={opts.entryId}
      action={action}
      search={search}
      lookup={lookup}
      refresh={refresh}
    />,
  );
  return { action, search, lookup, refresh };
}

const sent = (action: ReturnType<typeof vi.fn<Action>>, call = 0): EntryInput & { entryId?: string } => {
  const fd = action.mock.calls[call][0];
  return { ...JSON.parse(String(fd.get("entry"))), entryId: fd.get("entryId") ?? undefined };
};
const tab = (name: string) => userEvent.click(screen.getByRole("radio", { name }));

describe("EntryForm – Vétel and Eladás (4c plan §2, without the Mai állomány tab since 2026-09-27)", () => {
  it("starts on 'Vétel' with the first broker and account; there is no Mai állomány tab and no start day", async () => {
    setup();
    expect(screen.getByRole("radio", { name: "Vétel" })).toBeChecked();
    expect(screen.getAllByRole("radio", { name: /^(Vétel|Eladás|Mai állomány)$/ }).map((r) => r.getAttribute("value"))).toEqual(["buy", "sell"]);
    expect(screen.getByLabelText("Bróker")).toHaveValue("BR");
    expect(screen.getByLabelText("Számla")).toHaveValue("A");
    expect(screen.queryByText(/Követés kezdőnapja/)).toBeNull();
  });

  it("a new broker needs a new account; its start is the day before the buy, nothing to type", async () => {
    const { action } = setup();
    await userEvent.selectOptions(screen.getByLabelText("Bróker"), "+ Új bróker…");
    await userEvent.type(screen.getByLabelText("Az új bróker neve"), "Új bróker");
    expect(screen.getByLabelText("Számla")).toHaveValue("__new");
    expect(screen.getByLabelText("Számla")).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Az új számla neve"), "Új számla");
    expect(screen.queryByLabelText(/Követés kezdőnapja/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(sent(action)).toMatchObject({ institution: { mode: "new", name: "Új bróker" }, account: { mode: "new", name: "Új számla", accountType: "normal" } });
    expect(sent(action).account).not.toHaveProperty("trackingStart");
  });

  it("Vétel: date, instrument, quantity × price + fee, with a live total", async () => {
    const { action } = setup();
    expect(screen.getByLabelText("Dátum")).toHaveValue("2026-09-26");
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "ST");
    await userEvent.type(screen.getByLabelText("Darab"), "12");
    await userEvent.type(screen.getByLabelText(/^Egységár/), "112,50");
    await userEvent.type(screen.getByLabelText(/^Díj/), "2");
    expect(screen.getByText("12 × 112,50 EUR + 2,00 EUR díj = 1352,00 EUR")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(sent(action)).toMatchObject({ tab: "buy", date: "2026-09-26", instrument: { mode: "existing", id: "ST" }, quantity: "12", price: "112,50", fee: "2" });
  });

  it("a buy without a price: the Yahoo close on the buy day is shown as the estimate, and asked again for another day", async () => {
    const { lookup, action } = setup();
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "ST");
    expect(lookup).toHaveBeenLastCalledWith("PLDA.DE", "2026-09-26", "yahoo");
    expect(await screen.findByText("Üresen hagyva a Yahoo aznapi záróára: 112,50 EUR (2026. szept. 24.).")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Darab"), "12");
    expect(screen.getByText("Becsült bekerülés: 12 × 112,50 EUR = 1350,00 EUR")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Dátum"));
    await userEvent.type(screen.getByLabelText("Dátum"), "2026-02-02");
    expect(lookup).toHaveBeenLastCalledWith("PLDA.DE", "2026-02-02", "yahoo");
    await userEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(sent(action)).toMatchObject({ tab: "buy", date: "2026-02-02", quantity: "12", price: "", total: "" });
  });

  it("Yahoo search: an existing symbol is offered as the instrument already there, a new one is looked up on the buy day", async () => {
    const { search, lookup, action } = setup();
    await userEvent.click(screen.getByRole("radio", { name: "Tőzsdei papír (BÉT, Yahoo)" }));
    await userEvent.type(screen.getByLabelText("Név vagy kód"), "példa{Enter}");
    expect(search).toHaveBeenCalledWith("példa", "auto");
    const hit = await screen.findByRole("radio", { name: /PLDA\.DE/ });
    expect(screen.getByText("már felvetted")).toBeInTheDocument();
    await userEvent.click(hit);
    // Chosen as the existing instrument.
    expect(screen.getByLabelText("Eszköz")).toHaveValue("ST");

    await userEvent.click(screen.getByRole("radio", { name: "Tőzsdei papír (BÉT, Yahoo)" }));
    await userEvent.clear(screen.getByLabelText("Név vagy kód"));
    await userEvent.type(screen.getByLabelText("Név vagy kód"), "fakeabc");
    await userEvent.click(screen.getByRole("button", { name: "Keresés" }));
    await userEvent.click(await screen.findByRole("radio", { name: /FAKEABC/ }));
    expect(lookup).toHaveBeenLastCalledWith("FAKEABC", "2026-09-26", "yahoo");
    expect(await screen.findByText(/Üresen hagyva a Yahoo aznapi záróára: 112,50 EUR/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Darab"), "12");
    await userEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(sent(action).instrument).toMatchObject({ mode: "yahoo", symbol: "FAKEABC" });
  });

  it("Tőzsdei papír: a BÉT hit comes first and says so; picking it looks it up on the BÉT", async () => {
    const { lookup, action } = setup();
    await userEvent.click(screen.getByRole("radio", { name: "Tőzsdei papír (BÉT, Yahoo)" }));
    await userEvent.type(screen.getByLabelText("Név vagy kód"), "teszt{Enter}");
    expect(await screen.findByText("1 találat a BÉT-en")).toBeInTheDocument();
    const hit = screen.getByRole("radio", { name: /TESZTETF · ETF/ });
    expect(within(hit.closest("label")!).getByText("BÉT")).toBeInTheDocument();
    await userEvent.click(hit);
    expect(lookup).toHaveBeenLastCalledWith("TESZTETF", "2026-09-26", "bet");
    expect(await screen.findByText(/Üresen hagyva a BÉT aznapi záróára: 112,50 EUR/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Darab"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(sent(action).instrument).toMatchObject({ mode: "bet", symbol: "TESZTETF" });
  });

  it("'Nem ez? Keresés a Yahoo-n' after a BÉT hit asks Yahoo only", async () => {
    const { search } = setup();
    await userEvent.click(screen.getByRole("radio", { name: "Tőzsdei papír (BÉT, Yahoo)" }));
    await userEvent.type(screen.getByLabelText("Név vagy kód"), "teszt{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Nem ez? Keresés a Yahoo-n" }));
    expect(search).toHaveBeenLastCalledWith("teszt", "yahoo");
    expect(await screen.findByText("2 találat a Yahoo-n")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nem ez? Keresés a Yahoo-n" })).toBeNull();
    // The button is gone: the keyboard goes on from the first Yahoo hit.
    expect(screen.getByRole("radio", { name: /PLDA\.DE/ })).toHaveFocus();
  });

  it("an older search that answers late does not replace a newer one's hits (#40)", async () => {
    let release = () => {};
    const slow: Search = async (q, where = "auto") => {
      if (q !== "lassu") return marketSearch(q, where);
      await new Promise<void>((r) => (release = r));
      return { ok: true, hits: [betHit("LASSU", "stock")], from: "bet", betDown: false };
    };
    setup({ search: slow });
    await userEvent.click(screen.getByRole("radio", { name: "Tőzsdei papír (BÉT, Yahoo)" }));
    await userEvent.type(screen.getByLabelText("Név vagy kód"), "lassu{Enter}");
    await userEvent.clear(screen.getByLabelText("Név vagy kód"));
    await userEvent.type(screen.getByLabelText("Név vagy kód"), "fakeabc{Enter}");
    expect(await screen.findByRole("radio", { name: /FAKEABC/ })).toBeInTheDocument();
    await act(async () => release());
    expect(screen.getByRole("radio", { name: /FAKEABC/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /LASSU/ })).toBeNull();
    expect(screen.getByText("A BÉT-en nincs ilyen papír. 1 találat a Yahoo-n")).toBeInTheDocument();
  });

  it("Yahoo's hits after the BÉT say why: nothing on the BÉT, or the BÉT cannot be reached", async () => {
    setup();
    await userEvent.click(screen.getByRole("radio", { name: "Tőzsdei papír (BÉT, Yahoo)" }));
    await userEvent.type(screen.getByLabelText("Név vagy kód"), "példa{Enter}");
    expect(await screen.findByText("A BÉT-en nincs ilyen papír. 2 találat a Yahoo-n")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Név vagy kód"));
    await userEvent.type(screen.getByLabelText("Név vagy kód"), "leall{Enter}");
    expect(await screen.findByText("A BÉT most nem érhető el. 2 találat a Yahoo-n")).toBeInTheDocument();
  });

  it("a BÉT hit of a paper already there – as a BÉT paper or as its .BD Yahoo symbol – is that instrument", async () => {
    const more = [
      ...instruments,
      { id: "OTPY", name: "OTP Bank", label: "OTP Bank", currency: "HUF", valuation: "market" as const, symbol: "OTP.BD", source: "yahoo" },
      { id: "RICH", name: "Richter", label: "Richter", currency: "HUF", valuation: "market" as const, symbol: "RICHTER", source: "bet" },
    ];
    setup({ instruments: more });
    for (const [q, id] of [["otp", "OTPY"], ["richter", "RICH"]]) {
      await userEvent.click(screen.getByRole("radio", { name: "Tőzsdei papír (BÉT, Yahoo)" }));
      await userEvent.clear(screen.getByLabelText("Név vagy kód"));
      await userEvent.type(screen.getByLabelText("Név vagy kód"), `${q}{Enter}`);
      const hit = await screen.findByRole("radio", { name: new RegExp(q.toUpperCase()) });
      expect(within(hit.closest("label")!).getByText("már felvetted")).toBeInTheDocument();
      await userEvent.click(hit);
      expect(screen.getByLabelText("Eszköz")).toHaveValue(id);
    }
  });

  const withRichter = [...instruments, { id: "RICH", name: "Richter", label: "Richter", currency: "HUF", valuation: "market" as const, symbol: "RICHTER", source: "bet" }];
  const betClose = (price: string | null): Lookup => async (symbol) => ({
    ok: true,
    info: { symbol, name: symbol, currency: "HUF", assetClass: "stock", exchange: "BÉT", close: price ? { day: "2026-09-25", price } : null },
  });

  it("a BÉT paper already there looks its close up on the BÉT, and says so (#45)", async () => {
    const { lookup } = setup({ instruments: withRichter, lookup: betClose("9800") });
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "RICH");
    expect(lookup).toHaveBeenLastCalledWith("RICHTER", "2026-09-26", "bet");
    expect(await screen.findByText(/Üresen hagyva a BÉT aznapi záróára: 9800 Ft \(2026\. szept\. 25\.\)/)).toBeInTheDocument();
  });

  it("a BÉT paper already there without a close for the day asks for the price (#45)", async () => {
    setup({ instruments: withRichter, lookup: betClose(null) });
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "RICH");
    expect(await screen.findByText("Nincs BÉT-záróár erre a napra: add meg az árat.")).toBeInTheDocument();
  });

  it("no Yahoo close for the day on this exchange: says so and suggests another one, not an outage", async () => {
    setup({ lookup: async (symbol) => ({ ok: true, info: { symbol, name: "Vanguard S&P 500", currency: "EUR", assetClass: "etf", exchange: "XETRA", close: null } }) });
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "ST");
    expect(await screen.findByText("Nincs Yahoo-ár erre a napra: add meg, vagy válassz másik tőzsdét (például .MI vagy .L végűt).")).toBeInTheDocument();
    expect(screen.queryByText(/most nem érhető el/)).toBeNull();
  });

  it("switching tabs starts the amounts afresh: a buy's fee does not slip into a sale", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "ST");
    await userEvent.type(screen.getByLabelText("Darab"), "12");
    await userEvent.type(screen.getByLabelText(/^Díj/), "2");
    await tab("Eladás");
    expect(screen.getByLabelText("Eszköz")).toHaveValue("");
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "ST");
    expect(screen.getByLabelText("Darab")).toHaveValue("");
    expect(screen.getByLabelText(/^Díj/)).toHaveValue("");
  });

  it("a manual item: created in place on the buy tab, with the paid-in amount", async () => {
    const { action } = setup();
    await userEvent.click(screen.getByRole("radio", { name: "Kézi értékű (pl. Hold)" }));
    await userEvent.type(screen.getByLabelText("Megnevezés"), "Állampapír");
    await userEvent.selectOptions(screen.getByLabelText("Deviza"), "HUF");
    expect(screen.queryByLabelText("Darab")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Befizetett összeg"), "250000");
    expect(screen.getByLabelText(/Új összérték/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(sent(action)).toMatchObject({ instrument: { mode: "manual", name: "Állampapír", currency: "HUF", assetClass: "managed" }, amount: "250000" });
  });

  it("Eladás: only what the account holds, no new broker or account, the holding as a hint, the price needed", async () => {
    setup();
    await tab("Eladás");
    const options = within(screen.getByLabelText("Eszköz")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Válassz…", "Példa (PLDA) · EUR", "Hold · HUF"]);
    expect(within(screen.getByLabelText("Bróker")).queryByText("+ Új bróker…")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "ST");
    expect(screen.getByText("A számlán most: 10 db")).toBeInTheDocument();
    expect(screen.getByLabelText("Egységár")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Számla"), "A");
    await userEvent.selectOptions(screen.getByLabelText("Bróker"), "BANK");
    expect(screen.getByText("Ezen a számlán nincs eladható eszköz.")).toBeInTheDocument();
  });

  it("server errors land on their fields; the typed values stay", async () => {
    setup({ action: async () => ({ ok: false, errors: { quantity: "required", date: "future" } }) });
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "ST");
    await userEvent.type(screen.getByLabelText(/^Egységár/), "50");
    await userEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText("Kötelező mező.")).toBeInTheDocument();
    expect(screen.getByLabelText("Darab")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^Egységár/)).toHaveValue("50");
  });

  it("editing: the tab is fixed, the values are filled in and the entry id goes along", async () => {
    const initial: EntryInput = {
      ...emptyEntryInput(), tab: "buy", institution: { mode: "existing", id: "BR", name: "" }, account: { mode: "existing", id: "A", name: "", accountType: "normal" },
      date: "2026-02-02", instrument: { mode: "existing", id: "ST", symbol: "", name: "", currency: "", assetClass: "" }, quantity: "12", price: "112,5",
    };
    const { action } = setup({ initial, entryId: "E1" });
    expect(screen.queryByRole("radio", { name: "Eladás" })).toBeNull();
    expect(screen.getByText("Vétel szerkesztése")).toBeInTheDocument();
    expect(screen.getByLabelText("Darab")).toHaveValue("12");
    await userEvent.click(screen.getByRole("button", { name: "Módosítás mentése" }));
    expect(sent(action)).toMatchObject({ entryId: "E1", tab: "buy", quantity: "12" });
  });

  it("editing a sale of everything still offers its instrument, though nothing is held now", async () => {
    const initial: EntryInput = {
      ...emptyEntryInput(), tab: "sell", institution: { mode: "existing", id: "BANK", name: "" }, account: { mode: "existing", id: "K", name: "", accountType: "normal" },
      date: "2026-04-02", instrument: { mode: "existing", id: "ST", symbol: "", name: "", currency: "", assetClass: "" }, quantity: "10", price: "120",
    };
    setup({ initial, entryId: "E2" });
    expect(screen.queryByText("Ezen a számlán nincs eladható eszköz.")).toBeNull();
    expect(screen.getByLabelText("Eszköz")).toHaveValue("ST");
  });

  it("after a save the FX rates and prices are refreshed, so the new item counts in the totals at once", async () => {
    const { refresh } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText(/Az árfolyamok és az árak is frissültek\./)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a failed refresh after the save only asks for the Frissítés button", async () => {
    setup({ refresh: async () => ({ ok: false, formError: "server" }) });
    await userEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText(/A frissítés most nem sikerült/)).toBeInTheDocument();
    expect(screen.getByText(/Mentve\./)).toBeInTheDocument();
  });

  it("a manual item typed with a name already there says the existing one will be used", async () => {
    setup();
    await userEvent.click(screen.getByRole("radio", { name: "Kézi értékű (pl. Hold)" }));
    await userEvent.type(screen.getByLabelText("Megnevezés"), " hold");
    expect(screen.getByText("Már van ilyen kézi elem, a mentés azt használja.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Deviza"), "EUR");
    expect(screen.queryByText("Már van ilyen kézi elem, a mentés azt használja.")).toBeNull();
  });

  it("links to the advanced operations", () => {
    setup();
    expect(screen.getByRole("link", { name: /Haladó műveletek/ })).toHaveAttribute("href", "/transactions/advanced");
  });
});

describe("EntryForm – cash on the account (spec 2026-09-28 §3.4)", () => {
  const eurCash = [{ accountId: "A", currency: "EUR", steps: [{ day: "2026-01-10", balance: "500" }] }];

  it("a buy offers the account's cash in its currency first and says what comes in as a deposit", async () => {
    const { action } = setup({ cash: eurCash });
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "ST");
    expect(screen.getByRole("radio", { name: "A számla készpénzéből" })).toBeChecked();
    expect(screen.getByText("Elérhető: 500,00 EUR.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Darab"), "2");
    await userEvent.type(screen.getByLabelText(/^Egységár/), "100");
    expect(screen.getByText("Elérhető: 500,00 EUR. Az egész vétel ebből megy, befizetés nem kerül be.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Darab"));
    await userEvent.type(screen.getByLabelText("Darab"), "8");
    expect(screen.getByText("Elérhető: 500,00 EUR. A hiányzó 300,00 EUR befizetésként kerül be.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Teljes egészében új befizetésből" }));
    expect(screen.getByText("A számlán lévő 500,00 EUR érintetlen marad.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(sent(action)).toMatchObject({ tab: "buy", payFrom: "deposit", quantity: "8" });
  });

  it("one status line for a screen reader: the first hint is heard too, the typing only once it settles (#27)", async () => {
    setup({ cash: eurCash });
    const spoken = () => document.querySelectorAll("form [role=status].sr-only");
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "ST");
    // The visible hint and total are not live regions of their own.
    expect(screen.getByText("Elérhető: 500,00 EUR.")).not.toHaveAttribute("aria-live");
    expect(spoken()).toHaveLength(1);
    await waitFor(() => expect(spoken()[0]).toHaveTextContent("Elérhető: 500,00 EUR."), { timeout: 2000 });

    await userEvent.type(screen.getByLabelText("Darab"), "2");
    await userEvent.type(screen.getByLabelText(/^Egységár/), "100");
    expect(screen.getByText("2 × 100,00 EUR = 200,00 EUR")).not.toHaveAttribute("aria-live");
    expect(spoken()[0]).toHaveTextContent(/^Elérhető: 500,00 EUR\.$/);
    await waitFor(
      () => expect(spoken()[0]).toHaveTextContent("2 × 100,00 EUR = 200,00 EUR Elérhető: 500,00 EUR. Az egész vétel ebből megy, befizetés nem kerül be."),
      { timeout: 2000 },
    );
  });

  it("no choice without cash in the buy's currency, or on a day before the cash came", async () => {
    setup({ cash: [{ accountId: "A", currency: "HUF", steps: [{ day: "2026-01-10", balance: "500" }] }] });
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "ST");
    expect(screen.queryByRole("radio", { name: "A számla készpénzéből" })).toBeNull();
    // HUF cash does pay for a HUF item.
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "HOLD");
    expect(screen.getByRole("radio", { name: "A számla készpénzéből" })).toBeChecked();
    await userEvent.clear(screen.getByLabelText("Dátum"));
    await userEvent.type(screen.getByLabelText("Dátum"), "2026-01-05");
    expect(screen.queryByRole("radio", { name: "A számla készpénzéből" })).toBeNull();
  });

  it("a sale keeps its money on the account unless it was taken out", async () => {
    const { action } = setup();
    await tab("Eladás");
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "ST");
    expect(screen.getByRole("radio", { name: "A számlán marad" })).toBeChecked();
    expect(screen.getByText("A bevétel a számla készpénze lesz; a következő vételnél felhasználhatod.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Darab"), "4");
    await userEvent.type(screen.getByLabelText("Egységár"), "60");
    await userEvent.click(screen.getByRole("radio", { name: "Kivettem" }));
    expect(screen.getByText("Ugyanarra a napra kivét is bekerül: a pénz kikerül a követett vagyonból.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(sent(action)).toMatchObject({ tab: "sell", proceeds: "withdraw" });
  });
});

describe("EntryForm – government securities (spec 2026-09-28 §3.1–§3.2)", () => {
  function setupBond(extra: Partial<Parameters<typeof EntryForm>[0]> = {}) {
    const action = vi.fn<Action>(async () => ({ ok: true }));
    const searchSeries = vi.fn(async (): Promise<ActionResult> => ({
      ok: true,
      series: [{ series: "2031/M5", label: "MÁP Plusz", maturity: "2031-08-21", coupon: "5" }],
    }));
    render(
      <EntryForm
        institutions={institutions}
        accounts={accounts}
        instruments={[...instruments, { id: "M9", name: "MÁP Plusz N2030/M9", label: "MÁP Plusz N2030/M9", currency: "HUF", valuation: "market", symbol: "N2030/M9", source: "akk" }]}
        holdings={[...holdings, { accountId: "A", instrumentId: "M9", quantity: "1000000", value: null }]}
        cash={[]}
        currencies={["HUF", "EUR"]}
        today="2026-09-26"
        action={action}
        search={vi.fn(async (): Promise<ActionResult> => ({ ok: true, hits: [] }))}
        searchSeries={searchSeries}
        lookup={vi.fn(async (): Promise<ActionResult> => ({ ok: true, info: null }))}
        {...extra}
      />,
    );
    return { action, searchSeries };
  }

  it("series search: an older answer arriving late does not replace a newer one (#40)", async () => {
    let release = () => {};
    const searchSeries = vi.fn(async (q: string): Promise<ActionResult> => {
      if (q === "2030") await new Promise<void>((r) => (release = r));
      return { ok: true, series: [{ series: q === "2030" ? "N2030/M9" : "2031/M5", label: "MÁP Plusz", maturity: q === "2030" ? "2030-09-25" : "2031-08-21", coupon: "5" }] };
    });
    setupBond({ searchSeries });
    await userEvent.click(screen.getByRole("radio", { name: "Állampapír (ÁKK)" }));
    await userEvent.type(screen.getByLabelText("Sorozat"), "2030{Enter}");
    await userEvent.clear(screen.getByLabelText("Sorozat"));
    await userEvent.type(screen.getByLabelText("Sorozat"), "2031{Enter}");
    expect(await screen.findByRole("radio", { name: /2031\/M5/ })).toBeInTheDocument();
    await act(async () => release());
    expect(screen.getByRole("radio", { name: /2031\/M5/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /N2030\/M9/ })).toBeNull();
  });

  it("a series from the ÁKK list: nominal and amount paid, no unit price", async () => {
    const { action, searchSeries } = setupBond();
    await userEvent.click(screen.getByRole("radio", { name: "Állampapír (ÁKK)" }));
    await userEvent.type(screen.getByLabelText("Sorozat"), "2031");
    await userEvent.click(screen.getByRole("button", { name: "Keresés" }));
    expect(searchSeries).toHaveBeenCalledWith("2031");
    await userEvent.click(screen.getByRole("radio", { name: /MÁP Plusz 2031\/M5/ }));
    expect(screen.getByLabelText("Névérték (Ft)")).toBeInTheDocument();
    expect(screen.getByLabelText(/Fizetett összeg \(Ft\)/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Egységár/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Névérték (Ft)"), "1000000");
    await userEvent.type(screen.getByLabelText(/Fizetett összeg \(Ft\)/), "1001200");
    await userEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(sent(action)).toMatchObject({ instrument: { mode: "akk", symbol: "2031/M5" }, quantity: "1000000", total: "1001200" });
  });

  it("an ÁKK paper already there: its sale asks for the nominal and the amount received", async () => {
    setupBond();
    await tab("Eladás");
    await userEvent.selectOptions(screen.getByLabelText("Eszköz"), "M9");
    expect(screen.getByLabelText("Névérték (Ft)")).toBeInTheDocument();
    expect(screen.getByLabelText(/Kapott összeg \(Ft\)/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Egységár/)).not.toBeInTheDocument();
    expect(screen.getByText("A számlán most: 1 000 000 Ft névérték")).toBeInTheDocument();
  });
});
