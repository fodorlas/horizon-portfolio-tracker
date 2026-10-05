/**
 * Government securities in the database (spec 2026-09-28 §7–§8): bond terms
 * with the instrument, the maturity that repays everything, approvals of
 * proposals and the refresh's proposal sync. Rolled-back transactions only.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type Actor, actors, withScenario, type Scenario } from "./harness";

const T = "2026-03-01";

async function seed(s: Scenario) {
  const owner = s.fx.owner.userId;
  const inst = (await s.admin(`insert into public.institutions (owner_id, name) values ($1, 'Kincstár') returning id`, [owner])).rows[0].id as string;
  const acc = (
    await s.admin(`insert into public.accounts (owner_id, institution_id, name, tracking_start_date) values ($1, $2, 'Értékpapírszámla', $3) returning id`, [owner, inst, T])
  ).rows[0].id as string;
  return { acc };
}

const pos = (acc: string, inst: string, amount: string, cost?: string) => ({
  kind: "position", accountId: acc, instrumentId: inst, currency: "HUF", amount, role: "trade", costAmount: cost ?? null, costEstimated: false, costFxRefs: {},
});
const cash = (acc: string, amount: string, role: string, instrumentId: string | null = null) => ({
  kind: "cash", accountId: acc, instrumentId, currency: "HUF", amount, role, costAmount: null, costEstimated: false, costFxRefs: null,
});
const ev = (type: string, date: string, lines: unknown[]) => ({ type, date, note: null, lines, quotes: [], valuations: [] });

const bond = (id: string, series = "2031/M5") => ({
  id, name: `MÁP Plusz ${series}`, assetClass: "bond", currency: "HUF", ticker: null, exchange: null, valuation: "market", priceSource: "akk", providerSymbol: series,
  bond: { series, securityType: "MÁPP_T", tab: "MAPP", issueDate: "2026-07-20", maturityDate: "2031-08-21" },
});

const record = (s: Scenario, a: Actor, p: unknown) => s.as(a, `select public.record_entry($1::jsonb) as ids`, [JSON.stringify(p)]);

/** A bond bought for 990 (1000 nominal) on 2026-08-01, from a deposit. */
async function bought(s: Scenario, me: Actor, acc: string) {
  const id = randomUUID();
  const r = await record(s, me, {
    instruments: [bond(id)],
    entries: [{ id: randomUUID(), events: [ev("deposit", "2026-08-01", [cash(acc, "990", "external")]), ev("buy", "2026-08-01", [pos(acc, id, "1000", "990"), cash(acc, "-990", "trade")])] }],
  });
  expect(r.error, r.message).toBeUndefined();
  return id;
}

describe("an ÁKK instrument", () => {
  it("brings its terms, and a series is one instrument per owner", async () => {
    await withScenario(async (s) => {
      const { acc } = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const id = await bought(s, me, acc);
      const terms = await s.as(me, `select series, security_type, tab, issue_date::text, maturity_date::text, check_status from public.bond_terms where instrument_id = $1`, [id]);
      expect(terms.rows).toEqual([{ series: "2031/M5", security_type: "MÁPP_T", tab: "MAPP", issue_date: "2026-07-20", maturity_date: "2031-08-21", check_status: "unknown" }]);
      const again = await record(s, me, { instruments: [bond(randomUUID())], entries: [] });
      expect(again.error).toBe("23505");
    });
  });
});

describe("interest in papers and the maturity", () => {
  it("interest_reinvest adds units at their cost; a maturity takes all of them", async () => {
    await withScenario(async (s) => {
      const { acc } = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const id = await bought(s, me, acc);
      const credit = await record(s, me, {
        entries: [{ id: randomUUID(), events: [ev("interest_reinvest", "2026-08-21", [cash(acc, "61", "income", id), cash(acc, "-61", "trade"), pos(acc, id, "61", "61")])] }],
      });
      expect(credit.error, credit.message).toBeUndefined();
      const held = await s.as(me, `select sum(amount)::text as q from public.lines where instrument_id = $1 and kind = 'position'`, [id]);
      expect(held.rows[0].q).toBe("1061.0000000000");

      const partial = await record(s, me, {
        entries: [{ id: randomUUID(), events: [ev("maturity", "2026-09-01", [pos(acc, id, "-600"), cash(acc, "600", "trade")])] }],
      });
      expect(partial.error).toBe("23514");
      expect(partial.message).toContain("maturity_leaves_units");

      const all = await record(s, me, {
        entries: [{ id: randomUUID(), events: [ev("maturity", "2026-09-01", [pos(acc, id, "-1061"), cash(acc, "1061", "trade"), cash(acc, "30", "income", id)])] }],
      });
      expect(all.error, all.message).toBeUndefined();
    });
  });
});

