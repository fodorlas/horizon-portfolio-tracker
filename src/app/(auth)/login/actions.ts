"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/lib/auth/session-state";
import { createClient } from "@/lib/supabase/server";

const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

export type LoginResult = { error: "invalid" | "rate-limited" } | undefined;

export async function signIn(_prev: LoginResult, formData: FormData): Promise<LoginResult> {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  // One generic message: never reveal whether the e-mail exists.
  if (error) return { error: error.status === 429 ? "rate-limited" : "invalid" };

  // Password alone is aal1: the TOTP step always follows.
  redirect(`/mfa?next=${encodeURIComponent(safeNextPath(parsed.data.next))}`);
}
