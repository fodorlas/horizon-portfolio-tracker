/**
 * Simple entries in the database (4c plan §5): record_entry creates a broker,
 * an account and instruments together with the entry's events in one
 * transaction; replace_entry and delete_entry treat the entry as one unit;
 * delete_account and delete_instrument remove everything that belongs to them.
 * Everything runs in rolled-back transactions.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type Actor, actors, withScenario, type Scenario } from "./harness";

const T = "2026-03-01";
const EOD = (day: string) => `${day}T21:59:59Z`; // end of a Budapest winter day

type Ids = { inst: string; acc: string; stock: string; hold: string };

/** A broker, one account (tracking start T), a Yahoo stock and a manual item. */
async function seed(s: Scenario): Promise<Ids> {
  const owner = s.fx.owner.userId;
  const inst = (await s.admin(`insert into public.institutions (owner_id, name) values ($1, 'Bróker') returning id`, [owner])).rows[0].id as string;
  const acc = (
    await s.admin(`insert into public.accounts (owner_id, institution_id, name, tracking_start_date) values ($1, $2, 'Számla', $3) returning id`, [owner, inst, T])
  ).rows[0].id as string;
  const stock = (
    await s.admin(
      `insert into public.instruments (owner_id, name, asset_class, currency, valuation, price_source, provider_symbol)
       values ($1, 'Példa', 'stock', 'EUR', 'market', 'yahoo', 'PLDA.DE') returning id`,
      [owner],
    )
  ).rows[0].id as string;
  const hold = (
    await s.admin(`insert into public.instruments (owner_id, name, asset_class, currency, valuation) values ($1, 'Hold', 'fund', 'HUF', 'manual') returning id`, [owner])
  ).rows[0].id as string;
  return { inst, acc, stock, hold };
}

const pos = (acc: string, inst: string, ccy: string, amount: string, role: string, cost?: string, estimated = false) => ({
  kind: "position", accountId: acc, instrumentId: inst, currency: ccy, amount, role, costAmount: cost ?? null, costEstimated: estimated, costFxRefs: null,
});
const cash = (acc: string, ccy: string, amount: string, role: string) => ({
  kind: "cash", accountId: acc, instrumentId: null, currency: ccy, amount, role, costAmount: null, costEstimated: false, costFxRefs: null,
});

function buyEntry(id: string, acc: string, inst: string, date: string, qty: string, total: string) {
  return {
    id,
    events: [
      { type: "deposit", date, note: null, lines: [cash(acc, "EUR", total, "external")], quotes: [], valuations: [] },
      { type: "buy", date, note: null, lines: [pos(acc, inst, "EUR", qty, "trade", total), cash(acc, "EUR", `-${total}`, "trade")], quotes: [], valuations: [] },
    ],
  };
}

function sellEntry(id: string, acc: string, inst: string, date: string, qty: string, total: string) {
  return {
    id,
    events: [
      { type: "sell", date, note: null, lines: [pos(acc, inst, "EUR", `-${qty}`, "trade"), cash(acc, "EUR", total, "trade")], quotes: [], valuations: [] },
      { type: "withdrawal", date, note: null, lines: [cash(acc, "EUR", `-${total}`, "external")], quotes: [], valuations: [] },
    ],
  };
}

const record = (s: Scenario, actor: Actor, p: unknown) => s.as(actor, `select public.record_entry($1::jsonb) as ids`, [JSON.stringify(p)]);
const replace = (s: Scenario, actor: Actor, id: string, p: unknown) =>
  s.as(actor, `select public.replace_entry($1::uuid, $2::jsonb) as ids`, [id, JSON.stringify(p)]);
const count = async (s: Scenario, sql: string, params: unknown[] = []) => (await s.admin(`select count(*)::int as n from ${sql}`, params)).rows[0].n as number;
/** What the end of the request's transaction does: the deferred checks and clean-ups run. */
const commit = (s: Scenario) => s.admin(`set constraints all immediate`);

