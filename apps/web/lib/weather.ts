import 'server-only';
import { z } from 'zod';

const openMeteoSchema = z.object({
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    precipitation: z.number(),
    rain: z.number().optional(),
    weather_code: z.number(),
    wind_speed_10m: z.number(),
  }),
});

export type Weather = {
  temp_c: number;
  precipitation_mm: number;
  wind_kph: number;
  weather_code: number;
  updated_at: string;
};

/** Current weather for Pila, Laguna (coordinates from config, not components). Cached 15 min. */
export async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m,precipitation,rain,weather_code,wind_speed_10m');
  url.searchParams.set('timezone', 'Asia/Manila');
  const res = await fetch(url, { next: { revalidate: 900 }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const { current } = openMeteoSchema.parse(await res.json());
  return {
    temp_c: Math.round(current.temperature_2m * 10) / 10,
    precipitation_mm: current.precipitation,
    wind_kph: Math.round(current.wind_speed_10m),
    weather_code: current.weather_code,
    updated_at: new Date().toISOString(),
  };
}

/** WMO weather code → rain intensity 0..1 (seeds in-game rain in Real Weather Mode). */
export function rainIntensityFromCode(code: number) {
  if ([95, 96, 99].includes(code)) return 1;
  if ([65, 82].includes(code)) return 0.85;
  if ([63, 81].includes(code)) return 0.6;
  if ([51, 53, 55, 61, 80].includes(code)) return 0.35;
  return 0.1;
}
