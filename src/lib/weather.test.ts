import { describe, expect, it } from "vitest";
import { daylight, formatTemperature, isFresh, parseWeather, weatherKind } from "./weather";

// A real answer (2026-09-27), shape as Open-Meteo sends it.
const answer = {
  latitude: 47.501236,
  longitude: 19.03534,
  utc_offset_seconds: 0,
  timezone: "GMT",
  current_units: { time: "iso8601", interval: "seconds", temperature_2m: "°C", weather_code: "wmo code", is_day: "" },
  current: { time: "2026-09-27T18:15", interval: 900, temperature_2m: 20.7, weather_code: 2, is_day: 0 },
};

describe("weatherKind: WMO codes in a few words", () => {
  it("groups the codes Open-Meteo uses", () => {
    const kinds = [0, 1, 2, 3, 45, 48, 51, 57, 61, 67, 71, 77, 80, 82, 85, 86, 95, 99].map(weatherKind);
    expect(kinds).toEqual([
      "clear", "partly", "partly", "cloudy", "fog", "fog", "drizzle", "drizzle", "rain", "rain",
      "snow", "snow", "showers", "showers", "snow", "snow", "thunder", "thunder",
    ]);
  });

  it("an unknown code is no weather", () => {
    expect([4, 50, 100, -1].map(weatherKind)).toEqual([null, null, null, null]);
  });
});

describe("parseWeather: the current block of an answer", () => {
  it("kind, day or night, the rounded temperature and when it was measured", () => {
    expect(parseWeather(answer)).toEqual({ weather: { kind: "partly", isDay: false, temperature: 21 }, at: new Date("2026-09-27T18:15:00Z") });
  });

  it("anything else is no weather", () => {
    const current = (c: object) => ({ ...answer, current: { ...answer.current, ...c } });
    for (const bad of [null, "x", {}, { current: null }, current({ weather_code: 999 }), current({ is_day: 2 }), current({ temperature_2m: "20" }), current({ time: "tegnap" })]) {
      expect(parseWeather(bad)).toBeNull();
    }
  });
});

describe("isFresh: an answer served late from the cache is not used", () => {
  const at = new Date("2026-09-27T18:15:00Z");
  it("up to an hour old", () => {
    expect(isFresh(at, new Date("2026-09-27T18:50:00Z"))).toBe(true);
    expect(isFresh(at, new Date("2026-09-27T19:15:00Z"))).toBe(true);
    expect(isFresh(at, new Date("2026-09-27T19:16:00Z"))).toBe(false);
  });
});

describe("daylight: day or night by the Budapest clock, when there is no weather", () => {
  it("follows the season", () => {
    // 17:30 in Budapest: dark in December, light in June.
    expect(daylight(new Date("2026-12-15T16:30:00Z"))).toBe(false);
    expect(daylight(new Date("2026-06-15T15:30:00Z"))).toBe(true);
    // 06:00 in Budapest: light in June, dark in January.
    expect(daylight(new Date("2026-06-15T04:00:00Z"))).toBe(true);
    expect(daylight(new Date("2026-01-15T05:00:00Z"))).toBe(false);
    // Midnight and noon, any month.
    expect(daylight(new Date("2026-09-27T22:00:00Z"))).toBe(false);
    expect(daylight(new Date("2026-09-27T10:00:00Z"))).toBe(true);
  });
});

describe("formatTemperature", () => {
  it("a typographic minus and a space that does not break", () => {
    expect(formatTemperature(21)).toBe("21\u00a0°C");
    expect(formatTemperature(-3)).toBe("−3\u00a0°C");
    expect(formatTemperature(-0)).toBe("0\u00a0°C");
  });
});
