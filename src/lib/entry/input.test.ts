import { describe, expect, it } from "vitest";
import { emptyEntryInput, parseEntryInput } from "./input";

describe("parseEntryInput", () => {
  it("fills what the form left out and keeps what was typed", () => {
    const r = parseEntryInput(JSON.stringify({ tab: "buy", institution: { mode: "existing", id: "B" }, account: { mode: "new", name: "Új" }, quantity: "1 234,5" }));
    expect(r).toEqual({
      ...emptyEntryInput(),
      tab: "buy",
      institution: { mode: "existing", id: "B", name: "" },
      account: { mode: "new", id: "", name: "Új", accountType: "" },
      quantity: "1 234,5",
    });
  });

  it("refuses what is not the form: bad JSON, an unknown tab, overlong fields", () => {
    const base = { tab: "buy", institution: { mode: "new" }, account: { mode: "new" } };
    expect(parseEntryInput("{")).toBeNull();
    expect(parseEntryInput(42)).toBeNull();
    expect(parseEntryInput(JSON.stringify({ ...base, tab: "fee" }))).toBeNull();
    expect(parseEntryInput(JSON.stringify({ ...base, note: "x".repeat(601) }))).toBeNull();
    expect(parseEntryInput(JSON.stringify(base))).not.toBeNull();
  });

  it("where the money came from and went: the account's cash and keeping it by default, anything else refused", () => {
    const base = { tab: "buy", institution: { mode: "new" }, account: { mode: "new" } };
    expect(parseEntryInput(JSON.stringify(base))).toMatchObject({ payFrom: "cash", proceeds: "keep" });
    expect(emptyEntryInput()).toMatchObject({ payFrom: "cash", proceeds: "keep" });
    expect(parseEntryInput(JSON.stringify({ ...base, payFrom: "deposit", proceeds: "withdraw" }))).toMatchObject({ payFrom: "deposit", proceeds: "withdraw" });
    expect(parseEntryInput(JSON.stringify({ ...base, payFrom: "loan" }))).toBeNull();
    expect(parseEntryInput(JSON.stringify({ ...base, proceeds: "spent" }))).toBeNull();
  });

  it("a BÉT search hit is an instrument mode of its own", () => {
    const base = { tab: "buy", institution: { mode: "new" }, account: { mode: "new" } };
    expect(parseEntryInput(JSON.stringify({ ...base, instrument: { mode: "bet", symbol: "ETFCETOPOTP" } }))?.instrument).toMatchObject({ mode: "bet", symbol: "ETFCETOPOTP" });
  });

  it("the old Mai állomány tab is gone: only buys and sales", () => {
    expect(parseEntryInput(JSON.stringify({ tab: "opening", institution: { mode: "new" }, account: { mode: "new" } }))).toBeNull();
    expect(emptyEntryInput().tab).toBe("buy");
  });
});
