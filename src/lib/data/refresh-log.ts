import "server-only";
import { cache } from "react";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { readAppMode } from "@/lib/demo/config";

export type RefreshLogRow = Pick<Tables<"refresh_log">, "id" | "run_id" | "source" | "item" | "kind" | "range_from" | "range_to" | "status" | "inserted" | "suspect" | "unchecked" | "message" | "at">;

/** The latest refresh log rows, newest first (RLS: own rows only). */
export const getRefreshLog = cache(async (limit = 50): Promise<RefreshLogRow[]> => {
  if (readAppMode(process.env).demo) return [];
  const db = await createClient();
  const { data, error } = await db
    .from("refresh_log")
    .select("id, run_id, source, item, kind, range_from, range_to, status, inserted, suspect, unchecked, message, at")
    .order("at", { ascending: false })
    .order("id")
    .limit(limit);
  if (error) throw new Error(`refresh_log: ${error.message}`);
  return data;
});

/** When the last refresh ran, or null. */
export const getLastRefreshAt = cache(async (): Promise<string | null> => (await getRefreshLog(1))[0]?.at ?? null);
