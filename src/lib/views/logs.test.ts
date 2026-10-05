import { describe, expect, it } from "vitest";
import { logStatuses } from "./logs";

const row = (id: string, p: Partial<{ status: string; source: string; supersedes_id: string | null }> = {}) => ({
  id, status: "ok", source: "yahoo", supersedes_id: null, ...p,
});

describe("log statuses", () => {
  it("labels superseded, suspect, broker and current rows", () => {
    const rows = [
      row("a"),
      row("b", { source: "manual", supersedes_id: "a" }),
      row("c", { status: "suspect" }),
      row("d", { source: "broker" }),
      row("e"),
    ];
    expect(Object.fromEntries(logStatuses(rows, new Set(["b"])))).toEqual({ a: "superseded", b: "current", c: "suspect", d: "broker", e: "ok" });
  });

  it("only a valid manual row supersedes", () => {
    const rows = [row("a"), row("x", { source: "yahoo", supersedes_id: "a" })];
    expect(logStatuses(rows).get("a")).toBe("ok");
  });

  it("a row of a source its instrument no longer uses is 'unused'; suspect and superseded say more (#39)", () => {
    // The instrument moved from Yahoo to the BÉT: only BÉT and manual rows count now.
    const rows = [row("y"), row("ys", { status: "suspect" }), row("b", { source: "bet" }), row("m", { source: "manual" })];
    const usable = (r: { source: string }) => r.source === "bet" || r.source === "manual";
    expect(Object.fromEntries(logStatuses(rows, new Set(["b"]), usable))).toEqual({ y: "unused", ys: "suspect", b: "current", m: "ok" });
  });
});