describe("record_entry", () => {
  it("creates a broker, an account and instruments with an opening entry, in one call", async () => {
    await withScenario(async (s) => {
      const me = actors(s.fx).ownerTrusted;
      const [instId, accId, yahooId, holdId, entryA, entryB] = Array.from({ length: 6 }, randomUUID);
      const r = await record(s, me, {
        institution: { id: instId, name: "Új bróker" },
        account: { id: accId, institutionId: instId, name: "Új számla", accountType: "tbsz", trackingStart: T },
        instruments: [
          { id: yahooId, name: "Fake Co", assetClass: "stock", currency: "EUR", ticker: "FAKECO", exchange: "FAKE", valuation: "market", priceSource: "yahoo", providerSymbol: "FAKECO" },
          { id: holdId, name: "Hold", assetClass: "fund", currency: "HUF", ticker: null, exchange: null, valuation: "manual", priceSource: "manual", providerSymbol: null },
        ],
        yahooQuotes: [{ instrumentId: yahooId, price: "112.5", currency: "EUR", asOf: EOD("2026-02-27") }],
        entries: [
          { id: entryA, events: [{ type: "opening_balance", date: T, note: null, lines: [pos(accId, yahooId, "EUR", "12", "opening", "1350", true)], quotes: [], valuations: [] }] },
          {
            id: entryB,
            events: [
              {
                type: "opening_balance", date: T, note: null, lines: [pos(accId, holdId, "HUF", "5000000", "opening", "5000000", true)], quotes: [],
                valuations: [{ accountId: accId, instrumentId: holdId, value: "5000000", currency: "HUF", asOf: EOD(T), note: "Nyitó érték" }],
              },
            ],
          },
        ],
      });
      expect(r.error, r.message).toBeUndefined();
      expect([...(r.rows[0].ids as string[])].sort()).toEqual([entryA, entryB].sort());

      expect(await count(s, `public.institutions where id = $1 and owner_id = $2`, [instId, s.fx.owner.userId])).toBe(1);
      expect((await s.admin(`select account_type, tracking_start_date::text as t from public.accounts where id = $1`, [accId])).rows[0]).toEqual({ account_type: "tbsz", t: T });
      expect(await count(s, `public.events where entry_id = $1 and event_type = 'opening_balance'`, [entryA])).toBe(1);
      // The Yahoo close is an independent observation; the manual value belongs to its entry.
      expect((await s.admin(`select source, entry_id from public.price_quotes where instrument_id = $1`, [yahooId])).rows).toEqual([{ source: "yahoo", entry_id: null }]);
      expect((await s.admin(`select entry_id from public.manual_valuations where instrument_id = $1`, [holdId])).rows).toEqual([{ entry_id: entryB }]);
    });
  });

  it("quotes carry their source: a BÉT paper's close is a BÉT row, a Yahoo one a Yahoo row", async () => {
    await withScenario(async (s) => {
      const me = actors(s.fx).ownerTrusted;
      const [betId, yahooId] = Array.from({ length: 2 }, randomUUID);
      const r = await record(s, me, {
        instruments: [
          { id: betId, name: "TESZTETF", assetClass: "etf", currency: "EUR", ticker: "TESZTETF", exchange: "BÉT", valuation: "market", priceSource: "bet", providerSymbol: "TESZTETF" },
          { id: yahooId, name: "Fake Co", assetClass: "stock", currency: "EUR", ticker: "FAKEQ", exchange: "FAKE", valuation: "market", priceSource: "yahoo", providerSymbol: "FAKEQ" },
        ],
        quotes: [
          { instrumentId: betId, price: "21.575", currency: "EUR", asOf: EOD("2026-02-27"), source: "bet" },
          { instrumentId: yahooId, price: "10", currency: "EUR", asOf: EOD("2026-02-27"), source: "yahoo" },
        ],
        entries: [],
      });
      expect(r.error, r.message).toBeUndefined();
      expect((await s.admin(`select source from public.price_quotes where instrument_id = $1`, [betId])).rows).toEqual([{ source: "bet" }]);
      expect((await s.admin(`select source from public.price_quotes where instrument_id = $1`, [yahooId])).rows).toEqual([{ source: "yahoo" }]);
    });
  });

  it("a quote of any other source, or without one, is refused", async () => {
    await withScenario(async (s) => {
      const { stock } = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      for (const source of ["manual", undefined]) {
        const r = await record(s, me, { instruments: [], quotes: [{ instrumentId: stock, price: "1", currency: "EUR", asOf: EOD("2026-02-27"), source }], entries: [] });
        expect(r.error, String(source)).toBe("22023");
      }
    });
  });

  it("refuses a second BÉT instrument with the same code, whatever the case; another owner may have it", async () => {
    await withScenario(async (s) => {
      const me = actors(s.fx).ownerTrusted;
      const bet = (code: string) => ({ id: randomUUID(), name: code, assetClass: "stock", currency: "HUF", ticker: code, exchange: "BÉT", valuation: "market", priceSource: "bet", providerSymbol: code });
      expect((await record(s, me, { instruments: [bet("OTP")], entries: [] })).error).toBeUndefined();
      expect((await record(s, me, { instruments: [bet("otp")], entries: [] })).error).toBe("23505");
      const other = await s.admin(
        `insert into public.instruments (owner_id, name, asset_class, currency, price_source, provider_symbol) values ($1, 'OTP', 'stock', 'HUF', 'bet', 'OTP') returning id`,
        [s.fx.stranger.userId],
      );
      expect(other.rows).toHaveLength(1);
    });
  });

  it("an invalid event leaves nothing behind: no broker, no account, no instrument", async () => {
    await withScenario(async (s) => {
      const me = actors(s.fx).ownerTrusted;
      const [instId, accId, yahooId] = Array.from({ length: 3 }, randomUUID);
      const r = await record(s, me, {
        institution: { id: instId, name: "Új bróker" },
        account: { id: accId, institutionId: instId, name: "Új számla", accountType: "normal", trackingStart: T },
        instruments: [{ id: yahooId, name: "Fake Co", assetClass: "stock", currency: "EUR", ticker: null, exchange: null, valuation: "market", priceSource: "yahoo", providerSymbol: "FAKECO" }],
        // Opening balances belong to the tracking-start day only.
        entries: [{ id: randomUUID(), events: [{ type: "opening_balance", date: "2026-03-05", note: null, lines: [pos(accId, yahooId, "EUR", "1", "opening", "1", true)], quotes: [], valuations: [] }] }],
      });
      expect(r.error).toBe("23514");
      expect(await count(s, `public.institutions where id = $1`, [instId])).toBe(0);
      expect(await count(s, `public.instruments where id = $1`, [yahooId])).toBe(0);
    });
  });

  it("refuses a second Yahoo instrument with the same symbol, whatever the case", async () => {
    await withScenario(async (s) => {
      await seed(s);
      const r = await record(s, actors(s.fx).ownerTrusted, {
        instruments: [{ id: randomUUID(), name: "Dupla", assetClass: "stock", currency: "EUR", ticker: null, exchange: null, valuation: "market", priceSource: "yahoo", providerSymbol: "plda.de" }],
        entries: [],
      });
      expect(r.error).toBe("23505");
    });
  });

  it("only the simple event types, and never an entry id that is already in use", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const id = randomUUID();
      expect((await record(s, me, { entries: [buyEntry(id, ids.acc, ids.stock, "2026-03-05", "10", "1000")] })).error).toBeUndefined();
      expect((await record(s, me, { entries: [buyEntry(id, ids.acc, ids.stock, "2026-03-06", "1", "100")] })).error).toBe("22023");
      const fee = { id: randomUUID(), events: [{ type: "fee", date: "2026-03-06", note: null, lines: [cash(ids.acc, "EUR", "-1", "fee")], quotes: [], valuations: [] }] };
      expect((await record(s, me, { entries: [fee] })).error).toBe("22023");
    });
  });

  it("a buy entry is a deposit and a buy: the cash nets to zero", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const id = randomUUID();
      expect((await record(s, actors(s.fx).ownerTrusted, { entries: [buyEntry(id, ids.acc, ids.stock, "2026-03-05", "10", "1000")] })).error).toBeUndefined();
      const sum = await s.admin(
        `select coalesce(sum(l.amount), 0)::text as total from public.lines l join public.events e on e.id = l.event_id where e.entry_id = $1 and l.kind = 'cash'`,
        [id],
      );
      expect(sum.rows[0].total).toBe("0.0000000000");
    });
  });

  it("moves the tracking start earlier on request, and only earlier", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const r = await record(s, me, { trackingStart: { accountId: ids.acc, day: "2026-01-31" }, entries: [buyEntry(randomUUID(), ids.acc, ids.stock, "2026-02-01", "1", "100")] });
      expect(r.error, r.message).toBeUndefined();
      expect((await s.admin(`select tracking_start_date::text as t from public.accounts where id = $1`, [ids.acc])).rows[0].t).toBe("2026-01-31");
      const later = await record(s, me, { trackingStart: { accountId: ids.acc, day: "2026-02-15" }, entries: [] });
      expect(later.error).toBe("23514");
      expect(later.message).toContain("tracking_start_later");
    });
  });

  it("is refused for the stranger, an aal1 session and an unapproved factor", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const a = actors(s.fx);
      for (const actor of [a.strangerAal2, a.ownerAal1, a.ownerUnapprovedFactor, a.ownerStaleTotp]) {
        const r = await record(s, actor, { entries: [buyEntry(randomUUID(), ids.acc, ids.stock, "2026-03-05", "1", "100")] });
        expect(r.error).toBe("42501");
      }
    });
  });
});

