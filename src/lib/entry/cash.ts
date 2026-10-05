/**
 * Cash on an account (spec 2026-09-28 §3.4): the money a sale, an interest
 * payment or a maturity leaves there, and what a later buy may take from it.
 * A buy on day D may use at most the smallest end-of-day balance from D to
 * today, so no day of the history goes below zero. The form shows the same
 * figure as a preview; the server's figure is the one that counts.
 */
import { type LedgerEvent, orderEvents } from "@/lib/finance/ledger";
import { D, type Day, type Dec } from "@/lib/finance/money";

/** The end-of-day balance after a day that changes it. */
export type CashStep = { day: Day; balance: string };

export const cashKey = (accountId: string, currency: string) => `${accountId}|${currency}`;

/** Per account and currency, the end-of-day balances, oldest first. */
export function cashTimeline(events: LedgerEvent[]): Map<string, CashStep[]> {
  const running = new Map<string, Dec>();
  const out = new Map<string, CashStep[]>();
  for (const e of orderEvents(events)) {
    for (const l of e.lines) {
      if (l.kind !== "cash") continue;
      const key = cashKey(l.accountId, l.currency);
      const balance = (running.get(key) ?? new D(0)).plus(l.amount);
      running.set(key, balance);
      const steps = out.get(key) ?? [];
      const last = steps[steps.length - 1];
      if (last && last.day === e.date) last.balance = balance.toFixed();
      else steps.push({ day: e.date, balance: balance.toFixed() });
      out.set(key, steps);
    }
  }
  return out;
}

/** The most a buy on `day` may take: the smallest end-of-day balance from `day` on, never below zero. */
export function availableFrom(steps: CashStep[] | undefined, day: Day): Dec {
  if (!steps?.length) return new D(0);
  let i = 0;
  let endOfDay = new D(0);
  while (i < steps.length && steps[i].day < day) endOfDay = new D(steps[i++].balance);
  if (i < steps.length && steps[i].day === day) endOfDay = new D(steps[i++].balance);
  let min = endOfDay;
  for (; i < steps.length; i++) min = D.min(min, new D(steps[i].balance));
  return min.gt(0) ? min : new D(0);
}

/** The end-of-day balance on `day`: the last step on or before it, 0 before the first. */
function balanceOn(steps: CashStep[], day: Day): Dec {
  let balance = new D(0);
  for (const s of steps) {
    if (s.day > day) break;
    balance = new D(s.balance);
  }
  return balance;
}

/**
 * Whether a change (an edit or a delete) would take away cash that a later
 * buy relied on: some account's end-of-day balance goes below zero on a day
 * where it was not below zero before. A history that was already negative
 * there is not the change's fault.
 */
export function cashBreaks(before: LedgerEvent[], after: LedgerEvent[]): boolean {
  const was = cashTimeline(before);
  for (const [key, steps] of cashTimeline(after)) {
    const old = was.get(key) ?? [];
    const days = new Set([...steps, ...old].map((s) => s.day));
    for (const day of days) if (balanceOn(steps, day).lt(0) && balanceOn(old, day).gte(0)) return true;
  }
  return false;
}
