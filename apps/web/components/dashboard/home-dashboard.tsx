'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { BookOpen, CalendarDays, Flame, Megaphone, Play, Star } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { useProfile, useProgress, useStreak } from '@/lib/data/me';
import { useDailyChallenge, useLevels } from '@/lib/data/content';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { BlockyAvatar } from '@/components/avatar/blocky-avatar';
import { StormSignalMeter } from '@/components/storm-signal-meter/storm-signal-meter';
import { WeatherWidget } from '@/components/weather-widget';
import { Skeleton, SkeletonText } from '@/components/skeletons';
import { ApplicationBanner } from '@/components/apply/application-banner';
import { Button } from '@/components/ui/button';

export function HomeDashboard() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const { data: profile } = useProfile();
  const levels = useLevels();
  const progress = useProgress();
  const streak = useStreak();
  const daily = useDailyChallenge();

  const levelName = (id: number) => {
    const l = levels.data?.find((x) => x.id === id);
    return l ? (locale === 'en' ? l.name_en : l.name_fil) : `Level ${id}`;
  };

  const playable = (levels.data ?? []).filter((l) => l.id > 0);
  const byLevel = new Map((progress.data ?? []).map((p) => [p.level_id, p]));
  const earned = playable.reduce((s, l) => s + (byLevel.get(l.id)?.best_stars ?? 0), 0);
  const done = playable.filter((l) => (byLevel.get(l.id)?.best_stars ?? 0) > 0).length;
  const next =
    (levels.data ?? []).find(
      (l) => byLevel.get(l.id)?.unlocked && (byLevel.get(l.id)?.best_stars ?? 0) === 0,
    ) ??
    (levels.data ?? []).find(
      (l) => byLevel.get(l.id)?.unlocked && (byLevel.get(l.id)?.best_stars ?? 0) < 3,
    );

  const coreLoading = levels.isPending || progress.isPending;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-8">
      <header className="flex items-center gap-4">
        <BlockyAvatar config={profile?.avatar_config as Partial<AvatarConfig>} size={48} />
        <div>
          <h1 className="text-3xl font-bold">{t('greeting', { name: profile?.username ?? '' })}</h1>
          <p className="text-muted-foreground">{t('lede')}</p>
        </div>
      </header>

      <ApplicationBanner />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Continue */}
        <section
          aria-labelledby="continue-title"
          className="bg-storm-slate text-mist rounded-lg p-5 lg:col-span-2"
        >
          <h2 id="continue-title" className="text-xl font-bold">
            {t('continueTitle')}
          </h2>
          <div className="mt-3 min-h-[92px]">
            {coreLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full opacity-40" />
                <Skeleton className="h-12 w-56 opacity-40" />
              </div>
            ) : (
              <>
                <StormSignalMeter
                  value={next ? Math.max(next.id, 0.3) : 5}
                  label={t('levelsDone', { done, total: playable.length })}
                  valueText={t('levelsDone', { done, total: playable.length })}
                  className="[&_span]:text-mist/80 max-w-md"
                />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {next ? (
                    <Button
                      asChild
                      size="lg"
                      className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 font-bold"
                    >
                      <Link href={`/levels?level=${next.slug}`}>
                        <Play aria-hidden /> {t('continueCta', { level: levelName(next.id) })}
                      </Link>
                    </Button>
                  ) : (
                    <p>{t('allDone')}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        <WeatherWidget />

        {/* Stars */}
        <Stat
          icon={<Star className="text-signal-amber size-5" aria-hidden />}
          title={t('starsTitle')}
          loading={coreLoading}
          value={t('starsValue', { earned, total: playable.length * 3 })}
          sub={t('levelsDone', { done, total: playable.length })}
        />
        {/* Streak */}
        <Stat
          icon={<Flame className="text-signal-red size-5" aria-hidden />}
          title={t('streakTitle')}
          loading={streak.isPending}
          value={t('streakDays', { count: streak.data?.current ?? 0 })}
          sub={t('streakLongest', { count: streak.data?.longest ?? 0 })}
        />
        {/* Daily challenge */}
        <section
          aria-labelledby="daily-title"
          className="bg-card min-h-[132px] rounded-lg border p-4"
        >
          <h2
            id="daily-title"
            className="text-muted-foreground flex items-center gap-2 text-sm font-bold"
          >
            <CalendarDays className="size-4" aria-hidden /> {t('dailyTitle')}
          </h2>
          {daily.isPending || levels.isPending ? (
            <SkeletonText lines={2} className="mt-3" />
          ) : daily.data ? (
            <div className="mt-2 space-y-3">
              <p>{t('dailyBody', { level: levelName(daily.data.level_id) })}</p>
              <Button asChild variant="outline" className="min-h-11">
                <Link href="/daily">{t('dailyCta')}</Link>
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground mt-2 text-sm">{t('dailyNone')}</p>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Announcements />
        <RecentTips />
      </div>
    </div>
  );
}

function Stat({
  icon,
  title,
  value,
  sub,
  loading,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  sub: string;
  loading: boolean;
}) {
  return (
    <section className="bg-card min-h-[132px] rounded-lg border p-4">
      <h2 className="text-muted-foreground flex items-center gap-2 text-sm font-bold">
        {icon} {title}
      </h2>
      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-3.5 w-36" />
        </div>
      ) : (
        <>
          <p className="font-display mt-2 text-3xl font-bold tabular-nums">{value}</p>
          <p className="text-muted-foreground text-sm">{sub}</p>
        </>
      )}
    </section>
  );
}

function Announcements() {
  const t = useTranslations('dashboard');
  const { data, isPending } = useQuery({
    queryKey: ['groups', 'announcements', 'latest'],
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser()
        .from('announcements')
        .select('id, title, body, scope, created_at')
        .order('created_at', { ascending: false })
        .limit(3);
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
  });
  return (
    <section aria-labelledby="ann-title" className="bg-card rounded-lg border p-5">
      <h2 id="ann-title" className="flex items-center gap-2 text-xl font-bold">
        <Megaphone className="text-lake size-5" aria-hidden /> {t('announcementsTitle')}
      </h2>
      <div className="mt-3 min-h-24">
        {isPending ? (
          <SkeletonText lines={3} />
        ) : data?.length ? (
          <ul className="divide-y">
            {data.map((a) => (
              <li key={a.id} className="py-2.5">
                <p className="font-bold">{a.title}</p>
                <p className="text-muted-foreground line-clamp-2 text-sm">{a.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t('announcementsEmpty')}</p>
        )}
      </div>
    </section>
  );
}

function RecentTips() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const { data, isPending } = useQuery({
    queryKey: [...qk.me.tips(), 'recent'],
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser()
        .from('player_tips')
        .select('unlocked_at, read_at, tips(slug, title_fil, title_en)')
        .order('unlocked_at', { ascending: false })
        .limit(4);
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
  return (
    <section aria-labelledby="tips-title" className="bg-card rounded-lg border p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="tips-title" className="flex items-center gap-2 text-xl font-bold">
          <BookOpen className="text-evac-green size-5" aria-hidden /> {t('tipsTitle')}
        </h2>
        <Link href="/tips" className="text-link text-sm underline">
          {t('seeAll')}
        </Link>
      </div>
      <div className="mt-3 min-h-24">
        {isPending ? (
          <SkeletonText lines={3} />
        ) : data?.length ? (
          <ul className="divide-y">
            {data.map((row) =>
              row.tips ? (
                <li key={row.tips.slug}>
                  <Link
                    href={`/tips/${row.tips.slug}`}
                    className="flex min-h-11 items-center justify-between gap-2 py-2"
                  >
                    <span>{locale === 'en' ? row.tips.title_en : row.tips.title_fil}</span>
                    {!row.read_at && (
                      <span className="bg-evac-green rounded-sm px-1.5 text-xs font-bold text-white">
                        NEW
                      </span>
                    )}
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t('tipsEmpty')}</p>
        )}
      </div>
    </section>
  );
}