describe("tracking start of an account", () => {
  it("may move earlier without an opening balance, never later, never with one", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const move = (day: string) => s.as(me, `update public.accounts set tracking_start_date = $2 where id = $1`, [ids.acc, day]);
      expect((await move("2026-02-20")).error).toBeUndefined();
      const later = await move("2026-02-25");
      expect(later.error).toBe("23514");
      expect(later.message).toContain("tracking_start_later");

      await record(s, me, {
        entries: [{ id: randomUUID(), events: [{ type: "opening_balance", date: "2026-02-20", note: null, lines: [cash(ids.acc, "EUR", "100", "opening")], quotes: [], valuations: [] }] }],
      });
      const withOpening = await move("2026-02-10");
      expect(withOpening.error).toBe("23514");
      expect(withOpening.message).toContain("tracking_start_has_opening");
      // Renaming is still fine.
      expect((await s.as(me, `update public.accounts set name = 'Átnevezve' where id = $1`, [ids.acc])).error).toBeUndefined();
    });
  });
});

describe("replace_entry", () => {
  it("keeps the entry id and its place in the day's order", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const id = randomUUID();
      await record(s, me, { entries: [buyEntry(id, ids.acc, ids.stock, "2026-03-05", "10", "1000")] });
      await s.admin(`update public.events set created_at = '2026-03-05T08:00:00Z' where entry_id = $1`, [id]);

      const r = await replace(s, me, id, { entries: [buyEntry(id, ids.acc, ids.stock, "2026-03-06", "12", "1300")] });
      expect(r.error, r.message).toBeUndefined();
      const rows = await s.admin(`select event_type, event_date::text as d, created_at from public.events where entry_id = $1 order by event_type`, [id]);
      expect(rows.rows.map((x) => [x.event_type, x.d])).toEqual([["buy", "2026-03-06"], ["deposit", "2026-03-06"]]);
      for (const x of rows.rows) expect((x.created_at as Date).toISOString()).toBe("2026-03-05T08:00:00.000Z");
      expect(await count(s, `public.lines l join public.events e on e.id = l.event_id where e.entry_id = $1`, [id])).toBe(3);
    });
  });

  it("the history check refuses a change that a later sale depends on", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const buy = randomUUID();
      await record(s, me, { entries: [buyEntry(buy, ids.acc, ids.stock, "2026-03-05", "10", "1000")] });
      await record(s, me, { entries: [sellEntry(randomUUID(), ids.acc, ids.stock, "2026-03-10", "8", "900")] });
      const r = await replace(s, me, buy, { entries: [buyEntry(buy, ids.acc, ids.stock, "2026-03-05", "5", "500")] });
      expect(r.error).toBe("23514");
      expect(r.message).toContain("invalid_history");
      // Unchanged.
      expect((await s.admin(`select l.amount::text as q from public.lines l join public.events e on e.id = l.event_id where e.entry_id = $1 and l.kind = 'position'`, [buy])).rows[0].q).toBe("10.0000000000");
    });
  });

  it("refuses a payload for another entry and an unknown entry", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const id = randomUUID();
      await record(s, me, { entries: [buyEntry(id, ids.acc, ids.stock, "2026-03-05", "10", "1000")] });
      expect((await replace(s, me, id, { entries: [buyEntry(randomUUID(), ids.acc, ids.stock, "2026-03-05", "1", "1")] })).error).toBe("22023");
      const other = randomUUID();
      expect((await replace(s, me, other, { entries: [buyEntry(other, ids.acc, ids.stock, "2026-03-05", "1", "1")] })).error).toBe("P0002");
    });
  });
});

