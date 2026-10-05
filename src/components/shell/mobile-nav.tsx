"use client";
import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { useI18n } from "../i18n-provider";
import { Modal } from "../modal";
import { isActive, navGroups, newTx } from "./nav-items";

/** Phone navigation: four destinations and "More" in a bottom bar. */
export function MobileNav({ footer }: { footer: ReactNode }) {
  const { m } = useI18n();
  const groups = navGroups(m);
  const NEW_TX = newTx(m);
  const [overview, positions, transactions] = groups[0].items;
  const moreItems = [...groups[1].items, ...groups[2].items];
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const item = (i: { href: string; label: string; icon: typeof NEW_TX.icon }, label = i.label) => {
    const active = isActive(pathname, i.href);
    return (
      <li key={i.href} className="flex-1">
        <Link
          href={i.href}
          aria-current={active ? "page" : undefined}
          className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-xs ${active ? "font-semibold text-accent" : "text-text-muted"}`}
        >
          <i.icon aria-hidden="true" size={22} />
          {label}
        </Link>
      </li>
    );
  };
  const moreActive = moreItems.some((i) => isActive(pathname, i.href));

  return (
    <>
      <nav aria-label={m.nav.mobileLabel} className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto flex max-w-lg items-stretch px-2 py-1">
          {item(overview)}
          {item(positions)}
          <li className="flex-1">
            <Link
              href={NEW_TX.href}
              aria-label={NEW_TX.label}
              aria-current={pathname === NEW_TX.href ? "page" : undefined}
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-contrast shadow-sm"
            >
              <NEW_TX.icon aria-hidden="true" size={24} />
            </Link>
          </li>
          {item(transactions)}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              className={`flex w-full flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-xs ${moreActive ? "font-semibold text-accent" : "text-text-muted"}`}
            >
              <Ellipsis aria-hidden="true" size={22} />
              {m.nav.more}
            </button>
          </li>
        </ul>
      </nav>
      <Modal open={open} onClose={() => setOpen(false)} title={m.nav.more}>
        <ul className="flex flex-col gap-1">
          {moreItems.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(pathname, i.href) ? "page" : undefined}
                className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-subtle aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold"
              >
                <i.icon aria-hidden="true" size={20} />
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-border pt-4">{footer}</div>
      </Modal>
    </>
  );
}
