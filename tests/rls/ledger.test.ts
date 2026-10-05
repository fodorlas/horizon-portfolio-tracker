/**
 * Ledger rules in the database (plan §2–§3), checked against the SAME shared
 * cases as the TypeScript core, plus the RPC and history checks. Everything
 * runs in rolled-back transactions.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import eventCases from "../fixtures/event-validation-cases.json";
import fxCases from "../fixtures/fx-selection-cases.json";
import priceCases from "../fixtures/price-selection-cases.json";
import { actors, withScenario, type Scenario } from "./harness";

async function seedAccounts(s: Scenario) {
  const owner = s.fx.owner.userId;
  const inst = await s.admin(`insert into public.institutions (owner_id, name) values ($1, 'Teszt') returning id`, [owner]);
  const ids: Record<string, string> = {};
  for (const [key, start] of Object.entries(eventCases.accounts)) {
    const r = await s.admin(
      `insert into public.accounts (owner_id, institution_id, name, tracking_start_date) values ($1, $2, $3, $4) returning id`,
      [owner, inst.rows[0].id, key, start],
    );
    ids[key] = r.rows[0].id as string;
  }
  for (const [key, ccy] of Object.entries(eventCases.instruments)) {
    const r = await s.admin(
      `insert into public.instruments (owner_id, name, asset_class, currency) values ($1, $2, 'stock', $3) returning id`,
      [owner, key, ccy],
    );
    ids[key] = r.rows[0].id as string;
  }
  return ids;
}

type Case = { type: string; date: string; lines: (string | boolean | null)[][]; correctionKind?: string; splitRatio?: string; note?: string };

async function insertEvent(s: Scenario, ids: Record<string, string>, c: Case) {
  const owner = s.fx.owner.userId;
  const e = await s.admin(
    `insert into public.events (owner_id, event_type, event_date, correction_kind, split_ratio, note)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [owner, c.type, c.date, c.correctionKind ?? null, c.splitRatio ?? null, c.note ?? null],
  );
  for (const [kind, account, instrument, currency, amount, role, cost, est] of c.lines) {
    await s.admin(
      `insert into public.lines (owner_id, event_id, account_id, instrument_id, kind, currency, amount, role, cost_amount, cost_estimated)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [owner, e.rows[0].id, ids[account as string], instrument ? ids[instrument as string] : null, kind, currency, amount, role, cost, est],
    );
  }
  return e.rows[0].id as string;
}

describe("event validation – the same cases as ledger.ts", () => {
  it("valid events have no errors, invalid ones exactly the expected codes", async () => {
    await withScenario(async (s) => {
      const ids = await seedAccounts(s);
      for (const c of eventCases.valid as Case[]) {
        const id = await insertEvent(s, ids, c);
        const r = await s.admin(`select private.event_errors($1) as errs`, [id]);
        expect(r.rows[0].errs, c.type).toEqual([]);
      }
      for (const c of eventCases.invalid as (Case & { name: string; errors: string[] })[]) {
        const id = await insertEvent(s, ids, c);
        const r = await s.admin(`select private.event_errors($1) as errs`, [id]);
        expect([...(r.rows[0].errs as string[])].sort(), c.name).toEqual([...c.errors].sort());
      }
    });
  });
});

describe("the deferred validator blocks commits", () => {
  it("an event without lines cannot be committed", async () => {
    await withScenario(async (s) => {
      await seedAccounts(s);
      const r = await s.as(
        actors(s.fx).ownerTrusted,
        `with e as (insert into public.events (event_type, event_date) values ('deposit', '2026-01-05') returning id)
         select id from e`,
      );
      expect(r.error).toBeUndefined();
      await expect(s.admin(`set constraints all immediate`)).rejects.toMatchObject({ code: "23514" });
    });
  });
});

describe("record_event (RPC, security invoker)", () => {
  const buy = (acc: string, inst: string, qty: string, cost: string) => [
    { kind: "position", accountId: acc, instrumentId: inst, currency: "USD", amount: qty, role: "trade", costAmount: cost },
    { kind: "cash", accountId: acc, currency: "USD", amount: `-${cost}`, role: "trade" },
  ];

  it("records a valid event atomically for the trusted owner", async () => {
    await withScenario(async (s) => {
      const ids = await seedAccounts(s);
      const r = await s.as(actors(s.fx).ownerTrusted, `select public.record_event($1, $2) as id`, [
        { type: "buy", date: "2026-02-01" },
        JSON.stringify(buy(ids.A1, ids.I1, "10", "3410")),
      ]);
      expect(r.error).toBeUndefined();
      const lines = await s.admin(`select count(*)::int as n from public.lines where event_id = $1`, [r.rows[0].id]);
      expect(lines.rows[0].n).toBe(2);
    });
  });

  it("rejects an invalid shape at once", async () => {
    await withScenario(async (s) => {
      const ids = await seedAccounts(s);
      const bad = [{ kind: "position", accountId: ids.A1, instrumentId: ids.I1, currency: "USD", amount: "10", role: "trade" }];
      const r = await s.as(actors(s.fx).ownerTrusted, `select public.record_event($1, $2)`, [{ type: "buy", date: "2026-02-01" }, JSON.stringify(bad)]);
      expect(r.error).toBe("23514");
    });
  });

  it("rejects selling more than held (history check)", async () => {
    await withScenario(async (s) => {
      const ids = await seedAccounts(s);
      const me = actors(s.fx).ownerTrusted;
      await s.as(me, `select public.record_event($1, $2)`, [{ type: "buy", date: "2026-02-01" }, JSON.stringify(buy(ids.A1, ids.I1, "10", "3410"))]);
      const sell = [
        { kind: "position", accountId: ids.A1, instrumentId: ids.I1, currency: "USD", amount: "-11", role: "trade" },
        { kind: "cash", accountId: ids.A1, currency: "USD", amount: "4000", role: "trade" },
      ];
      const r = await s.as(me, `select public.record_event($1, $2)`, [{ type: "sell", date: "2026-02-10" }, JSON.stringify(sell)]);
      expect(r.error).toBe("23514");
    });
  });

  it("a split line must equal quantity × (ratio − 1)", async () => {
    await withScenario(async (s) => {
      const ids = await seedAccounts(s);
      const me = actors(s.fx).ownerTrusted;
      await s.as(me, `select public.record_event($1, $2)`, [{ type: "buy", date: "2026-02-01" }, JSON.stringify(buy(ids.A1, ids.I1, "10", "3410"))]);
      const split = (amount: string) => JSON.stringify([{ kind: "position", accountId: ids.A1, instrumentId: ids.I1, currency: "USD", amount, role: "split" }]);
      expect((await s.as(me, `select public.record_event($1, $2)`, [{ type: "split", date: "2026-02-20", splitRatio: "2" }, split("7")])).error).toBe("23514");
      expect((await s.as(me, `select public.record_event($1, $2)`, [{ type: "split", date: "2026-02-20", splitRatio: "2" }, split("10")])).error).toBeUndefined();
    });
  });

  it("deleting a buy that later sales depend on is refused", async () => {
    await withScenario(async (s) => {
      const ids = await seedAccounts(s);
      const me = actors(s.fx).ownerTrusted;
      const b = await s.as(me, `select public.record_event($1, $2) as id`, [{ type: "buy", date: "2026-02-01" }, JSON.stringify(buy(ids.A1, ids.I1, "10", "3410"))]);
      await s.as(me, `select public.record_event($1, $2)`, [
        { type: "sell", date: "2026-02-10" },
        JSON.stringify([
          { kind: "position", accountId: ids.A1, instrumentId: ids.I1, currency: "USD", amount: "-5", role: "trade" },
          { kind: "cash", accountId: ids.A1, currency: "USD", amount: "2000", role: "trade" },
        ]),
      ]);
      // Refused either at once (checks already immediate in this transaction)
      // or at commit (a fresh request): never accepted.
      const del = await s.as(me, `delete from public.events where id = $1`, [b.rows[0].id]);
      if (del.error) expect(del.error).toBe("23514");
      else await expect(s.admin(`set constraints all immediate`)).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("a stranger with aal2 cannot record anything", async () => {
    await withScenario(async (s) => {
      const ids = await seedAccounts(s);
      const r = await s.as(actors(s.fx).strangerAal2, `select public.record_event($1, $2)`, [
        { type: "deposit", date: "2026-01-05" },
        JSON.stringify([{ kind: "cash", accountId: ids.A1, currency: "HUF", amount: "1", role: "external" }]),
      ]);
      expect(r.error).toBe("42501");
    });
  });
});

describe("record_event_bundle (event + its broker rate / opening price, one transaction)", () => {
  const exchange = (acc: string) =>
    JSON.stringify([
      { kind: "cash", accountId: acc, currency: "HUF", amount: "-400000", role: "fx" },
      { kind: "cash", accountId: acc, currency: "EUR", amount: "1000", role: "fx" },
      { kind: "cash", accountId: acc, currency: "HUF", amount: "-500", role: "fee" },
    ]);

  it("an FX exchange stores its actual rate as a broker row tied to the event", async () => {
    await withScenario(async (s) => {
      const ids = await seedAccounts(s);
      const r = await s.as(actors(s.fx).ownerTrusted, `select public.record_event_bundle($1, $2) as id`, [
        { type: "fx_exchange", date: "2026-02-21" },
        exchange(ids.A1),
      ]);
      expect(r.error).toBeUndefined();
      const fx = await s.admin(`select base, quote, rate::text, rate_date::text, source from public.fx_rates where event_id = $1`, [r.rows[0].id]);
      expect(fx.rows).toEqual([{ base: "HUF", quote: "EUR", rate: "0.002500000000", rate_date: "2026-02-21", source: "broker" }]);
    });
  });

  it("an opening balance brings its manual price on the tracking-start day", async () => {
    await withScenario(async (s) => {
      const ids = await seedAccounts(s);
      const r = await s.as(actors(s.fx).ownerTrusted, `select public.record_event_bundle($1, $2, $3) as id`, [
        { type: "opening_balance", date: "2026-03-01" },
        JSON.stringify([{ kind: "position", accountId: ids.A2, instrumentId: ids.I1, currency: "USD", amount: "5", role: "opening", costAmount: "1000", costEstimated: true }]),
        { quotes: [{ instrumentId: ids.I1, price: "200", currency: "USD", asOf: "2026-03-01T21:59:59Z", note: "Nyitó ár" }] },
      ]);
      expect(r.error).toBeUndefined();
      const q = await s.admin(`select price::text, source, note from public.price_quotes where instrument_id = $1`, [ids.I1]);
      expect(q.rows).toEqual([{ price: "200.0000000000", source: "manual", note: "Nyitó ár" }]);
    });
  });

  it("a failing extra rolls back the event as well", async () => {
    await withScenario(async (s) => {
      const ids = await seedAccounts(s);
      const r = await s.as(actors(s.fx).ownerTrusted, `select public.record_event_bundle($1, $2, $3) as id`, [
        { type: "opening_balance", date: "2026-03-01" },
        JSON.stringify([{ kind: "position", accountId: ids.A2, instrumentId: ids.I2, currency: "HUF", amount: "1", role: "opening", costAmount: "100" }]),
        { valuations: [{ accountId: ids.A2, instrumentId: ids.I2, value: "-1", currency: "HUF", asOf: "2026-03-01T21:59:59Z", note: "x" }] },
      ]);
      expect(r.error).toBe("23514");
      const n = await s.admin(`select count(*)::int as n from public.events where owner_id = $1`, [s.fx.owner.userId]);
      expect(n.rows[0].n).toBe(0);
    });
  });

  it("an untrusted session cannot use it", async () => {
    await withScenario(async (s) => {
      const ids = await seedAccounts(s);
      const r = await s.as(actors(s.fx).ownerAal1, `select public.record_event_bundle($1, $2)`, [{ type: "fx_exchange", date: "2026-02-21" }, exchange(ids.A1)]);
      expect(r.error).toBe("42501");
    });
  });
});

describe("select_fx – the same cases as fx.ts", () => {
  it("every case matches", async () => {
    await withScenario(async (s) => {
      const id: Record<string, string> = {};
      for (const r of fxCases.rows) id[r.key] = randomUUID();
      // Plain rows first, corrections after their targets.
      const ordered = [...fxCases.rows].sort((a, b) => Number("supersedes" in a) - Number("supersedes" in b));
      for (const [i, r] of ordered.entries()) {
        await s.admin(
          `insert into public.fx_rates (id, base, quote, rate, rate_date, source, status, supersedes_id, note, raw_unit, fetched_at, event_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            id[r.key], r.base, r.quote, r.rate, r.rateDate, r.source, r.status,
            "supersedes" in r ? id[(r as { supersedes: string }).supersedes] : null,
            (r as { note?: string }).note ?? null, (r as { rawUnit?: number }).rawUnit ?? 1,
            `2026-09-26T10:00:${String(i).padStart(2, "0")}Z`,
            r.source === "broker" ? await brokerEvent(s) : null,
          ],
        );
      }
      const me = actors(s.fx).ownerTrusted;
      for (const c of fxCases.cases) {
        const res = await s.as(me, `select kind, rate::text, method, source, rate_date::text, row_ids from public.select_fx($1, $2, $3)`, [c.from, c.to, c.day]);
        expect(res.error, c.name).toBeUndefined();
        const got = res.rows[0];
        expect(got.kind, c.name).toBe(c.expect.kind);
        if (c.expect.kind === "rate") {
          expect([got.source, got.method, got.rate_date], c.name).toEqual([c.expect.source, c.expect.method, c.expect.rateDate]);
          expect(Number(got.rate).toFixed(10), c.name).toBe(Number(c.expect.rate).toFixed(10));
          expect(got.row_ids, c.name).toEqual((c.expect.rows ?? []).map((k) => id[k]));
        }
      }
    });
  });
});

async function brokerEvent(s: Scenario) {
  const e = await s.admin(`insert into public.events (owner_id, event_type, event_date) values ($1, 'fx_exchange', '2026-09-26') returning id`, [s.fx.owner.userId]);
  return e.rows[0].id as string;
}

describe("select_price – the same cases as prices.ts", () => {
  it("every case matches", async () => {
    await withScenario(async (s) => {
      const owner = s.fx.owner.userId;
      const inst: Record<string, string> = {};
      for (const [key, i] of Object.entries(priceCases.instruments)) {
        const r = await s.admin(
          `insert into public.instruments (owner_id, name, asset_class, currency, price_source, provider_symbol) values ($1, $2, 'stock', $3, $4, $5) returning id`,
          [owner, key, i.currency, i.priceSource, i.priceSource === "manual" ? null : `CASE${key}`],
        );
        inst[key] = r.rows[0].id as string;
      }
      const id: Record<string, string> = {};
      const ordered = [...priceCases.rows].sort((a, b) => Number("supersedes" in a) - Number("supersedes" in b));
      for (const r of ordered) {
        id[r.key] = randomUUID();
        await s.admin(
          `insert into public.price_quotes (id, owner_id, instrument_id, price, currency, as_of, entered_at, source, status, supersedes_id, note)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [id[r.key], owner, inst[r.instrument], r.price, r.currency, r.asOf, r.enteredAt, r.source, r.status,
           "supersedes" in r ? id[(r as { supersedes: string }).supersedes] : null, (r as { note?: string }).note ?? null],
        );
      }
      const me = actors(s.fx).ownerTrusted;
      const byId = Object.fromEntries(Object.entries(id).map(([k, v]) => [v, k]));
      for (const c of priceCases.cases) {
        const res = await s.as(me, `select id from public.select_price($1, $2)`, [inst[c.instrument], c.day]);
        expect(res.rows[0] ? byId[res.rows[0].id as string] : null, c.name).toBe(c.expect);
      }
    });
  });
});
