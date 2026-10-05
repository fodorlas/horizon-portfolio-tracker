/**
 * Budapest weather for the header greeting: Open-Meteo's current block
 * (weather code, day or night, temperature) in a few words. The request goes
 * from the server with the city's coordinates only (weather-source.ts).
 */
import { z } from "zod";

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "showers" | "snow" | "thunder";
export type Weather = { kind: WeatherKind; isDay: boolean; temperature: number };

/** Budapest, fixed; no time zone, so `current.time` comes in GMT. */
export const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=47.50&longitude=19.04&current=temperature_2m,weather_code,is_day";

/** The current block is 15 minutes wide and cached for 30 more: older means a stale cache entry. */
export const FRESH_MS = 60 * 60_000;

const KINDS: [WeatherKind, number[]][] = [
  ["clear", [0]],
  ["partly", [1, 2]],
  ["cloudy", [3]],
  ["fog", [45, 48]],
  ["drizzle", [51, 53, 55, 56, 57]],
  ["rain", [61, 63, 65, 66, 67]],
  ["snow", [71, 73, 75, 77, 85, 86]],
  ["showers", [80, 81, 82]],
  ["thunder", [95, 96, 99]],
];

/** A WMO weather code → its group; null for a code Open-Meteo does not use. */
export function weatherKind(code: number): WeatherKind | null {
  return KINDS.find(([, codes]) => codes.includes(code))?.[0] ?? null;
}

const Answer = z.object({
  current: z.object({
    time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    temperature_2m: z.number().finite(),
    weather_code: z.number().int(),
    is_day: z.union([z.literal(0), z.literal(1)]),
  }),
});

/** The weather in an answer and when it was measured; null for anything unexpected. */
export function parseWeather(json: unknown): { weather: Weather; at: Date } | null {
  const r = Answer.safeParse(json);
  if (!r.success) return null;
  const c = r.data.current;
  const kind = weatherKind(c.weather_code);
  if (!kind) return null;
  return { weather: { kind, isDay: c.is_day === 1, temperature: Math.round(c.temperature_2m) }, at: new Date(`${c.time}:00Z`) };
}

export const isFresh = (at: Date, now: Date) => now.getTime() - at.getTime() <= FRESH_MS;

/** Budapest sunrise and sunset by month, local time, to the half hour (mid-month). */
const DAYLIGHT: [number, number][] = [
  [7.5, 16.5], [7, 17], [6, 18], [6, 19.5], [5, 20], [5, 20.5],
  [5, 20.5], [5.5, 20], [6.5, 19], [7, 18], [7, 16], [7.5, 16],
];

const budapestClock = new Intl.DateTimeFormat("en-GB", { month: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: "Europe/Budapest" });

/** Day or night by the Budapest clock: the icon when there is no weather. */
export function daylight(now: Date = new Date()): boolean {
  const part = (type: string) => Number(budapestClock.formatToParts(now).find((p) => p.type === type)?.value);
  const [rise, set] = DAYLIGHT[part("month") - 1];
  const hour = part("hour") + part("minute") / 60;
  return hour >= rise && hour < set;
}

/** "21 °C", "−3 °C": a typographic minus, a space that does not break. */
export function formatTemperature(t: number): string {
  return `${t < 0 ? "−" : ""}${Math.abs(t)}\u00a0°C`;
}
