import Link from "next/link";
import { Suspense } from "react";
import { setDisplayCurrency } from "@/app/(app)/prefs-actions";
import { todayInBudapest } from "@/lib/finance/money";
import { getI18n } from "@/lib/i18n-server";
import type { Prefs } from "@/lib/prefs";
import { daylight } from "@/lib/weather";
import { CurrencySwitcher } from "./currency-switcher";
import { CurrentWeather } from "./current-weather";
import { PrivacyToggle } from "./privacy-toggle";
import { DayNight } from "./weather";

export async function Header({ prefs }: { prefs: Prefs }) {
  const i18n = await getI18n();
  const { m, f } = i18n;
  const today = todayInBudapest();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 py-5">
      <div>
        <Link href="/" className="mb-1 block font-serif text-lg text-accent lg:hidden">
          {m.app.name}
        </Link>
        {/* Sans, not the serif: Fraunces' capital J hangs below the line ("Jó estét!"). */}
        <p className="text-2xl font-semibold text-accent sm:text-3xl">{f.greeting()}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
          <time dateTime={today}>{f.longDay(today)}</time>
          <span aria-hidden="true">·</span>
          <Suspense fallback={<DayNight isDay={daylight()} i18n={i18n} />}>
            <CurrentWeather />
          </Suspense>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <CurrencySwitcher key={prefs.currency} current={prefs.currency} action={setDisplayCurrency} />
        <PrivacyToggle initial={prefs.privacy} />
      </div>
    </header>
  );
}
