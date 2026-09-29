'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CloudLightning, CloudRain, CloudSun, Sun, Wind } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { Skeleton } from '@/components/skeletons';
import { cn } from '@/lib/utils';

type WeatherData = {
  temp_c: number;
  precipitation_mm: number;
  wind_kph: number;
  weather_code: number;
  updated_at: string;
  stale: boolean;
};

function iconFor(code: number) {
  if (code >= 95) return CloudLightning;
  if (code >= 51) return CloudRain;
  if (code >= 1) return CloudSun;
  return Sun;
}

export function WeatherWidget({ className }: { className?: string }) {
  const t = useTranslations('weather');
  const { data, isPending, isError } = useQuery({
    queryKey: qk.weather.current(),
    queryFn: async () => {
      const res = await fetch('/api/weather');
      const env = (await res.json()) as { data: WeatherData | null };
      if (!res.ok || !env.data) throw new Error('weather');
      return env.data;
    },
    staleTime: 15 * 60_000,
    retry: 1,
  });

  // Fixed height in every state so the card never shifts layout.
  return (
    <section
      aria-labelledby="weather-title"
      className={cn('bg-card h-[132px] rounded-lg border p-4', className)}
    >
      <h2 id="weather-title" className="text-muted-foreground text-sm font-bold">
        {t('title')}
      </h2>
      {isPending ? (
        <div className="mt-3 flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3.5 w-36" />
          </div>
        </div>
      ) : isError || !data ? (
        <p className="text-muted-foreground mt-3 text-sm">{t('unavailable')}</p>
      ) : (
        <WeatherBody data={data} />
      )}
    </section>
  );
}

function WeatherBody({ data }: { data: WeatherData }) {
  const t = useTranslations('weather');
  const Icon = iconFor(data.weather_code);
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(data.updated_at).getTime()) / 60000),
  );
  return (
    <div className="mt-2 flex items-center gap-3">
      <Icon className="text-lake size-10 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-display text-3xl font-bold tabular-nums">{Math.round(data.temp_c)}°C</p>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-sm">
          <span>
            <CloudRain className="mr-1 inline size-3.5" aria-hidden />
            {t('rain', { mm: data.precipitation_mm })}
          </span>
          <span>
            <Wind className="mr-1 inline size-3.5" aria-hidden />
            {t('wind', { kph: data.wind_kph })}
          </span>
        </p>
        <p className="text-muted-foreground text-xs">{t('updated', { minutes })}</p>
      </div>
    </div>
  );
}
