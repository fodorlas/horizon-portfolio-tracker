import type { Metadata } from "next";
import { LogoutButtons } from "@/app/logout-buttons";
import { Day } from "@/components/format";
import { CurrencySwitcher } from "@/components/shell/currency-switcher";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n-server";
import { getPrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/server";
import { readAppMode } from "@/lib/demo/config";
import { setDisplayCurrency, setLanguage, setTheme } from "../prefs-actions";
import { exportData } from "./actions";
import { ExportPanel } from "./export-panel";
import { LanguageForm } from "./language-form";
import { ThemeForm } from "./theme-form";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.settings.title };
}

export default async function SettingsPage() {
  const { m, fill } = await getI18n();
  const t = m.settings;
  const prefs = await getPrefs();
  const factors = readAppMode(process.env).demo
    ? []
    : (await (await createClient()).auth.mfa.listFactors()).data?.all.filter((f) => f.factor_type === "totp") ?? [];

  return (
    <>
      <PageHeader title={t.title} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card id="display" title={t.display}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t.currency}</span>
              <div>
                <CurrencySwitcher key={prefs.currency} current={prefs.currency} action={setDisplayCurrency} />
              </div>
            </div>
            <ThemeForm key={prefs.theme} current={prefs.theme} action={setTheme} />
            <LanguageForm key={prefs.locale} current={prefs.locale} action={setLanguage} />
          </div>
        </Card>

        <Card id="factors" title={t.factors}>
          <p className="mb-3 text-sm text-text-muted">{t.factorsIntro}</p>
          <ul className="divide-y divide-border">
            {factors.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-medium">{f.friendly_name || "TOTP"}</span>
                <span className="flex items-center gap-2 text-text-muted">
                  {fill(t.factorCreated, { date: "" })}
                  <Day day={f.created_at.slice(0, 10)} />
                  <Badge tone={f.status === "verified" ? "accent" : "warn"}>{t.factorStatus[f.status as keyof typeof t.factorStatus] ?? f.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card id="sessions" title={t.sessions}>
          <p className="mb-4 text-sm text-text-muted">{t.sessionsIntro}</p>
          <LogoutButtons />
        </Card>

        <Card id="password" title={t.password}>
          <p className="mb-4 text-sm text-text-muted">{t.passwordText}</p>
          <ButtonLink href="/settings/password" variant="secondary">
            {t.passwordLink}
          </ButtonLink>
        </Card>

        <Card id="export" title={m.export.title} className="lg:col-span-2">
          <p className="mb-4 text-sm text-text-muted">{m.export.intro}</p>
          <ExportPanel action={exportData} />
        </Card>
      </div>
    </>
  );
}
