"use server";

import { z } from "zod";
import { formFields, guarded, zodErrors } from "@/lib/actions/guard";
import type { ActionResult } from "@/lib/actions/result";
import { passwordSchema } from "@/lib/actions/schemas";
import { loadPortfolio } from "@/lib/data/load";
import { exportJson, positionsCsv, transactionsCsv } from "@/lib/export/export";
import { todayInBudapest } from "@/lib/finance/money";
import { i18nFor } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/server";
import { nameMaps } from "@/lib/views/names";
import { positions } from "@/lib/views/portfolio";

const KINDS = ["json", "transactions", "positions"] as const;

/** Export needs a TOTP from the last 15 minutes (plan §1.3: sensitive action). */
export async function exportData(fd: FormData): Promise<ActionResult> {
  return guarded(
    async () => {
      const kind = z.enum(KINDS).safeParse(fd.get("kind"));
      if (!kind.success) return { ok: false, formError: "invalid" };
      const data = await loadPortfolio(await createClient());
      const today = todayInBudapest();
      const names = nameMaps(data);
      const base = `horizon-${kind.data === "json" ? "export" : kind.data}-${today}`;

      if (kind.data === "json") {
        return { ok: true, file: { name: `${base}.json`, type: "application/json", content: exportJson(data, new Date().toISOString()) } };
      }
      // The export stays Hungarian whatever the UI language (spec 2026-10-01 §2.2): it is for machines.
      const eventTypes = i18nFor("hu").m.eventTypes as Record<string, string>;
      const content =
        kind.data === "transactions"
          ? transactionsCsv(data, names, (t) => eventTypes[t] ?? t)
          : positionsCsv(positions(data, today, (await getPrefs()).currency), names);
      return { ok: true, file: { name: `${base}.csv`, type: "text/csv;charset=utf-8", content } };
    },
    { stepUp: true },
  );
}

/**
 * Password change (plan §1.6 A): a fresh TOTP first, the project's password
 * rules, then every other session is signed out. The password is never logged.
 */
export async function changePassword(fd: FormData): Promise<ActionResult> {
  return guarded(
    async () => {
      const v = passwordSchema.safeParse(formFields(fd, ["password", "confirm"]));
      if (!v.success) return zodErrors(v.error.issues);
      const supabase = await createClient();
      const { error } = await supabase.auth.updateUser({ password: v.data.password });
      if (error) {
        if (error.code === "same_password") return { ok: false, errors: { password: "samePassword" } };
        if (error.code === "weak_password") return { ok: false, errors: { password: "weakPassword" } };
        // secure_password_change: a session older than 24 h needs a fresh sign-in.
        if (error.code === "reauthentication_needed") return { ok: false, formError: "reauthNeeded" };
        console.error("password change failed", error.code, error.status);
        return { ok: false, formError: "server" };
      }
      await supabase.auth.signOut({ scope: "others" });
      return { ok: true };
    },
    { stepUp: true },
  );
}
