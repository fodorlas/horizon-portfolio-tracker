"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "../i18n-provider";
import { isActive, navGroups, newTx } from "./nav-items";

/** Desktop navigation (lg and up). */
export function Sidebar({ footer }: { footer: ReactNode }) {
  const { m } = useI18n();
  const NEW_TX = newTx(m);
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r border-border bg-card/80 px-4 py-6 backdrop-blur-md lg:flex">
      <Link href="/" className="px-3 font-serif text-3xl text-accent">
        {m.app.name}
      </Link>
      {/* Lined up with the menu below: the same padding and gap, left-aligned (2026-09-30). */}
      <Link
        href={NEW_TX.href}
        aria-current={pathname === NEW_TX.href ? "page" : undefined}
        className="flex items-center gap-3 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-accent-contrast shadow-sm hover:opacity-90"
      >
        <NEW_TX.icon aria-hidden="true" size={18} />
        {NEW_TX.label}
      </Link>
      <nav aria-label={m.nav.label} className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {navGroups(m).map((g) => (
          <div key={g.label}>
            <p className="px-3 pb-1 text-xs font-medium text-text-muted">{g.label}</p>
            <ul className="flex flex-col gap-1">
              {g.items.map((i) => {
                const active = isActive(pathname, i.href);
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
                        active ? "bg-accent font-medium text-accent-contrast" : "text-text hover:bg-subtle"
                      }`}
                    >
                      <i.icon aria-hidden="true" size={18} />
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-border pt-4">{footer}</div>
    </aside>
  );
}
