import { getSessionState } from "@/lib/auth/server";
import { safeNextPath } from "@/lib/auth/session-state";
import { getI18n } from "@/lib/i18n-server";
import { LogoutButtons } from "../../logout-buttons";
import { AuthCard } from "../auth-card";
import { MfaForm } from "./mfa-form";

export default async function MfaPage({ searchParams }: PageProps<"/mfa">) {
  const { next } = await searchParams;
  const [state, { m }] = await Promise.all([getSessionState(), getI18n()]);

  return (
    <AuthCard title={m.mfa.title}>
      <MfaForm
        next={safeNextPath(typeof next === "string" ? next : undefined)}
        stale={state.kind === "needs-totp" && state.reason === "stale"}
      />
      <div className="mt-6 border-t border-border pt-4">
        <LogoutButtons />
      </div>
    </AuthCard>
  );
}
