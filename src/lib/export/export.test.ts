import { describe, expect, it } from "vitest";
import type { Loaded } from "@/lib/data/load";
import { D } from "@/lib/finance/money";
import { exportJson, positionsCsv, toCsv, transactionsCsv } from "./export";

const names = {
  account: new Map([["A1", "Bróker · Fő, \"USD\""]]),
  instrument: new Map([["I1", "Apple (AAPL)"]]),
};

const events: Loaded["events"] = [
  {
    id: "e2", type: "sell", date: "2026-02-10", createdAt: "2026-02-10T10:00:00Z", correctionKind: null, splitRatio: null, note: "=HYPERLINK(\"x\")",
    lines: [{ id: "l3", kind: "position", accountId: "A1", instrumentId: "I1", currency: "USD", amount: new D("-0.1234567891"), role: "trade", costAmount: null, costEstimated: false, costFxRefs: null }],
  },
  {
    id: "e1", type: "buy", date: "2026-02-01", createdAt: "2026-02-01T10:00:00Z", correctionKind: null, splitRatio: null, note: "első\nsor",
    lines: [
      { id: "l1", kind: "position", accountId: "A1", instrumentId: "I1", currency: "USD", amount: new D("10"), role: "trade", costAmount: new D("12345678901234567.1234567891"), costEstimated: false, costFxRefs: { HUF: ["fx1"] } },
      { id: "l2", kind: "cash", accountId: "A1", instrumentId: null, currency: "USD", amount: new D("-1000"), role: "trade", costAmount: null, costEstimated: false, costFxRefs: null },
    ],
  },
];

describe("CSV", () => {
  it("CRLF, quoting of commas, quotes and line breaks", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", null]])).toBe('﻿a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",\r\n');
  });

  it("text that a spreadsheet would run as a formula is neutralised; numbers are not", () => {
    expect(toCsv(["t", "n"], [["=1+1", new D("-5")], ["@SUM(A1)", -5], ["+36", new D("0.1")]])).toBe("﻿t,n\r\n'=1+1,-5\r\n'@SUM(A1),-5\r\n'+36,0.1\r\n");
  });

  it("transactions: one row per line, oldest first, exact decimals", () => {
    const rows = transactionsCsv({ events }, names, (t) => ({ buy: "Vétel", sell: "Eladás" })[t] ?? t).split("\r\n");
    expect(rows[0]).toBe("﻿date,event_id,type,type_label,correction_kind,split_ratio,note,account_id,account,instrument_id,instrument,line_kind,role,currency,amount,cost_amount,cost_estimated");
    expect(rows[1]).toBe('2026-02-01,e1,buy,Vétel,,,"első\nsor",A1,"Bróker · Fő, ""USD""",I1,Apple (AAPL),position,trade,USD,10,12345678901234567.1234567891,false');
    expect(rows[2]).toBe('2026-02-01,e1,buy,Vétel,,,"első\nsor",A1,"Bróker · Fő, ""USD""",,,cash,trade,USD,-1000,,');
    expect(rows[3]).toBe(`2026-02-10,e2,sell,Eladás,,,"'=HYPERLINK(""x"")",A1,"Bróker · Fő, ""USD""",I1,Apple (AAPL),position,trade,USD,-0.1234567891,,`);
  });

  it("positions: securities and cash, value in own and display currency", () => {
    const csv = positionsCsv(
      {
        today: "2026-09-26", currency: "HUF", total: new D(0), complete: true,
        positions: [{
          accountId: "A1", instrumentId: "I1", quantity: new D(10), currency: "USD", valuation: "market", price: new D(220), valueSource: "yahoo",
          valueAsOf: "2026-09-25", ageDays: 1, stale: false, native: new D(2200), display: new D(792000), cost: new D(2000), costEstimated: true,
          unrealized: new D(200), unrealizedRate: new D("0.1"), realized: new D(0), realizedIncomplete: false, incomeNet: new D("8.5"),
        }],
        cash: [{ accountId: "A1", currency: "EUR", amount: new D(49), display: null }],
      },
      names,
    ).split("\r\n");
    expect(rows(csv)).toEqual([
      'A1,"Bróker · Fő, ""USD""",I1,Apple (AAPL),position,10,USD,220,yahoo,2026-09-25,2200,792000,HUF,2000,true,200,0,8.5',
      'A1,"Bróker · Fő, ""USD""",,,cash,,EUR,,,2026-09-26,49,,HUF,,,,,',
    ]);
  });
});

const rows = (lines: string[]) => lines.slice(1).filter(Boolean);

describe("JSON", () => {
  it("has a format marker, keeps decimals as strings and leaves out owner ids", () => {
    const data = {
      institutions: [{ id: "N1", owner_id: "U", name: "Bróker", created_at: "t" }],
      accountMeta: [],
      instrumentMeta: [],
      events,
      logs: { quotes: [], valuations: [], fx: [] },
    } as unknown as Loaded;
    const doc = JSON.parse(exportJson(data, "2026-09-26T20:00:00.000Z"));
    expect(doc).toMatchObject({ format: "horizon-export", version: 1, exportedAt: "2026-09-26T20:00:00.000Z" });
    expect(doc.institutions).toEqual([{ id: "N1", name: "Bróker", created_at: "t" }]);
    expect(doc.events[1].lines[0]).toMatchObject({ amount: "10", costAmount: "12345678901234567.1234567891", costFxRefs: { HUF: ["fx1"] } });
  });
});