describe("approving a proposal", () => {
  it("marks it approved with its entry; twice is refused; deleting the entry reopens it", async () => {
    await withScenario(async (s) => {
      const { acc } = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const id = await bought(s, me, acc);
      const p = await s.as(
        me,
        `insert into public.pending_events (instrument_id, account_id, kind, due_date, nominal, percent, amount) values ($1, $2, 'interest_reinvest', '2026-08-21', 1000, 6.11, 61) returning id`,
        [id, acc],
      );
      const pendingId = p.rows[0].id as string;
      const entryId = randomUUID();
      const entry = { id: entryId, events: [ev("interest_reinvest", "2026-08-21", [cash(acc, "61", "income", id), cash(acc, "-61", "trade"), pos(acc, id, "61", "61")])] };

      const ok = await record(s, me, { pending: { id: pendingId, edited: false }, entries: [entry] });
      expect(ok.error, ok.message).toBeUndefined();
      const row = async () => (await s.as(me, `select status, entry_id from public.pending_events where id = $1`, [pendingId])).rows[0];
      expect(await row()).toEqual({ status: "approved", entry_id: entryId });

      const twice = await record(s, me, { pending: { id: pendingId }, entries: [{ ...entry, id: randomUUID() }] });
      expect(twice.error).toBe("22023");
      expect(twice.message).toContain("pending_not_open");

      const del = await s.as(me, `select public.delete_entry($1::uuid) as n`, [entryId]);
      expect(del.error, del.message).toBeUndefined();
      expect(await row()).toEqual({ status: "open", entry_id: null });

      // An edited approval sent back is a proposal again: the refresh may give it new figures.
      const again = { ...entry, id: randomUUID() };
      expect((await record(s, me, { pending: { id: pendingId, edited: true }, entries: [again] })).error).toBeUndefined();
      await s.as(me, `select public.delete_entry($1::uuid)`, [again.id]);
      expect((await s.as(me, `select status, edited from public.pending_events where id = $1`, [pendingId])).rows[0]).toEqual({ status: "open", edited: false });
    });
  });
});

describe("sync_pending_events", () => {
  it("adds, updates what the owner did not touch, drops what no longer applies, keeps decisions", async () => {
    await withScenario(async (s) => {
      const { acc } = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const id = await bought(s, me, acc);
      const item = (due: string, amount: string | null) => ({
        instrumentId: id, accountId: acc, kind: "interest_reinvest", due, nominal: "1000", percent: amount ? "6.11" : null, amount, basis: { start: "2025-09-02" },
      });
      const sync = (rows: unknown[]) => s.as(me, `select public.sync_pending_events($1::jsonb) as n`, [JSON.stringify(rows)]);
      const rows = async () =>
        (await s.as(me, `select due_date::text as due, status, amount::text, edited from public.pending_events order by due_date`)).rows;

      expect((await sync([item("2026-08-21", null), item("2026-09-21", "61"), item("2026-10-21", "61")])).error).toBeUndefined();
      expect(await rows()).toEqual([
        { due: "2026-08-21", status: "open", amount: null, edited: false },
        { due: "2026-09-21", status: "open", amount: "61.0000000000", edited: false },
        { due: "2026-10-21", status: "open", amount: "61.0000000000", edited: false },
      ]);

      await s.as(me, `update public.pending_events set amount = 60, edited = true where due_date = '2026-09-21'`);
      await s.as(me, `update public.pending_events set status = 'dismissed' where due_date = '2026-10-21'`);
      // The first one gets its figure, the edited one keeps the owner's, the second-last is gone from the list.
      const r = await sync([item("2026-08-21", "61"), item("2026-09-21", "62")]);
      expect(r.error, r.message).toBeUndefined();
      expect(await rows()).toEqual([
        { due: "2026-08-21", status: "open", amount: "61.0000000000", edited: false },
        { due: "2026-09-21", status: "open", amount: "60.0000000000", edited: true },
        { due: "2026-10-21", status: "dismissed", amount: "61.0000000000", edited: false },
      ]);

      // A computed row that vanished is removed only while open or snoozed.
      await sync([item("2026-09-21", "62")]);
      expect((await rows()).map((x) => x.due)).toEqual(["2026-09-21", "2026-10-21"]);
    });
  });

  it("keeps a proposal that changed after the refresh read its data (a send-back meanwhile, #92); without a read time, the old rule", async () => {
    await withScenario(async (s) => {
      const { acc } = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const id = await bought(s, me, acc);
      const item = (due: string) => ({ instrumentId: id, accountId: acc, kind: "interest_reinvest", due, nominal: "1000", percent: null, amount: null, basis: { start: "2025-09-02" } });
      const sync = (rows: unknown[], readAt: string | null) =>
        s.as(me, `select public.sync_pending_events($1::jsonb, $2::timestamptz) as n`, [JSON.stringify(rows), readAt]);
      const dues = async () => (await s.as(me, `select due_date::text as due from public.pending_events order by due_date`)).rows.map((r) => r.due);

      expect((await sync([item("2026-08-21"), item("2026-09-21")], null)).error).toBeUndefined();
      // now() is fixed inside the test's transaction: the change times are set by hand.
      await s.db.query(`update public.pending_events set updated_at = '2026-10-01T10:00:00Z' where due_date = '2026-08-21'`);
      await s.db.query(`update public.pending_events set updated_at = '2026-10-01T12:00:00Z' where due_date = '2026-09-21'`);

      // The refresh read at 11:00 and lists neither: the one changed at 12:00 (reopened meanwhile) stays.
      const r = await sync([], "2026-10-01T11:00:00Z");
      expect(r.error, r.message).toBeUndefined();
      expect(await dues()).toEqual(["2026-09-21"]);
      // No read time (the app before this change): whatever is not listed goes.
      await sync([], null);
      expect(await dues()).toEqual([]);
    });
  });
});

