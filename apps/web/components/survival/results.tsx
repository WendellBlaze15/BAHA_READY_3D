'use client';

import { useTranslations } from 'next-intl';
import { Award, Gift, Share2 } from 'lucide-react';
import { lessonFor, type LessonKind } from '@baha/shared/survival';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSurvivalText } from './use-text';

export interface ResultsData {
  ending: 'full_rescue' | 'partial_rescue' | 'failed';
  score: number;
  difficulty?: string;
  summary: {
    daysSurvived: number;
    boatStagesCompleted: number;
    playersRescued: number;
    npcsRescued: number;
    deaths: number;
  };
  learning: Record<string, { good: number; bad: number }>;
}

const ENDING_STYLE = {
  full_rescue: 'from-emerald-600 to-emerald-900',
  partial_rescue: 'from-amber-600 to-amber-900',
  failed: 'from-slate-600 to-slate-900',
} as const;

/** Ending + server score + "Mga Natutunan" (done right / improve / dangerous). */
export function ResultsView({
  data,
  rewards,
  overlay,
}: {
  data: ResultsData;
  rewards?: { rewards: string[]; achievements: string[] } | null;
  overlay?: boolean;
}) {
  const t = useTranslations('survival');
  const { locale } = useSurvivalText();
  const groups: Record<LessonKind, { key: string; count: number; text: string }[]> = {
    good: [],
    improve: [],
    danger: [],
  };
  for (const [key, c] of Object.entries(data.learning ?? {})) {
    const l = lessonFor(key);
    if (!l) continue;
    const count = l.kind === 'good' ? c.good : c.bad || c.good;
    if (count > 0) groups[l.kind].push({ key, count, text: l[locale] });
  }
  for (const g of Object.values(groups)) g.sort((a, b) => b.count - a.count);

  const share = async () => {
    const text = t('results.shareText', {
      ending: t(`ending.${data.ending}`),
      difficulty: data.difficulty ? t(`difficulty.${data.difficulty}` as 'difficulty.normal') : '',
      days: data.summary.daysSurvived,
    });
    if (navigator.share) await navigator.share({ title: t('title'), text }).catch(() => {});
    else await navigator.clipboard.writeText(text);
  };

  const stat = (label: string, value: number | string) => (
    <div className="rounded-lg bg-black/20 p-2 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs opacity-80">{label}</p>
    </div>
  );

  return (
    <div
      className={cn(overlay && 'fixed inset-0 z-[66] overflow-y-auto bg-black/70 backdrop-blur-sm')}
      style={overlay ? { height: '100dvh' } : undefined}
    >
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <section
          className={cn('rounded-2xl bg-gradient-to-br p-5 text-white', ENDING_STYLE[data.ending])}
        >
          <h2 className="text-3xl font-bold">{t(`ending.${data.ending}`)}</h2>
          <p className="mt-1 opacity-90">{t(`endingBody.${data.ending}`)}</p>
          <p className="mt-4 text-5xl font-black" aria-label={t('results.score')}>
            {data.score.toLocaleString()}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stat(t('results.days'), data.summary.daysSurvived)}
            {stat(t('results.boat'), `${data.summary.boatStagesCompleted}/6`)}
            {stat(t('results.rescued'), data.summary.playersRescued)}
            {stat(t('results.npcs'), data.summary.npcsRescued)}
          </div>
        </section>

        {rewards && (rewards.rewards.length > 0 || rewards.achievements.length > 0) && (
          <section className="bg-card rounded-xl border p-4">
            {rewards.rewards.length > 0 && (
              <p className="flex items-center gap-2">
                <Gift className="text-signal-amber size-5" aria-hidden /> {t('results.rewards')}:{' '}
                {rewards.rewards.join(', ')}
              </p>
            )}
            {rewards.achievements.length > 0 && (
              <p className="flex items-center gap-2">
                <Award className="text-signal-amber size-5" aria-hidden />{' '}
                {t('results.achievements')}: {rewards.achievements.join(', ')}
              </p>
            )}
          </section>
        )}

        <section className="bg-card space-y-4 rounded-xl border p-4">
          <h3 className="text-xl font-bold">{t('results.learned')}</h3>
          {(['good', 'improve', 'danger'] as const).map((k) =>
            groups[k].length ? (
              <div key={k}>
                <h4
                  className={cn(
                    'font-semibold',
                    k === 'good'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : k === 'improve'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-red-700 dark:text-red-400',
                  )}
                >
                  {t(`results.${k}`)}
                </h4>
                <ul className="mt-1 space-y-1 text-sm">
                  {groups[k].map((g) => (
                    <li key={g.key} className="flex gap-2">
                      <span className="shrink-0 font-mono text-xs opacity-70">
                        {t('results.times', { count: g.count })}
                      </span>
                      <span>{g.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          <p className="text-muted-foreground text-xs">{t('results.tipsUnlocked')}</p>
        </section>

        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg">
            <Link href="/survival">{t('results.backToHub')}</Link>
          </Button>
          <Button size="lg" variant="outline" onClick={share}>
            <Share2 aria-hidden /> {t('results.share')}
          </Button>
        </div>
      </div>
    </div>
  );
}
