import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { consistentRead, loadPortfolio, READ_ATTEMPTS, readGap } from "./load";

// Rows as the separate requests return them; only the keys the check reads.
const rows = () => ({
  accounts: [{ id: "A" }],
  instruments: [{ id: "I" }],
  events: [{ id: "e1" }, { id: "e2" }],
  lines: [
    { event_id: "e1", account_id: "A", instrument_id: null },
    { event_id: "e2", account_id: "A", instrument_id: "I" },
    { event_id: "e2", account_id: "A", instrument_id: null },
  ],
  valuations: [{ account_id: "A", instrument_id: "I" }],
});

describe("readGap: rows read by separate requests must fit together (#92)", () => {
  it("a consistent view has no gap", () => {
    expect(readGap(rows())).toBeNull();
  });

  it("an event read without its lines (a save landed between the two reads)", () => {
    const r = rows();
    r.lines = r.lines.filter((l) => l.event_id !== "e1");
    expect(readGap(r)).toMatch(/event without lines/);
  });

  it("lines of an event not read (a delete landed between the two reads)", () => {
    const r = rows();
    r.events = r.events.filter((e) => e.id !== "e2");
    expect(readGap(r)).toMatch(/line of an event not read/);
  });

  it("a line or a value of an account or instrument not read", () => {
    expect(readGap({ ...rows(), accounts: [] })).toMatch(/account not read/);
    expect(readGap({ ...rows(), instruments: [] })).toMatch(/instrument not read/);
    expect(readGap({ ...rows(), lines: rows().lines.slice(0, 1), events: [{ id: "e1" }], instruments: [] })).toMatch(/value of an instrument not read/);
  });
});

describe("consistentRead: an inconsistent view is read again", () => {
  it("returns a consistent read at once", async () => {
    const read = vi.fn(async () => "ok");
    expect(await consistentRead(read, () => null)).toBe("ok");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads again after an inconsistent view", async () => {
    let n = 0;
    const read = vi.fn(async () => ++n);
    expect(await consistentRead(read, (v) => (v === 1 ? "an event without lines" : null))).toBe(2);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it(`gives up after ${3} reads, naming the gap`, async () => {
    const read = vi.fn(async () => "x");
    await expect(consistentRead(read, () => "an event without lines")).rejects.toThrow(/inconsistent.*an event without lines/);
    expect(read).toHaveBeenCalledTimes(READ_ATTEMPTS);
    expect(READ_ATTEMPTS).toBe(3);
  });
});

describe("loadPortfolio: when the read began (#92)", () => {
  const T0 = Date.parse("2026-10-02T06:00:00.000Z");

  // Every request answers with no rows, except the events of each attempt; the first
  // request of an attempt moves the clock on by 5 s, as a slow read would.
  function fakeDb(eventsByAttempt: unknown[][]) {
    let attempt = -1;
    const query = (table: string) => {
      const result = async () => {
        if (table === "institutions") vi.setSystemTime(T0 + ++attempt * 5000 + 5000);
        return { data: table === "events" ? (eventsByAttempt[attempt] ?? []) : [], error: null };
      };
      const chain: unknown = new Proxy({}, { get: (_, key) => (key === "range" ? result : () => chain) });
      return chain;
    };
    return { from: query, rpc: () => query("price_quotes") } as never;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is the time before the reads, not after: a change during them is newer than it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    expect((await loadPortfolio(fakeDb([[]]))).readAt).toBe("2026-10-02T06:00:00.000Z");
  });

  it("after a re-read, the start of the read that fit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const withoutLines = { id: "e1", event_type: "deposit", event_date: "2026-10-01", created_at: "2026-10-01T10:00:00Z" };
    expect((await loadPortfolio(fakeDb([[withoutLines], []]))).readAt).toBe("2026-10-02T06:00:05.000Z");
  });
});
