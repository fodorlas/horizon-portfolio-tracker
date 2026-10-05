import { describe, expect, it } from "vitest";
import type { LedgerEvent, Line } from "@/lib/finance/ledger";
import { orphanedBy } from "./orphans";

const line = (instrumentId: string | null, kind: Line["kind"] = "position") => ({ instrumentId, kind }) as Line;
const event = (id: string, lines: Line[]) => ({ id, lines }) as LedgerEvent;

describe("orphanedBy: the instruments a delete leaves without a line", () => {
  it("an instrument used only in the removed events goes; one used elsewhere stays", () => {
    const events = [event("a", [line("x"), line("y"), line(null, "cash")]), event("b", [line("y")])];
    expect(orphanedBy(events, new Set(["a"]))).toEqual(["x"]);
  });

  it("a cash line naming its payer (a dividend) keeps the instrument, as in the database", () => {
    const events = [event("a", [line("x")]), event("b", [line("x", "cash")])];
    expect(orphanedBy(events, new Set(["a"]))).toEqual([]);
    expect(orphanedBy(events, new Set(["a", "b"]))).toEqual(["x"]);
  });
});
