/**
 * RLS test harness. It only accepts a throwaway local Supabase instance and
 * runs every scenario inside a transaction that is always rolled back.
 *
 * Actors are simulated the way PostgREST does it: `set local role` plus the
 * `request.jwt.claims` setting. Sessions and factors are real rows in
 * auth.sessions / auth.mfa_factors (inserted inside the same transaction), so
 * private.has_trusted_aal2() is exercised end to end.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { testTarget } from "../target";

export function localTestDbUrl(): string {
  const url = process.env.SUPABASE_TEST_DB_URL;
  if (!url) throw new Error("SUPABASE_TEST_DB_URL is not set (start local Supabase first)");
  testTarget(url);
  return url;
}

export function localTestDbClient() {
  const url = localTestDbUrl();
  return new pg.Client({ connectionString: url, ssl: false });
}

export type Actor =
  | { kind: "anon" }
  | { kind: "authenticated"; userId: string; sessionId: string; aal: "aal1" | "aal2"; totpAgeSeconds: number | null }
  | { kind: "service_role" };

export type Fixture = {
  owner: { userId: string; approvedFactor: string; unapprovedFactor: string };
  stranger: { userId: string; factor: string };
  sessions: {
    ownerTrusted: string;
    ownerAal1: string;
    ownerUnapproved: string;
    strangerAal2: string;
  };
};

export class Scenario {
  private sp = 0;
  constructor(readonly db: pg.Client, readonly fx: Fixture) {}

  /** Runs `sql` as `actor` inside a savepoint. Returns rows or the error code. */
  async as(actor: Actor, sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; error?: string; message?: string }> {
    const name = `sp_${++this.sp}`;
    await this.db.query(`savepoint ${name}`);
    try {
      if (actor.kind === "anon") {
        await this.db.query(`set local role anon`);
        await this.db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "anon" })]);
      } else if (actor.kind === "service_role") {
        await this.db.query(`set local role service_role`);
        await this.db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "service_role" })]);
      } else {
        const now = Math.floor(Date.now() / 1000);
        const amr = [{ method: "password", timestamp: now - 60 }];
        if (actor.totpAgeSeconds !== null) amr.push({ method: "totp", timestamp: now - actor.totpAgeSeconds });
        await this.db.query(`set local role authenticated`);
        await this.db.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: actor.userId, role: "authenticated", aal: actor.aal, session_id: actor.sessionId, amr }),
        ]);
      }
      const res = await this.db.query(sql, params);
      await this.db.query(`release savepoint ${name}`);
      return { rows: res.rows };
    } catch (e) {
      await this.db.query(`rollback to savepoint ${name}`);
      return { rows: [], error: (e as { code?: string }).code ?? String(e), message: (e as Error).message };
    } finally {
      await this.db.query(`reset role`);
    }
  }

  /** Runs setup SQL as postgres (still inside the rolled-back transaction). */
  admin(sql: string, params: unknown[] = []) {
    return this.db.query(sql, params);
  }
}

async function insertUser(db: pg.Client, label: string) {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                             created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(),
             now(), now(), '{"provider":"email","providers":["email"]}', '{}')`,
    [id, `rls-${label}-${id.slice(0, 8)}@test.invalid`],
  );
  return id;
}

async function insertFactor(db: pg.Client, userId: string) {
  const id = randomUUID();
  await db.query(
    `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
     values ($1, $2, $3, 'totp', 'verified', now(), now(), 'TESTSECRET')`,
    [id, userId, `rls-${id.slice(0, 8)}`],
  );
  return id;
}

async function insertSession(db: pg.Client, userId: string, aal: "aal1" | "aal2", factorId: string | null) {
  const id = randomUUID();
  await db.query(
    `insert into auth.sessions (id, user_id, created_at, updated_at, aal, factor_id)
     values ($1, $2, now(), now(), $3, $4)`,
    [id, userId, aal, factorId],
  );
  return id;
}

/**
 * Opens a transaction, builds the fixture (owner with an approved and an
 * unapproved factor, a non-owner "stranger"), runs `fn`, then rolls back.
 */
// After one failed connection, every later test fails at once: repeated wrong
// passwords trip the pooler's circuit breaker and lock everyone out for a while.
let connectionError: Error | null = null;

export async function withScenario(fn: (s: Scenario) => Promise<void>) {
  if (connectionError) throw connectionError;
  const db = localTestDbClient();
  try {
    await db.connect();
  } catch (e) {
    connectionError = e as Error;
    throw e;
  }
  try {
    await db.query("begin");
    // Trying a migration before `supabase db push`: apply it inside this
    // rolled-back transaction (PREAPPLY_MIGRATION=path/to/file.sql).
    if (process.env.PREAPPLY_MIGRATION) {
      await db.query(readFileSync(path.join(process.cwd(), process.env.PREAPPLY_MIGRATION), "utf8"));
    }
    // Isolation from any real dev owner: the single-owner slot is freed inside
    // this transaction only.
    await db.query("delete from private.app_members");
    // fx_rates has no owner, so every scenario would see whatever a dev
    // database holds (e.g. an interrupted e2e run's fixtures). Each starts
    // without them; the rollback brings them back.
    await db.query("delete from public.fx_rates");

    const ownerId = await insertUser(db, "owner");
    const strangerId = await insertUser(db, "stranger");
    const approved = await insertFactor(db, ownerId);
    const unapproved = await insertFactor(db, ownerId);
    const strangerFactor = await insertFactor(db, strangerId);
    await db.query(
      `insert into private.app_members (user_id, role, granted_via, approved_factor_ids)
       values ($1, 'owner', 'bootstrap', array[$2::uuid])`,
      [ownerId, approved],
    );

    const fx: Fixture = {
      owner: { userId: ownerId, approvedFactor: approved, unapprovedFactor: unapproved },
      stranger: { userId: strangerId, factor: strangerFactor },
      sessions: {
        ownerTrusted: await insertSession(db, ownerId, "aal2", approved),
        ownerAal1: await insertSession(db, ownerId, "aal1", null),
        ownerUnapproved: await insertSession(db, ownerId, "aal2", unapproved),
        strangerAal2: await insertSession(db, strangerId, "aal2", strangerFactor),
      },
    };
    await fn(new Scenario(db, fx));
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
}

/** The actors of the plan's permission matrix (plan §8). */
export function actors(fx: Fixture) {
  const s = fx.sessions;
  return {
    anon: { kind: "anon" } as Actor,
    ownerAal1: { kind: "authenticated", userId: fx.owner.userId, sessionId: s.ownerAal1, aal: "aal1", totpAgeSeconds: null } as Actor,
    ownerStaleTotp: { kind: "authenticated", userId: fx.owner.userId, sessionId: s.ownerTrusted, aal: "aal2", totpAgeSeconds: 12 * 3600 + 60 } as Actor,
    ownerUnapprovedFactor: { kind: "authenticated", userId: fx.owner.userId, sessionId: s.ownerUnapproved, aal: "aal2", totpAgeSeconds: 30 } as Actor,
    strangerAal2: { kind: "authenticated", userId: fx.stranger.userId, sessionId: s.strangerAal2, aal: "aal2", totpAgeSeconds: 30 } as Actor,
    // Claims borrowing the owner's session id with a stranger's sub must fail too.
    strangerStolenSession: { kind: "authenticated", userId: fx.stranger.userId, sessionId: s.ownerTrusted, aal: "aal2", totpAgeSeconds: 30 } as Actor,
    ownerTrusted: { kind: "authenticated", userId: fx.owner.userId, sessionId: s.ownerTrusted, aal: "aal2", totpAgeSeconds: 30 } as Actor,
  };
}
