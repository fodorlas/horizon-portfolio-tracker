/**
 * Permission matrix (plan §8). Every denied actor must see nothing and change
 * nothing; only the owner with a trusted aal2 session reaches their own rows.
 */
import { describe, expect, it } from "vitest";
import { actors, withScenario, type Actor, type Scenario } from "./harness";

async function seed(s: Scenario) {
  const { owner, stranger } = s.fx;
  const inst = await s.admin(`insert into public.institutions (owner_id, name) values ($1, 'IBKR') returning id`, [owner.userId]);
  const strangerInst = await s.admin(`insert into public.institutions (owner_id, name) values ($1, 'Idegen') returning id`, [stranger.userId]);
  const acc = await s.admin(
    `insert into public.accounts (owner_id, institution_id, name, tracking_start_date) values ($1, $2, 'Fő számla', '2026-01-01') returning id`,
    [owner.userId, inst.rows[0].id],
  );
  await s.admin(
    `insert into public.fx_rates (base, quote, rate, rate_date, source) values ('USD', 'HUF', 356.12, '2026-09-25', 'MNB')`,
  );
  // Rows in every ledger table, so "sees nothing" is a real statement.
  const ins = await s.admin(`insert into public.instruments (owner_id, name, asset_class, currency) values ($1, 'Apple', 'stock', 'USD') returning id`, [owner.userId]);
  const ev = await s.admin(`insert into public.events (owner_id, event_type, event_date) values ($1, 'deposit', '2026-02-01') returning id`, [owner.userId]);
  await s.admin(
    `insert into public.lines (owner_id, event_id, account_id, kind, currency, amount, role) values ($1, $2, $3, 'cash', 'HUF', 1000, 'external')`,
    [owner.userId, ev.rows[0].id, acc.rows[0].id],
  );
  await s.admin(
    `insert into public.price_quotes (owner_id, instrument_id, price, currency, as_of, source) values ($1, $2, 341.07, 'USD', now(), 'yahoo')`,
    [owner.userId, ins.rows[0].id],
  );
  await s.admin(
    `insert into public.manual_valuations (owner_id, account_id, instrument_id, value, currency, as_of) values ($1, $2, $3, 1, 'USD', now())`,
    [owner.userId, acc.rows[0].id, ins.rows[0].id],
  );
  // The ÁKK tables (spec 2026-09-28 §8).
  await s.admin(
    `insert into public.bond_terms (owner_id, instrument_id, series, security_type, tab, issue_date, maturity_date) values ($1, $2, '2031/M5', 'MÁPP_T', 'MAPP', '2026-07-20', '2031-08-21')`,
    [owner.userId, ins.rows[0].id],
  );
  await s.admin(
    `insert into public.bond_observations (owner_id, instrument_id, day, bid, accrued, settle_date, check_result) values ($1, $2, '2026-09-28', 99, 0.9589, '2026-09-28', 'ok')`,
    [owner.userId, ins.rows[0].id],
  );
  await s.admin(`insert into public.bond_rates (owner_id, series, period_start, period_end, rate) values ($1, '2027/N', '2026-08-26', '2026-11-26', 6.8)`, [owner.userId]);
  await s.admin(
    `insert into public.pending_events (owner_id, instrument_id, account_id, kind, due_date, nominal) values ($1, $2, $3, 'maturity', '2031-08-21', 1000)`,
    [owner.userId, ins.rows[0].id, acc.rows[0].id],
  );
  return { instId: inst.rows[0].id as string, strangerInstId: strangerInst.rows[0].id as string, accId: acc.rows[0].id as string };
}

const PERSONAL_TABLES = [
  "institutions", "accounts", "fx_rates", "instruments", "events", "lines", "price_quotes", "manual_valuations",
  "bond_terms", "bond_observations", "bond_rates", "pending_events",
];

const DENIED: Array<keyof ReturnType<typeof actors>> = [
  "anon",
  "ownerAal1",
  "ownerStaleTotp",
  "ownerUnapprovedFactor",
  "strangerAal2",
  "strangerStolenSession",
];

