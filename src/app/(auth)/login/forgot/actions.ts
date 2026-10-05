"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type ResetResult = { status: "sent" | "invalid" | "rate-limited" } | undefined;

/**
 * Sends the password-reset e-mail (PKCE: the verifier cookie stays in this
 * browser). The answer is the same whether or not the address belongs to
 * anyone: nothing is revealed about accounts.
 */
export async function requestPasswordReset(_prev: ResetResult, formData: FormData): Promise<ResetResult> {
  const email = z.email().max(254).safeParse(formData.get("email"));
  if (!email.success) return { status: "invalid" };
  // The link comes back to this site. Supabase checks redirectTo against the
  // Site URL and the redirect allow-list, so a forged Origin cannot send it elsewhere.
  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${origin}/auth/confirm` });
  if (error?.status === 429) return { status: "rate-limited" };
  return { status: "sent" };
}
