/**
 * Numbers on screen. Every amount carries the `amount` class, so privacy mode
 * can blur it; direction is always shown with a sign and ▲/▼, not colour alone.
 * Server components: each reads the request's language (getI18n, once per request).
 */
import "server-only";
import type { Dec } from "@/lib/finance/money";
import { getI18n } from "@/lib/i18n-server";

type Cls = { className?: string };

export async function Amount({ value, currency, className = "" }: { value: Dec | null | undefined; currency: string } & Cls) {
  const { m, f } = await getI18n();
  if (value === null || value === undefined) return <span className={className}>{m.common.none}</span>;
  return <span className={`amount whitespace-nowrap ${className}`}>{f.money(value, currency)}</span>;
}

/** A unit price, with the decimals it has (up to four): an ÁKK price is ≈ 1,0123 Ft, not 1 Ft (#76). */
export async function Price({ value, currency, className = "" }: { value: Dec | null | undefined; currency: string } & Cls) {
  const { m, f } = await getI18n();
  if (value === null || value === undefined) return <span className={className}>{m.common.none}</span>;
  return <span className={`amount whitespace-nowrap ${className}`}>{f.price(value, currency)}</span>;
}

const tone = { up: "text-gain", down: "text-loss", flat: "text-text-muted" } as const;

export async function Change({ value, currency, className = "" }: { value: Dec | null | undefined; currency: string } & Cls) {
  const { m, f } = await getI18n();
  if (value === null || value === undefined) return <span className={className}>{m.common.none}</span>;
  const c = f.change(value, currency);
  return <span className={`amount whitespace-nowrap ${tone[c.direction]} ${className}`}>{c.text}</span>;
}

export async function Pct({ rate, className = "", signed = true }: { rate: Dec | null | undefined; signed?: boolean } & Cls) {
  const { m, f } = await getI18n();
  if (rate === null || rate === undefined) return <span className={className}>{m.common.none}</span>;
  const direction = !signed || rate.isZero() ? "flat" : rate.gt(0) ? "up" : "down";
  const arrow = !signed || direction === "flat" ? "" : direction === "up" ? "▲ " : "▼ ";
  return <span className={`whitespace-nowrap ${signed ? tone[direction] : ""} ${className}`}>{arrow + f.percent(rate, 2, signed)}</span>;
}

export async function Qty({ value, className = "" }: { value: Dec } & Cls) {
  const { f } = await getI18n();
  return <span className={`amount whitespace-nowrap ${className}`}>{f.quantity(value)}</span>;
}

export async function Day({ day, className = "" }: { day: string } & Cls) {
  const { f } = await getI18n();
  return (
    <time dateTime={day} className={`whitespace-nowrap ${className}`}>
      {f.day(day)}
    </time>
  );
}