describe("record_quotes", () => {
  it("takes ÁKK prices, once per moment", async () => {
    await withScenario(async (s) => {
      const { acc } = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const id = await bought(s, me, acc);
      const q = [{ instrumentId: id, price: "0.999589", currency: "HUF", asOf: "2026-09-28T21:59:59Z", source: "akk", status: "ok" }];
      const first = await s.as(me, `select public.record_quotes($1::jsonb) as n`, [JSON.stringify(q)]);
      expect(first.rows[0].n).toBe(1);
      const second = await s.as(me, `select public.record_quotes($1::jsonb) as n`, [JSON.stringify(q)]);
      expect(second.rows[0].n).toBe(0);
    });
  });
});

describe("a bond's last entry", () => {
  it("takes the bond with its terms, observations and proposals", async () => {
    await withScenario(async (s) => {
      const { acc } = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const id = await bought(s, me, acc);
      await s.as(me, `insert into public.pending_events (instrument_id, account_id, kind, due_date, nominal, percent, amount) values ($1, $2, 'interest_reinvest', '2026-08-21', 1000, 6.11, 61)`, [id, acc]);
      await s.admin(
        `insert into public.bond_observations (owner_id, instrument_id, day, bid, accrued, settle_date, check_result) values ($1, $2, '2026-08-03', 99, 0.1, '2026-08-05', 'ok')`,
        [s.fx.owner.userId, id],
      );
      const entry = (await s.admin(`select distinct e.entry_id from public.events e join public.lines l on l.event_id = e.id where l.instrument_id = $1`, [id])).rows[0].entry_id;

      expect((await s.as(me, `select public.delete_entry($1::uuid)`, [entry])).error).toBeUndefined();
      await s.admin(`set constraints all immediate`);
      for (const table of ["instruments", "bond_terms", "bond_observations", "pending_events"]) {
        const col = table === "instruments" ? "id" : "instrument_id";
        expect((await s.admin(`select count(*)::int as n from public.${table} where ${col} = $1`, [id])).rows[0].n, table).toBe(0);
      }
    });
  });
});

describe("sending an approved interest credit back for review (#35)", () => {
  /** A 1000 nominal bond with its 61 Ft interest credited in papers on 2026-08-21, approved from its proposal. */
  async function credited(s: Scenario, me: Actor, acc: string) {
    const id = await bought(s, me, acc);
    const p = await s.as(
      me,
      `insert into public.pending_events (instrument_id, account_id, kind, due_date, nominal, percent, amount) values ($1, $2, 'interest_reinvest', '2026-08-21', 1000, 6.11, 61) returning id`,
      [id, acc],
    );
    const entryId = randomUUID();
    const r = await record(s, me, {
      pending: { id: p.rows[0].id, edited: false },
      entries: [{ id: entryId, events: [ev("interest_reinvest", "2026-08-21", [cash(acc, "61", "income", id), cash(acc, "-61", "trade"), pos(acc, id, "61", "61")])] }],
    });
    expect(r.error, r.message).toBeUndefined();
    return { id, entryId, pendingId: p.rows[0].id as string };
  }
  const status = async (s: Scenario, me: Actor, pendingId: string) => (await s.as(me, `select status from public.pending_events where id = $1`, [pendingId])).rows[0].status;

  it("is refused when a later sale used its papers; the proposal stays approved", async () => {
    await withScenario(async (s) => {
      const { acc } = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const { id, entryId, pendingId } = await credited(s, me, acc);
      const sale = await record(s, me, { entries: [{ id: randomUUID(), events: [ev("sell", "2026-09-10", [pos(acc, id, "-1061"), cash(acc, "1050", "trade")])] }] });
      expect(sale.error, sale.message).toBeUndefined();

      const back = await s.as(me, `select public.delete_entry($1::uuid)`, [entryId]);
      expect(back.error).toBe("23514");
      expect(back.message).toContain("insufficient_quantity");
      expect(await status(s, me, pendingId)).toBe("approved");
    });
  });

  it("a later buy does not block it: the proposal is open again", async () => {
    await withScenario(async (s) => {
      const { acc } = await seed(s);
      const me = actors(s.fx).ownerTrusted;
      const { id, entryId, pendingId } = await credited(s, me, acc);
      const buy = await record(s, me, {
        entries: [{ id: randomUUID(), events: [ev("deposit", "2026-09-10", [cash(acc, "500", "external")]), ev("buy", "2026-09-10", [pos(acc, id, "500", "500"), cash(acc, "-500", "trade")])] }],
      });
      expect(buy.error, buy.message).toBeUndefined();

      expect((await s.as(me, `select public.delete_entry($1::uuid)`, [entryId])).error).toBeUndefined();
      expect(await status(s, me, pendingId)).toBe("open");
    });
  });
});
