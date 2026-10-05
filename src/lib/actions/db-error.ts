/**
 * Database errors as form errors (codes are keys of messages.errors). The
 * validators raise "invalid_event: …" / "invalid_history: …"; the 4c guards
 * and functions raise their reason as the message.
 */
import type { ActionResult } from "./result";

type DbError = { code?: string; message: string };

const REASONS: [string, ActionResult][] = [
  ["invalid_history", { ok: false, formError: "history" }],
  ["before_tracking_start", { ok: false, errors: { date: "beforeStart" } }],
  ["tracking_start_later", { ok: false, errors: { trackingStart: "trackingLater" } }],
  ["tracking_start_has_opening", { ok: false, errors: { trackingStart: "trackingHasOpening" } }],
  ["instrument_currency_locked", { ok: false, errors: { currency: "currencyLocked" } }],
];

export function dbError(error: DbError): ActionResult {
  if (error.code === "42501") return { ok: false, formError: "denied" };
  if (error.code === "23505") return { ok: false, formError: "duplicate" };
  if (error.code === "P0002") return { ok: false, formError: "notFound" };
  if (error.code === "23503") return { ok: false, formError: "inUse" };
  if (error.code === "22023" && error.message.includes("name_mismatch")) return { ok: false, errors: { confirmName: "nameMismatch" } };
  // A proposal settled in the meantime (a second tab, a double click): the card is out of date.
  if (error.code === "22023" && error.message.includes("pending_not_open")) return { ok: false, formError: "pendingGone" };
  if (error.code === "23514") {
    for (const [reason, result] of REASONS) if (error.message.includes(reason)) return result;
    return { ok: false, formError: "invalid" };
  }
  console.error("database error", error.code, error.message);
  return { ok: false, formError: "server" };
}
