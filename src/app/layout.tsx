import type { Metadata } from "next";
import { I18nProvider } from "@/components/i18n-provider";
import { getI18n } from "@/lib/i18n-server";
import { getPrefs } from "@/lib/prefs";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return {
    title: { default: m.app.name, template: `%s · ${m.app.name}` },
    description: m.app.tagline,
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Theme, privacy and language come from cookies, so the first paint is already right.
  const { theme, privacy, locale } = await getPrefs();
  return (
    <html
      lang={locale}
      data-theme={theme === "system" ? undefined : theme}
      data-private={privacy ? "" : undefined}
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
