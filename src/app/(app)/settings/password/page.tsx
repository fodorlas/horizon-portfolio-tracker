import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n-server";
import { createClient } from "@/lib/supabase/server";
import { changePassword } from "../actions";
import { PasswordForm } from "./password-form";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.password.title };
}

export default async function PasswordPage() {
  const { m } = await getI18n();
  const { data } = await (await createClient()).auth.getUser();
  return (
    <>
      <PageHeader title={m.password.title} />
      <Card>
        <PasswordForm email={data.user?.email ?? ""} action={changePassword} />
      </Card>
    </>
  );
}
