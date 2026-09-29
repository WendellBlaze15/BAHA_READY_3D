import { clientIp, fail, json, route } from '@/lib/api/http';
import { rateLimit, getRedis } from '@/lib/ratelimit';
import { serverEnv } from '@/lib/env/server';
import { fetchWeather, type Weather } from '@/lib/weather';

export const runtime = 'nodejs';

const LAST_GOOD = 'weather:last';

/** Open-Meteo proxy: 15-min cache; on failure serves the last good value (marked stale). */
export const GET = route(async (req) => {
  await rateLimit('weather', clientIp(req));
  const env = serverEnv();
  try {
    const w = await fetchWeather(env.WEATHER_LAT, env.WEATHER_LON);
    await getRedis().set(LAST_GOOD, w, { ex: 60 * 60 * 24 });
    return json(
      { ...w, stale: false },
      { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' } },
    );
  } catch {
    const last = await getRedis().get<Weather>(LAST_GOOD);
    if (last) return json({ ...last, stale: true });
    throw fail('INTERNAL', 'weather.unavailable');
  }
});
