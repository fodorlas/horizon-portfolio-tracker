import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ReauthRequired, requireTrustedSession } from "@/lib/auth/server";
import type { ActionResult } from "./result";

/**
 * Every server action starts here (plan §1.5): a trusted session first, with a
 * clear "reauth" answer instead of an error page. RLS still decides in the
 * database; this only fails early and readably.
 */
export async function guarded(fn: () => Promise<ActionResult>, opts: { stepUp?: boolean } = {}): Promise<ActionResult> {
  try {
    await requireTrustedSession(opts);
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ReauthRequired) return { ok: false, reauth: true };
    console.error("server action failed", e);
    return { ok: false, formError: "server" };
  }
}

export { dbError } from "./db-error";

/** Plain strings from a form, trimmed, for the given names. */
export function formFields<K extends string>(fd: FormData, names: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const n of names) {
    const v = fd.get(n);
    if (typeof v === "string") out[n] = v;
  }
  return out;
}

/** Zod issues → { field: error code } (the first per field). Messages are codes from messages.errors. */
export function zodErrors(issues: { path: PropertyKey[]; message: string }[]): ActionResult {
  const errors: Record<string, string> = {};
  for (const i of issues) errors[String(i.path[0] ?? "form")] ??= i.message;
  return { ok: false, errors };
}
