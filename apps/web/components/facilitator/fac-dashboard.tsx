'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Activity, CheckCircle2, Star, UserPlus, Users, Gamepad2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useMyOwnedGroups, useOverview } from '@/lib/data/facilitator';
import { SkeletonStat } from '@/components/skeletons';
import { Button } from '@/components/ui/button';

export function FacDashboard({
  mistakeLabels,
}: {
  mistakeLabels: Record<string, { fil: string; en: string }>;
}) {
  const t = useTranslations('fac');
  const locale = useLocale();
  const { data, isPending } = useOverview();
  const groups = useMyOwnedGroups();

  const label = (key: string) => {
    const base = key.replace(/^(missing_|skipped_|packed_|npc_left_)/, '');
    const l = mistakeLabels[base];
    return l ? (locale === 'en' ? l.en : l.fil) : key;
  };

  const stats = data
    ? [
        { icon: Users, label: t('members'), value: data.members },
        { icon: Activity, label: t('activeToday'), value: data.active_today },
        { icon: Star, label: t('avgStars'), value: data.avg_stars ?? '—' },
        {
          icon: CheckCircle2,
          label: t('completion'),
          value: data.completion_rate === null ? '—' : `${Math.round(data.completion_rate * 100)}%`,
        },
        { icon: Gamepad2, label: t('attempts'), value: data.attempts },
        { icon: UserPlus, label: t('pending'), value: data.pending_requests },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold">{t('dashboardTitle')}</h1>
          <p className="text-muted-foreground">{t('overview')}</p>
        </div>
        <Button
          asChild
          className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-11 font-bold"
        >
          <Link href="/facilitator/groups?new=1">{t('newGroup')}</Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {isPending
          ? Array.from({ length: 6 }, (_, i) => <SkeletonStat key={i} />)
          : stats.map(({ icon: Icon, label: l, value }) => (
              <div key={l} className="bg-card rounded-lg border p-4">
                <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                  <Icon className="size-4" aria-hidden /> {l}
                </p>
                <p className="font-display text-3xl font-bold tabular-nums">{value}</p>
              </div>
            ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bg-card rounded-lg border p-5">
          <h2 className="mb-3 text-xl font-bold">{t('topMistakes')}</h2>
          {!data?.top_mistakes.length ? (
            <p className="text-muted-foreground text-sm">{t('noData')}</p>
          ) : (
            <ol className="space-y-2">
              {data.top_mistakes.map((m, i) => (
                <li key={m.key} className="flex items-center gap-3">
                  <span className="bg-signal-red font-display flex size-8 items-center justify-center rounded-full font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="flex-1">{label(m.key)}</span>
                  <span className="text-muted-foreground tabular-nums">×{m.count}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="bg-card rounded-lg border p-5">
          <h2 className="mb-3 text-xl font-bold">{t('groupsTitle')}</h2>
          <ul className="divide-y">
            {(groups.data ?? [])
              .filter((g) => !g.is_archived)
              .slice(0, 6)
              .map((g) => (
                <li key={g.id}>
                  <Link
                    href={`/facilitator/groups/${g.id}`}
                    className="flex min-h-12 items-center justify-between gap-2 py-2"
                  >
                    <span className="font-bold">{g.name}</span>
                    <span className="font-display bg-muted rounded-sm px-2 tracking-widest">
                      {g.join_code}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
          {!groups.isPending && !groups.data?.length && (
            <p className="text-muted-foreground text-sm">{t('noData')}</p>
          )}
        </section>
      </div>
    </div>
  );
}
