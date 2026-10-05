/**
 * Prototype gates (plan §1.7) against the real local Supabase Auth service (in PR
 * CI: a throwaway local Supabase with the same supabase/config.toml).
 * Each run creates throw-away users through the admin API and deletes them.
 *
 * Gate 5 (password-reset e-mail reaches the owner) is a manual protocol,
 * recorded in docs/security-gates.md.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generate } from "otplib";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTestDbClient } from "../rls/harness";
import { testTarget } from "../target";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_TEST_SECRET_KEY!;

testTarget(url);
if (!secret) throw new Error("SUPABASE_TEST_SECRET_KEY is not set (scripts/set-local-env.sh)");

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const admin = createClient(url, secret, noPersist);
const created: string[] = [];
let db: pg.Client;

type Claims = { aal: string; session_id: string; amr: Array<{ method: string; timestamp: number }> };
const claimsOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as Claims;
const totpAt = (c: Claims) => Math.max(...c.amr.filter((a) => a.method === "totp").map((a) => a.timestamp));

async function newUser() {
  const email = `gate-${randomUUID().slice(0, 8)}@test.invalid`;
  const password = randomBytes(18).toString("base64url") + "aA1";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  created.push(data.user.id);
  return { id: data.user.id, email, password };
}

async function signIn(u: { email: string; password: string }) {
  const client = createClient(url, publishable, noPersist);
  const { error } = await client.auth.signInWithPassword(u);
  if (error) throw error;
  return client;
}

async function enrollAndVerify(client: SupabaseClient) {
  const { data: enrolled, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `gate-${Date.now()}` });
  if (error) throw error;
  const code = await generate({ secret: enrolled.totp.secret });
  const verified = await client.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code });
  if (verified.error) throw verified.error;
  return { factorId: enrolled.id, secret: enrolled.totp.secret };
}

/** Waits until the next 30-second TOTP step so a fresh code exists. */
async function nextTotpStep() {
  const ms = 30_000 - (Date.now() % 30_000) + 1_000;
  await new Promise((r) => setTimeout(r, ms));
}

beforeAll(async () => {
  db = localTestDbClient();
  await db.connect();
});

afterAll(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id);
  await db?.end();
});

describe("auth configuration (supabase/config.toml pushed to dev)", () => {
  // Regression guard: [auth.email] enable_signup = false switches off e-mail
  // *logins*; sign-ups are blocked by [auth] enable_signup = false instead.
  it("sign-ups are closed but e-mail login works, TOTP is on", async () => {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishable } });
    const s = await res.json();
    expect(s.disable_signup).toBe(true);
    expect(s.external.email).toBe(true);
    expect(s.external.phone).toBe(false);
    expect(s.external.anonymous_users).toBe(false);
  });

  it("the public sign-up endpoint refuses new users", async () => {
    const anon = createClient(url, publishable, noPersist);
    const { data, error } = await anon.auth.signUp({ email: `signup-${randomUUID().slice(0, 8)}@test.invalid`, password: "Aa1" + randomBytes(12).toString("hex") });
    if (data.user) created.push(data.user.id);
    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
  });
});

describe("password reset links (plan §1.6 A)", () => {
  // The in-app reset asks Supabase to return to /auth/confirm on this site. A
  // forged Origin must not be able to send the link anywhere else.
  it("return only to the site's own host; a foreign host falls back to the Site URL", async () => {
    const u = await newUser();
    const link = async (redirectTo: string) => {
      const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: u.email, options: { redirectTo } });
      if (error) throw error;
      return new URL(data.properties.action_link).searchParams.get("redirect_to");
    };
    expect(await link("http://localhost:3100/auth/confirm")).toBe("http://localhost:3100/auth/confirm");
    expect(await link("https://evil.example/auth/confirm")).toBe("http://localhost:3100");
  });
});

describe("plan §1.7 gates", () => {
  it("gate 1 + 3: aal2 survives a token refresh, and auth.sessions records the elevating factor", async () => {
    const client = await signIn(await newUser());
    const { factorId } = await enrollAndVerify(client);

    const before = (await client.auth.getSession()).data.session!;
    expect(claimsOf(before.access_token).aal).toBe("aal2");

    const { data: refreshed, error } = await client.auth.refreshSession();
    expect(error).toBeNull();
    const after = claimsOf(refreshed.session!.access_token);
    expect(after.aal).toBe("aal2"); // gate 1
    expect(after.amr.some((a) => a.method === "totp")).toBe(true);

    const row = await db.query(`select aal::text, factor_id from auth.sessions where id = $1`, [after.session_id]);
    expect(row.rows[0]).toEqual({ aal: "aal2", factor_id: factorId }); // gate 3
  });

  it("gate 2: a new TOTP verification refreshes the amr timestamp", async () => {
    const client = await signIn(await newUser());
    const { factorId, secret: totpSecret } = await enrollAndVerify(client);
    const first = totpAt(claimsOf((await client.auth.getSession()).data.session!.access_token));

    await nextTotpStep();
    const code = await generate({ secret: totpSecret });
    const again = await client.auth.mfa.challengeAndVerify({ factorId, code });
    expect(again.error).toBeNull();
    const second = totpAt(claimsOf(again.data!.access_token));
    expect(second).toBeGreaterThan(first);
  });

  it("gate 4: with a verified factor, a new factor can only be enrolled from an aal2 session", async () => {
    const user = await newUser();
    const first = await signIn(user);
    await enrollAndVerify(first);

    const passwordOnly = await signIn(user); // aal1 session, nothing verified
    const attempt = await passwordOnly.auth.mfa.enroll({ factorType: "totp", friendlyName: "attacker" });
    expect(attempt.error).not.toBeNull();

    const fromAal2 = await first.auth.mfa.enroll({ factorType: "totp", friendlyName: "second-device" });
    expect(fromAal2.error).toBeNull();
    await first.auth.mfa.unenroll({ factorId: fromAal2.data!.id });
  });

  it("gate 6: the private schema is not reachable with the secret key through the API", async () => {
    const res = await admin.schema("private" as "public").from("app_members").select("*");
    expect(res.error).not.toBeNull();
    const rpc = await admin.schema("private" as "public").rpc("is_owner" as never);
    expect(rpc.error).not.toBeNull();
  });

  it("pipeline: a real aal2 session of a non-owner gets nothing through the API", async () => {
    const client = await signIn(await newUser());
    await enrollAndVerify(client);

    const status = await client.rpc("session_status");
    expect(status.data).toEqual({ is_owner: false, aal2: true, trusted: false });

    const read = await client.from("institutions").select("*");
    expect(read.data).toEqual([]);
    const write = await client.from("institutions").insert({ name: "x" });
    expect(write.error?.code).toBe("42501");

    const anon = createClient(url, publishable, noPersist);
    const anonRead = await anon.from("institutions").select("*");
    expect(anonRead.data ?? []).toEqual([]);
  });
});
