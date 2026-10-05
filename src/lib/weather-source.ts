import "server-only";
/**
 * Where the header's weather comes from: Open-Meteo is used only when a
 * matching project reference is explicitly configured. Otherwise the app
 * uses an invented constant, so local runs and the demo make no request.
 * Any failure is no weather: the header then shows day or night by the clock.
 */
import { realSources } from "@/lib/refresh/service";
import { readAppMode } from "@/lib/demo/config";
import { daylight, isFresh, parseWeather, type Weather, WEATHER_URL } from "./weather";

export const WEATHER_TIMEOUT_MS = 3_000;
/** Seconds an answer is served from Next's data cache. */
export const WEATHER_REVALIDATE_S = 1_800;
export const FAKE_WEATHER: Omit<Weather, "isDay"> = { kind: "partly", temperature: 18 };

async function ask(get: typeof fetch, init: RequestInit) {
  const res = await get(WEATHER_URL, { ...init, signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS) });
  return res.ok ? parseWeather(await res.json()) : null;
}

export async function currentWeather({ real = realSources(), fetch: get = fetch, now = new Date() } = {}): Promise<Weather | null> {
  if (readAppMode(process.env).demo) return { ...FAKE_WEATHER, isDay: daylight(now) };
  if (!real) return { ...FAKE_WEATHER, isDay: daylight(now) };
  try {
    const cached = await ask(get, { next: { revalidate: WEATHER_REVALIDATE_S } });
    if (cached && isFresh(cached.at, now)) return cached.weather;
    // After a quiet night the cache serves last evening's answer once: ask past it.
    const fresh = await ask(get, { cache: "no-store" });
    return fresh && isFresh(fresh.at, now) ? fresh.weather : null;
  } catch {
    return null;
  }
}