describe("personal tables: every denied actor sees and changes nothing", () => {
  for (const who of DENIED) {
    it(`${who}`, async () => {
      await withScenario(async (s) => {
        const ids = await seed(s);
        const a: Actor = actors(s.fx)[who];

        for (const table of PERSONAL_TABLES) {
          const sel = await s.as(a, `select * from public.${table}`);
          expect(sel.rows, `${who} select ${table}`).toEqual([]);
        }

        const ins = await s.as(a, `insert into public.institutions (owner_id, name) values ($1, 'x') returning id`, [s.fx.owner.userId]);
        expect(ins.error, `${who} insert`).toBe("42501");

        const upd = await s.as(a, `update public.institutions set name = 'hacked' where id = $1 returning id`, [ids.instId]);
        expect(upd.rows, `${who} update`).toEqual([]);

        const del = await s.as(a, `delete from public.accounts where id = $1 returning id`, [ids.accId]);
        expect(del.rows, `${who} delete`).toEqual([]);

        const fx = await s.as(a, `insert into public.fx_rates (base, quote, rate, rate_date, source) values ('EUR','HUF',1,'2026-09-25','ECB') returning id`);
        expect(fx.error, `${who} fx insert`).toBe("42501");

        // Nothing changed.
        const check = await s.admin(`select name from public.institutions where id = $1`, [ids.instId]);
        expect(check.rows[0].name).toBe("IBKR");
        const acc = await s.admin(`select count(*)::int as n from public.accounts where id = $1`, [ids.accId]);
        expect(acc.rows[0].n).toBe(1);
      });
    });
  }
});

describe("trusted owner", () => {
  it("reads and writes own rows only", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const me = actors(s.fx).ownerTrusted;

      const sel = await s.as(me, `select id from public.institutions order by name`);
      expect(sel.rows.map((r) => r.id)).toEqual([ids.instId]); // not the stranger's

      const ins = await s.as(me, `insert into public.institutions (name) values ('Erste') returning owner_id`);
      expect(ins.error).toBeUndefined();
      expect(ins.rows[0].owner_id).toBe(s.fx.owner.userId); // owner_id defaults to auth.uid()

      const upd = await s.as(me, `update public.institutions set name = 'IBKR Ireland' where id = $1 returning name`, [ids.instId]);
      expect(upd.rows).toEqual([{ name: "IBKR Ireland" }]);

      const extra = await s.as(me, `insert into public.institutions (name) values ('Törlendő') returning id`);
      const del = await s.as(me, `delete from public.institutions where id = $1 returning id`, [extra.rows[0].id]);
      expect(del.rows).toHaveLength(1);
      // An account with ledger lines cannot disappear under them.
      expect((await s.as(me, `delete from public.accounts where id = $1`, [ids.accId])).error).toBe("23503");

      for (const table of PERSONAL_TABLES) {
        const own = await s.as(me, `select count(*)::int as n from public.${table}`);
        expect(own.rows[0].n, `trusted owner sees own ${table}`).toBeGreaterThan(0);
      }

      const fxSel = await s.as(me, `select rate::text from public.fx_rates`);
      expect(fxSel.rows).toEqual([{ rate: "356.120000000000" }]);
      const fxIns = await s.as(me, `insert into public.fx_rates (base, quote, rate, rate_date, source) values ('EUR','HUF',364.42,'2026-09-25','MNB') returning id`);
      expect(fxIns.error).toBeUndefined();
    });
  });

  it("cannot write rows for someone else", async () => {
    await withScenario(async (s) => {
      await seed(s);
      const r = await s.as(actors(s.fx).ownerTrusted, `insert into public.institutions (owner_id, name) values ($1, 'x')`, [s.fx.stranger.userId]);
      expect(r.error).toBe("42501");
    });
  });

  it("cannot change owner_id", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const r = await s.as(actors(s.fx).ownerTrusted, `update public.institutions set owner_id = $1 where id = $2`, [s.fx.stranger.userId, ids.instId]);
      expect(r.error).toBe("42501");
    });
  });

  it("cannot reference another owner's row (composite foreign key)", async () => {
    await withScenario(async (s) => {
      const ids = await seed(s);
      const r = await s.as(
        actors(s.fx).ownerTrusted,
        `insert into public.accounts (institution_id, name, tracking_start_date) values ($1, 'x', '2026-01-01')`,
        [ids.strangerInstId],
      );
      // Either the FK (23503) or RLS on the referenced row must stop it.
      expect(["23503", "42501"]).toContain(r.error);
    });
  });

  it("append-only tables: no update, no delete", async () => {
    await withScenario(async (s) => {
      await seed(s);
      const me = actors(s.fx).ownerTrusted;
      for (const table of ["fx_rates", "price_quotes", "manual_valuations"]) {
        expect((await s.as(me, `update public.${table} set note = 'x'`)).error, table).toBe("42501");
        expect((await s.as(me, `delete from public.${table}`)).error, table).toBe("42501");
      }
      for (const [table, column] of [["bond_observations", "bid"], ["bond_rates", "rate"]]) {
        expect((await s.as(me, `update public.${table} set ${column} = ${column}`)).error, table).toBe("42501");
        expect((await s.as(me, `delete from public.${table}`)).error, table).toBe("42501");
      }
    });
  });

  it("cannot truncate", async () => {
    await withScenario(async (s) => {
      await seed(s);
      expect((await s.as(actors(s.fx).ownerTrusted, `truncate public.institutions cascade`)).error).toBe("42501");
    });
  });
});

