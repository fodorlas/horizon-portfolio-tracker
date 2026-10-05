import { LogoutButtons } from "@/app/logout-buttons";
import { Header } from "@/components/shell/header";
import { MobileNav } from "@/components/shell/mobile-nav";
import { Sidebar } from "@/components/shell/sidebar";
import { getI18n } from "@/lib/i18n-server";
import { getPrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/server";

type SessionStatus = { is_owner: boolean; aal2: boolean; trusted: boolean };

/**
 * The app frame. The proxy only lets trusted-looking sessions through; the
 * database decides the rest (owner membership, approved factor). Without it
 * no page is shown at all – RLS would return nothing anyway.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("session_status");
  const status = (data ?? { is_owner: false, aal2: false, trusted: false }) as SessionStatus;
  const [prefs, { m }] = await Promise.all([getPrefs(), getI18n()]);

  if (!status.is_owner || !status.trusted) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <section className="w-full max-w-xl rounded-3xl border border-border bg-card p-8 shadow-card sm:p-10">
          <h1 className="text-4xl font-semibold tracking-tight text-accent">{m.access.title}</h1>
          <p role="alert" className="mt-4 text-loss">
            {!status.is_owner ? m.access.notOwner : m.access.notApproved}
          </p>
          <div className="mt-8 border-t border-border pt-4">
            <LogoutButtons />
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="flex flex-1">
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-accent px-4 py-2 text-accent-contrast focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {m.nav.skip}
      </a>
      <Sidebar footer={<LogoutButtons />} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 sm:px-6 lg:px-10">
          <Header prefs={prefs} />
          <main id="main" tabIndex={-1} className="flex-1 pb-8 outline-none">
            {children}
          </main>
          <footer className="pb-28 text-xs text-text-muted lg:pb-8">{m.app.notTaxAdvice}</footer>
        </div>
      </div>
      <MobileNav footer={<LogoutButtons />} />
    </div>
  );
}