describe("delete_entry", () => {
  it("removes the events, the entry's own price and value and their corrections; other rows stay", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const id = randomUUID();
      await record(s, me, {
        entries: [
          {
            id,
            events: [
              {
                type: "opening_balance", date: T, note: null,
                lines: [pos(ids.acc, ids.stock, "EUR", "2", "opening", "200", true), pos(ids.acc, ids.hold, "HUF", "1000", "opening", "1000", true)],
                quotes: [{ instrumentId: ids.stock, price: "100", currency: "EUR", asOf: EOD(T), note: "Nyitó ár" }],
                valuations: [{ accountId: ids.acc, instrumentId: ids.hold, value: "1000", currency: "HUF", asOf: EOD(T), note: "Nyitó érték" }],
              },
            ],
          },
        ],
      });
      const own = (await s.admin(`select id from public.price_quotes where entry_id = $1`, [id])).rows[0].id as string;
      const ownValue = (await s.admin(`select id from public.manual_valuations where entry_id = $1`, [id])).rows[0].id as string;
      // A correction of the entry's price made on the prices page, and an independent price.
      await s.as(me, `insert into public.price_quotes (instrument_id, price, currency, as_of, source, note, supersedes_id) values ($1, 101, 'EUR', $2, 'manual', 'javítás', $3)`, [ids.stock, EOD(T), own]);
      await s.as(me, `insert into public.price_quotes (instrument_id, price, currency, as_of, source, note) values ($1, 105, 'EUR', $2, 'manual', 'másik')`, [ids.stock, EOD("2026-03-03")]);
      // Another entry keeps the stock in use (the fund, used only here, goes with its last line).
      await record(s, me, { entries: [buyEntry(randomUUID(), ids.acc, ids.stock, "2026-03-05", "1", "100")] });

      const r = await s.as(me, `select public.delete_entry($1) as n`, [id]);
      expect(r.error, r.message).toBeUndefined();
      expect(r.rows[0].n).toBe(1);
      expect(await count(s, `public.events where entry_id = $1`, [id])).toBe(0);
      expect((await s.admin(`select note from public.price_quotes where instrument_id = $1`, [ids.stock])).rows).toEqual([{ note: "másik" }]);
      expect(await count(s, `public.manual_valuations where instrument_id = $1`, [ids.hold])).toBe(0);
      // The audit log keeps what was deleted.
      expect(await count(s, `private.audit_log where action = 'DELETE' and table_name = 'public.price_quotes' and row_key = $1`, [own])).toBe(1);
      expect(await count(s, `private.audit_log where action = 'DELETE' and table_name = 'public.manual_valuations' and row_key = $1`, [ownValue])).toBe(1);
    });
  });

  it("an unknown entry is an error, and only the trusted owner may delete", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const a = actors(s.fx);
      const id = randomUUID();
      await record(s, a.ownerTrusted, { entries: [buyEntry(id, ids.acc, ids.stock, "2026-03-05", "10", "1000")] });
      expect((await s.as(a.ownerTrusted, `select public.delete_entry($1)`, [randomUUID()])).error).toBe("P0002");
      for (const actor of [a.strangerAal2, a.strangerStolenSession, a.ownerAal1, a.ownerUnapprovedFactor, a.anon]) {
        expect((await s.as(actor, `select public.delete_entry($1)`, [id])).error).toBe("42501");
      }
      expect(await count(s, `public.events where entry_id = $1`, [id])).toBe(2);
    });
  });
});