describe("private schema", () => {
  it("is unreachable for anon, authenticated (even trusted) and service_role", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      const who: Actor[] = [a.anon, a.ownerTrusted, { kind: "service_role" }];
      for (const actor of who) {
        expect((await s.as(actor, `select * from private.app_members`)).error).toBe("42501");
        expect((await s.as(actor, `select * from private.audit_log`)).error).toBe("42501");
        const grant = await s.as(
          actor,
          `insert into private.app_members (user_id, granted_via) values ($1, 'recovery')`,
          [s.fx.stranger.userId],
        );
        expect(grant.error).toBe("42501");
      }
    });
  });

  it("anon cannot even call the helpers", async () => {
    await withScenario(async (s) => {
      expect((await s.as(actors(s.fx).anon, `select private.is_owner()`)).error).toBe("42501");
    });
  });
});

describe("session_status()", () => {
  it("reports only facts about the caller", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      const q = `select public.session_status() as st`;
      expect((await s.as(a.ownerTrusted, q)).rows[0].st).toEqual({ is_owner: true, aal2: true, trusted: true });
      expect((await s.as(a.ownerUnapprovedFactor, q)).rows[0].st).toEqual({ is_owner: true, aal2: true, trusted: false });
      expect((await s.as(a.ownerStaleTotp, q)).rows[0].st).toEqual({ is_owner: true, aal2: true, trusted: false });
      expect((await s.as(a.ownerAal1, q)).rows[0].st).toEqual({ is_owner: true, aal2: false, trusted: false });
      expect((await s.as(a.strangerAal2, q)).rows[0].st).toEqual({ is_owner: false, aal2: true, trusted: false });
      expect((await s.as(a.anon, q)).error).toBe("42501");
    });
  });
});

describe("structure", () => {
  it("every public table has RLS and the restrictive trusted-owner policy", async () => {
    await withScenario(async (s) => {
      const res = await s.admin(`
        select c.relname, c.relrowsecurity,
               exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.tablename = c.relname
                         and p.policyname = 'trusted_owner_only' and p.permissive = 'RESTRICTIVE') as has_gate
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname`);
      expect(res.rows.length).toBeGreaterThan(0);
      for (const r of res.rows) {
        expect(r, r.relname as string).toMatchObject({ relrowsecurity: true, has_gate: true });
      }
    });
  });

  it("owner membership changes are audited, the first insert included", async () => {
    await withScenario(async (s) => {
      const res = await s.admin(
        `select action, new_row ->> 'granted_via' as via from private.audit_log
         where table_name = 'private.app_members' and row_key = $1`,
        [s.fx.owner.userId],
      );
      expect(res.rows).toEqual([{ action: "INSERT", via: "bootstrap" }]);
    });
  });

  it("a second owner is impossible", async () => {
    await withScenario(async (s) => {
      await expect(
        s.admin(`insert into private.app_members (user_id, granted_via) values ($1, 'bootstrap')`, [s.fx.stranger.userId]),
      ).rejects.toMatchObject({ code: "23505" });
    });
  });
});
