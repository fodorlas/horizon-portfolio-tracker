import { ArrowLeftRight, Banknote, Briefcase, Home, Landmark, LineChart, Plus, Settings } from "lucide-react";
import type { Messages } from "@/lib/i18n";

/** The menu in the UI language (the caller passes its dictionary: this module is shared by client components). */
export const navGroups = (m: Messages) =>
  [
    {
      label: m.nav.portfolio,
      items: [
        { href: "/", label: m.nav.overview, icon: Home },
        { href: "/positions", label: m.nav.positions, icon: Briefcase },
        { href: "/transactions", label: m.nav.transactions, icon: ArrowLeftRight },
      ],
    },
    {
      label: m.nav.data,
      items: [
        { href: "/accounts", label: m.nav.accounts, icon: Landmark },
        { href: "/instruments", label: m.nav.instruments, icon: Banknote },
        { href: "/prices", label: m.nav.prices, icon: LineChart },
      ],
    },
    {
      label: m.nav.other,
      items: [{ href: "/settings", label: m.nav.settings, icon: Settings }],
    },
  ] as const;

export const newTx = (m: Messages) => ({ href: "/transactions/new", label: m.nav.newTransaction, short: m.nav.newShort, icon: Plus });

/** Active when on the page itself or below it ("/" only exactly). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/transactions") return pathname === "/transactions";
  return pathname === href || pathname.startsWith(`${href}/`);
}
