import Link from "next/link";
import { safeNextPath } from "@/lib/auth/session-state";
import { getI18n } from "@/lib/i18n-server";
import { AuthCard } from "../auth-card";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const { m } = await getI18n();
  return (
    <AuthCard title={m.login.title}>
      {error === "link" ? (
        <p role="alert" className="mt-4 rounded-xl border border-loss/40 px-3 py-2 text-sm text-loss">
          {m.login.linkError}
        </p>
      ) : null}
      <LoginForm next={safeNextPath(typeof next === "string" ? next : undefined)} />
      <p className="mt-6 text-sm">
        <Link href="/login/forgot" className="text-accent underline underline-offset-4">
          {m.login.forgotLink}
        </Link>
      </p>
    </AuthCard>
  );
}
