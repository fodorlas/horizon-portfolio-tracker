import { describe, expect, it } from "vitest";
import { dbError } from "./db-error";

describe("dbError: database errors as form errors", () => {
  it("permissions, duplicates, missing rows and rows in use", () => {
    expect(dbError({ code: "42501", message: "new row violates row-level security policy" })).toEqual({ ok: false, formError: "denied" });
    expect(dbError({ code: "23505", message: "duplicate key" })).toEqual({ ok: false, formError: "duplicate" });
    expect(dbError({ code: "P0002", message: "unknown_entry" })).toEqual({ ok: false, formError: "notFound" });
    expect(dbError({ code: "23503", message: "instrument_in_use" })).toEqual({ ok: false, formError: "inUse" });
  });

  it("the validators' and guards' reasons", () => {
    expect(dbError({ code: "23514", message: "invalid_history: insufficient_quantity" })).toEqual({ ok: false, formError: "history" });
    expect(dbError({ code: "23514", message: "invalid_event: before_tracking_start" })).toEqual({ ok: false, errors: { date: "beforeStart" } });
    expect(dbError({ code: "23514", message: "tracking_start_later" })).toEqual({ ok: false, errors: { trackingStart: "trackingLater" } });
    expect(dbError({ code: "23514", message: "tracking_start_has_opening" })).toEqual({ ok: false, errors: { trackingStart: "trackingHasOpening" } });
    expect(dbError({ code: "23514", message: "instrument_currency_locked" })).toEqual({ ok: false, errors: { currency: "currencyLocked" } });
    expect(dbError({ code: "23514", message: "invalid_event: bad_shape" })).toEqual({ ok: false, formError: "invalid" });
    expect(dbError({ code: "22023", message: "name_mismatch" })).toEqual({ ok: false, errors: { confirmName: "nameMismatch" } });
  });

  it("a proposal settled in the meantime (a second tab, a double click) says so, not an unexpected error (#31)", () => {
    expect(dbError({ code: "22023", message: "pending_not_open" })).toEqual({ ok: false, formError: "pendingGone" });
  });
});
