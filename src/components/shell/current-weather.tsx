import { getI18n } from "@/lib/i18n-server";
import { daylight } from "@/lib/weather";
import { currentWeather } from "@/lib/weather-source";
import { DayNight, WeatherBadge } from "./weather";

/** Streams in after the header (Suspense): a slow weather service never holds the page. */
export async function CurrentWeather() {
  const [weather, i18n] = await Promise.all([currentWeather(), getI18n()]);
  return weather ? <WeatherBadge weather={weather} i18n={i18n} /> : <DayNight isDay={daylight()} i18n={i18n} />;
}
