import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudMoonRain,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  type LucideIcon,
  Moon,
  Sun,
} from "lucide-react";
import type { I18n } from "@/lib/i18n";
import { formatTemperature, type Weather, type WeatherKind } from "@/lib/weather";

/** [day, night] icon of each kind. */
const ICONS: Record<WeatherKind, [LucideIcon, LucideIcon]> = {
  clear: [Sun, Moon],
  partly: [CloudSun, CloudMoon],
  cloudy: [Cloud, Cloud],
  fog: [CloudFog, CloudFog],
  drizzle: [CloudDrizzle, CloudDrizzle],
  rain: [CloudRain, CloudRain],
  showers: [CloudSunRain, CloudMoonRain],
  snow: [CloudSnow, CloudSnow],
  thunder: [CloudLightning, CloudLightning],
};

/** Weather beside the date; Open-Meteo attribution is available on hover. */
export function WeatherBadge({ weather, i18n }: { weather: Weather; i18n: I18n }) {
  const { m, fill } = i18n;
  const Icon = ICONS[weather.kind][weather.isDay ? 0 : 1];
  return (
    <span className="inline-flex items-center gap-1.5" title={m.weather.source}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{fill(m.weather.text, { kind: m.weather.kinds[weather.kind], temperature: formatTemperature(weather.temperature) })}</span>
    </span>
  );
}

/** No weather: only a sun or a moon. */
export function DayNight({ isDay, i18n }: { isDay: boolean; i18n: I18n }) {
  const { m } = i18n;
  const Icon = isDay ? Sun : Moon;
  return (
    <span className="inline-flex items-center">
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="sr-only">{isDay ? m.weather.day : m.weather.night}</span>
    </span>
  );
}