describe("delete_account", () => {
  it("needs the account's name, then removes everything on it and the broker it leaves empty", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const owner = s.fx.owner.userId;
      await record(s, me, { entries: [buyEntry(randomUUID(), ids.acc, ids.stock, "2026-03-05", "10", "1000")] });
      await s.as(me, `insert into public.manual_valuations (account_id, instrument_id, value, currency, as_of) values ($1, $2, 1, 'HUF', $3)`, [ids.acc, ids.hold, EOD(T)]);
      // A cash transfer to a second account at another broker: its other side goes too.
      const inst2 = (await s.admin(`insert into public.institutions (owner_id, name) values ($1, 'Bank') returning id`, [owner])).rows[0].id;
      const acc2 = (await s.admin(`insert into public.accounts (owner_id, institution_id, name, tracking_start_date) values ($1, $2, 'Másik', $3) returning id`, [owner, inst2, T])).rows[0].id;
      await s.as(me, `select public.record_event($1, $2)`, [
        { type: "transfer", date: "2026-03-07" },
        JSON.stringify([cash(ids.acc, "EUR", "-10", "transfer"), cash(acc2 as string, "EUR", "10", "transfer")]),
      ]);

      const wrong = await s.as(me, `select public.delete_account($1, $2)`, [ids.acc, "Számla2"]);
      expect(wrong.error).toBe("22023");
      expect(wrong.message).toContain("name_mismatch");

      const r = await s.as(me, `select public.delete_account($1, $2) as summary`, [ids.acc, " Számla "]);
      expect(r.error, r.message).toBeUndefined();
      expect(r.rows[0].summary).toEqual({ events: 3, valuations: 1 });
      await commit(s);
      expect(await count(s, `public.accounts where id = $1`, [ids.acc])).toBe(0);
      expect(await count(s, `public.lines where account_id = $1`, [acc2])).toBe(0);
      expect(await count(s, `public.manual_valuations where account_id = $1`, [ids.acc])).toBe(0);
      expect(await count(s, `public.institutions where id = $1`, [ids.inst])).toBe(0);
      expect(await count(s, `public.institutions where id = $1`, [inst2])).toBe(1);
      // It had no line on any other account.
      expect(await count(s, `public.instruments where id = $1`, [ids.stock])).toBe(0);
      expect(await count(s, `private.audit_log where action = 'DELETE' and table_name = 'public.accounts' and row_key = $1`, [ids.acc])).toBe(1);
    });
  });

  it("keeps the broker while it has another account", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      await s.admin(`insert into public.accounts (owner_id, institution_id, name, tracking_start_date) values ($1, $2, 'Második', $3)`, [s.fx.owner.userId, ids.inst, T]);
      expect((await s.as(actors(s.fx).ownerTrusted, `select public.delete_account($1, 'Számla')`, [ids.acc])).error).toBeUndefined();
      expect(await count(s, `public.institutions where id = $1`, [ids.inst])).toBe(1);
    });
  });

  it("is refused for anyone but the trusted owner", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const a = actors(s.fx);
      for (const actor of [a.strangerAal2, a.ownerAal1, a.ownerUnapprovedFactor, a.anon]) {
        expect((await s.as(actor, `select public.delete_account($1, 'Számla')`, [ids.acc])).error).toBe("42501");
      }
      expect(await count(s, `public.accounts where id = $1`, [ids.acc])).toBe(1);
    });
  });
});

