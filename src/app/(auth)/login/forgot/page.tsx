import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n-server";
import { AuthCard } from "../../auth-card";
import { ForgotForm } from "./forgot-form";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.forgot.title };
}

export default async function ForgotPage() {
  const { m } = await getI18n();
  return (
    <AuthCard title={m.forgot.title}>
      <ForgotForm />
    </AuthCard>
  );
}
