/**
 * Outbound requests of the price and FX sources (phase 4 plan §3): one at a
 * time, 10 s each, inside a shared work budget, with a small retry policy.
 * Failures become short error classes for the refresh log – never response
 * content.
 */

export const REQUEST_TIMEOUT_MS = 10_000;
/** No new request starts after this; what is saved stays saved. */
export const WORK_BUDGET_MS = 45_000;
/** 429: wait 1 s, then 3 s; a Retry-After up to 5 s is honoured instead. */
export const RATE_LIMIT_DELAYS_MS = [1_000, 3_000] as const;
export const MAX_RETRY_AFTER_MS = 5_000;
/** 5xx, timeout, network: one more try after 1 s. */
export const TRANSIENT_DELAY_MS = 1_000;

export type ErrorClass = "timeout" | "http_429" | "http_5xx" | "http_4xx" | "symbol_not_found" | "network" | "parse" | "budget" | "rate_limited";

export class ProviderError extends Error {
  constructor(
    readonly errorClass: ErrorClass,
    readonly retryAfterMs: number | null = null,
  ) {
    super(errorClass);
    this.name = "ProviderError";
  }
}

export type Budget = {
  deadline: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export function createBudget(ms = WORK_BUDGET_MS, now: () => number = Date.now, sleep = (t: number) => new Promise<void>((r) => setTimeout(r, t))): Budget {
  return { deadline: now() + ms, now, sleep };
}

export const budgetLeft = (b: Budget) => b.deadline - b.now();

/** Throws "budget" when no new request may start. */
export function checkBudget(b: Budget): void {
  if (budgetLeft(b) <= 0) throw new ProviderError("budget");
}

/** A signal for one request: the request timeout, or less if the budget is nearly gone. */
export function requestSignal(b: Budget): AbortSignal {
  return AbortSignal.timeout(Math.max(1, Math.min(REQUEST_TIMEOUT_MS, budgetLeft(b))));
}

function retryAfterMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const s = Number(value);
  return Number.isFinite(s) && s >= 0 ? s * 1000 : null;
}

/** Any thrown value → an error class. Messages are looked at, never kept. */
export function classify(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = e as { name?: string; message?: string; code?: unknown; cause?: unknown } | null;
  const name = err?.name ?? "";
  const message = String(err?.message ?? "");
  if (name === "TimeoutError" || name === "AbortError") return new ProviderError("timeout");
  // yahoo-finance2: HTTPError with the status in .code; "No data found" for unknown symbols.
  const status = typeof err?.code === "number" ? err.code : null;
  if (status === 429 || /too many requests/i.test(message)) return new ProviderError("http_429");
  if (/no data found|symbol may be delisted|not found/i.test(message) || status === 404) return new ProviderError("symbol_not_found");
  if (status !== null && status >= 500) return new ProviderError("http_5xx");
  if (status !== null && status >= 400) return new ProviderError("http_4xx");
  if (name === "FailedYahooValidationError" || e instanceof SyntaxError) return new ProviderError("parse");
  if (e instanceof TypeError) return new ProviderError("network"); // fetch() failed
  return new ProviderError("network");
}

/**
 * Runs fn with the retry policy. A retry that would not fit in the budget is
 * not attempted: the original error class is kept, which says more.
 */
export async function withRetry<T>(fn: () => Promise<T>, budget: Budget): Promise<T> {
  let rateLimited = 0;
  let transient = 0;
  for (;;) {
    checkBudget(budget);
    try {
      return await fn();
    } catch (e) {
      const err = classify(e);
      let delay: number | null = null;
      if (err.errorClass === "http_429" && rateLimited < RATE_LIMIT_DELAYS_MS.length) {
        if (err.retryAfterMs !== null && err.retryAfterMs > MAX_RETRY_AFTER_MS) throw err;
        delay = err.retryAfterMs ?? RATE_LIMIT_DELAYS_MS[rateLimited];
        rateLimited++;
      } else if (["http_5xx", "timeout", "network"].includes(err.errorClass) && transient < 1) {
        delay = TRANSIENT_DELAY_MS;
        transient++;
      }
      if (delay === null || budgetLeft(budget) <= delay) throw err;
      await budget.sleep(delay);
    }
  }
}

/** fetch() → text, with the budget's timeout and status → error class. */
export async function fetchText(url: string, init: RequestInit, budget: Budget, fetchImpl: typeof fetch = fetch): Promise<string> {
  checkBudget(budget);
  const res = await fetchImpl(url, { ...init, signal: requestSignal(budget), cache: "no-store" });
  if (res.status === 429) throw new ProviderError("http_429", retryAfterMs(res.headers.get("retry-after")));
  if (res.status >= 500) throw new ProviderError("http_5xx");
  if (res.status === 404) throw new ProviderError("http_4xx");
  if (!res.ok) throw new ProviderError("http_4xx");
  return res.text();
}

/** Calendar-year chunks of [from, to] (both inclusive), so no request asks for years at once. */
export function yearChunks(from: string, to: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const a = y === Number(from.slice(0, 4)) ? from : `${y}-01-01`;
    const b = y === Number(to.slice(0, 4)) ? to : `${y}-12-31`;
    if (a <= b) out.push({ from: a, to: b });
  }
  return out;
}
