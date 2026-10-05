"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut(formData: FormData) {
  const scope = formData.get("scope") === "global" ? "global" : "local";
  const supabase = await createClient();
  await supabase.auth.signOut({ scope });
  redirect("/login");
}
