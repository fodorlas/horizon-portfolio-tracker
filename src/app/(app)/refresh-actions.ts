"use server";

import { revalidatePath } from "next/cache";
import { guarded } from "@/lib/actions/guard";
import type { ActionResult } from "@/lib/actions/result";
import { refreshForOwner } from "@/lib/refresh/service";
import { createClient } from "@/lib/supabase/server";

/** Frissítés: FX and prices from the sources, through the owner's own session (phase 4 plan §2). */
export async function refreshPrices(): Promise<ActionResult> {
  return guarded(async () => {
    const summary = await refreshForOwner(await createClient());
    revalidatePath("/", "layout");
    return { ok: true, refresh: summary };
  });
}