describe("delete_instrument and instrument changes", () => {
  it("an instrument in use cannot be deleted; an unused one goes with its prices and values", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      await record(s, me, { entries: [buyEntry(randomUUID(), ids.acc, ids.stock, "2026-03-05", "10", "1000")] });
      const used = await s.as(me, `select public.delete_instrument($1)`, [ids.stock]);
      expect(used.error).toBe("23503");

      await s.as(me, `insert into public.price_quotes (instrument_id, price, currency, as_of, source, note) values ($1, 1, 'HUF', $2, 'manual', 'x')`, [ids.hold, EOD(T)]);
      await s.as(me, `insert into public.manual_valuations (account_id, instrument_id, value, currency, as_of) values ($1, $2, 1, 'HUF', $3)`, [ids.acc, ids.hold, EOD(T)]);
      expect((await s.as(me, `select public.delete_instrument($1)`, [ids.hold])).error).toBeUndefined();
      expect(await count(s, `public.instruments where id = $1`, [ids.hold])).toBe(0);
      expect(await count(s, `public.price_quotes where instrument_id = $1`, [ids.hold])).toBe(0);

      for (const actor of [actors(s.fx).strangerAal2, actors(s.fx).ownerAal1]) {
        expect((await s.as(actor, `select public.delete_instrument($1)`, [ids.stock])).error).toBe("42501");
      }
    });
  });

  it("currency and valuation are fixed once the instrument is used; names are not", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      expect((await s.as(me, `update public.instruments set currency = 'USD' where id = $1`, [ids.stock])).error).toBeUndefined();
      expect((await s.as(me, `update public.instruments set currency = 'EUR' where id = $1`, [ids.stock])).error).toBeUndefined();
      await record(s, me, { entries: [buyEntry(randomUUID(), ids.acc, ids.stock, "2026-03-05", "10", "1000")] });
      const ccy = await s.as(me, `update public.instruments set currency = 'USD' where id = $1`, [ids.stock]);
      expect(ccy.error).toBe("23514");
      expect(ccy.message).toContain("instrument_currency_locked");
      expect((await s.as(me, `update public.instruments set valuation = 'manual' where id = $1`, [ids.stock])).error).toBe("23514");
      expect((await s.as(me, `update public.instruments set name = 'Új név', provider_symbol = 'PLDB.DE' where id = $1`, [ids.stock])).error).toBeUndefined();
    });
  });
});

