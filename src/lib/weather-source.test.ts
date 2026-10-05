import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { currentWeather, FAKE_WEATHER, WEATHER_REVALIDATE_S } = await import("./weather-source");
const { WEATHER_URL } = await import("./weather");

const now = new Date("2026-09-27T18:30:00Z"); // 20:30 in Budapest
const answer = (time: string, code = 61) => ({ current: { time, interval: 900, temperature_2m: 12.4, weather_code: code, is_day: 0 } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A fetch that answers in turn and remembers what it was asked. */
function fetcher(...replies: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = replies.shift();
    if (!r || r instanceof Error) throw r ?? new Error("no reply");
    return r;
  };
  return { fetch: f as typeof fetch, calls };
}

describe("currentWeather", () => {
  it("outside production: the invented weather, nothing is asked", async () => {
    const f = fetcher();
    expect(await currentWeather({ real: false, fetch: f.fetch, now })).toEqual({ ...FAKE_WEATHER, isDay: false });
    expect(f.calls).toEqual([]);
  });

  it("production: Open-Meteo through the cache, with a timeout", async () => {
    const f = fetcher(json(answer("2026-09-27T18:15")));
    expect(await currentWeather({ real: true, fetch: f.fetch, now })).toEqual({ kind: "rain", isDay: false, temperature: 12 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe(WEATHER_URL);
    expect(f.calls[0].init.next).toEqual({ revalidate: WEATHER_REVALIDATE_S });
    expect(f.calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a stale cache entry is asked again, past the cache", async () => {
    const f = fetcher(json(answer("2026-09-27T06:00", 0)), json(answer("2026-09-27T18:15")));
    expect(await currentWeather({ real: true, fetch: f.fetch, now })).toEqual({ kind: "rain", isDay: false, temperature: 12 });
    expect(f.calls.map((c) => c.init.cache ?? null)).toEqual([null, "no-store"]);
  });

  it("no weather when the service fails, answers badly or only stale", async () => {
    for (const replies of [
      [new TypeError("fetch failed")],
      [json({}, 503), json({}, 503)],
      [json({ current: "x" }), json({ current: "x" })],
      [json(answer("2026-09-27T06:00")), json(answer("2026-09-27T06:00"))],
      [json(answer("2026-09-27T06:00")), new DOMException("timeout", "TimeoutError")],
    ]) {
      expect(await currentWeather({ real: true, fetch: fetcher(...replies).fetch, now })).toBeNull();
    }
  });
});