describe("an instrument goes with its last line (2026-09-29)", () => {
  const yahoo = async (s: Scenario, symbol: string) =>
    (
      await s.admin(
        `insert into public.instruments (owner_id, name, asset_class, currency, valuation, price_source, provider_symbol)
         values ($1, $2, 'stock', 'EUR', 'market', 'yahoo', $2) returning id`,
        [s.fx.owner.userId, symbol],
      )
    ).rows[0].id as string;
  const manualQuote = (s: Scenario, me: Actor, inst: string, day: string) =>
    s.as(me, `insert into public.price_quotes (instrument_id, price, currency, as_of, source, note) values ($1, 105, 'EUR', $2, 'manual', 'kézi')`, [inst, EOD(day)]);

  it("deleting its last entry takes it with its prices; one still used, or never used, stays", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const [a, b] = [randomUUID(), randomUUID()];
      await record(s, me, { entries: [buyEntry(a, ids.acc, ids.stock, "2026-03-05", "10", "1000")] });
      await record(s, me, { entries: [buyEntry(b, ids.acc, ids.stock, "2026-03-06", "5", "500")] });
      await manualQuote(s, me, ids.stock, "2026-03-07");

      expect((await s.as(me, `select public.delete_entry($1)`, [a])).error).toBeUndefined();
      await commit(s);
      expect(await count(s, `public.instruments where id = $1`, [ids.stock])).toBe(1);

      expect((await s.as(me, `select public.delete_entry($1)`, [b])).error).toBeUndefined();
      await commit(s);
      expect(await count(s, `public.instruments where id = $1`, [ids.stock])).toBe(0);
      expect(await count(s, `public.price_quotes where instrument_id = $1`, [ids.stock])).toBe(0);
      expect(await count(s, `private.audit_log where action = 'DELETE' and table_name = 'public.instruments' and row_key = $1`, [ids.stock])).toBe(1);
      // Added on the Instruments page, never used.
      expect(await count(s, `public.instruments where id = $1`, [ids.hold])).toBe(1);
    });
  });

  it("an edit keeps the instrument its new version still uses, with its prices; switching papers drops the old one", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const other = await yahoo(s, "PLDC.DE");
      const id = randomUUID();
      await record(s, me, { entries: [buyEntry(id, ids.acc, ids.stock, "2026-03-05", "10", "1000")] });
      await manualQuote(s, me, ids.stock, "2026-03-07");

      const same = await replace(s, me, id, { entries: [buyEntry(id, ids.acc, ids.stock, "2026-03-05", "12", "1200")] });
      expect(same.error, same.message).toBeUndefined();
      await commit(s);
      expect(await count(s, `public.instruments where id = $1`, [ids.stock])).toBe(1);
      expect(await count(s, `public.price_quotes where instrument_id = $1`, [ids.stock])).toBe(1);

      const switched = await replace(s, me, id, { entries: [buyEntry(id, ids.acc, other, "2026-03-05", "12", "1200")] });
      expect(switched.error, switched.message).toBeUndefined();
      await commit(s);
      expect(await count(s, `public.instruments where id = $1`, [ids.stock])).toBe(0);
      expect(await count(s, `public.instruments where id = $1`, [other])).toBe(1);
    });
  });

  it("deleting an account takes the instruments no other account uses, with their values", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const acc2 = (
        await s.admin(`insert into public.accounts (owner_id, institution_id, name, tracking_start_date) values ($1, $2, 'Második', $3) returning id`, [s.fx.owner.userId, ids.inst, T])
      ).rows[0].id as string;
      await record(s, me, { entries: [buyEntry(randomUUID(), ids.acc, ids.stock, "2026-03-05", "10", "1000")] });
      await record(s, me, { entries: [buyEntry(randomUUID(), acc2, ids.stock, "2026-03-05", "1", "100")] });
      const opening = {
        type: "opening_balance", date: T, note: null,
        lines: [pos(ids.acc, ids.hold, "HUF", "1000", "opening", "1000", true)],
        quotes: [],
        valuations: [{ accountId: ids.acc, instrumentId: ids.hold, value: "1000", currency: "HUF", asOf: EOD(T), note: "Nyitó érték" }],
      };
      expect((await record(s, me, { entries: [{ id: randomUUID(), events: [opening] }] })).error).toBeUndefined();
      // A value of the same fund on the other account, without a line there.
      await s.as(me, `insert into public.manual_valuations (account_id, instrument_id, value, currency, as_of) values ($1, $2, 1, 'HUF', $3)`, [acc2, ids.hold, EOD(T)]);

      expect((await s.as(me, `select public.delete_account($1, 'Számla')`, [ids.acc])).error).toBeUndefined();
      await commit(s);
      expect(await count(s, `public.instruments where id = $1`, [ids.stock])).toBe(1);
      expect(await count(s, `public.instruments where id = $1`, [ids.hold])).toBe(0);
      expect(await count(s, `public.manual_valuations where instrument_id = $1`, [ids.hold])).toBe(0);
    });
  });

  it("deleting an advanced transaction does the same", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const ev = await s.as(me, `select public.record_event($1, $2) as id`, [
        { type: "opening_balance", date: T },
        JSON.stringify([pos(ids.acc, ids.stock, "EUR", "2", "opening", "200", true)]),
      ]);
      expect(ev.error, ev.message).toBeUndefined();
      expect((await s.as(me, `delete from public.events where id = $1 returning id`, [ev.rows[0].id])).rows).toHaveLength(1);
      await commit(s);
      expect(await count(s, `public.instruments where id = $1`, [ids.stock])).toBe(0);
    });
  });
});
