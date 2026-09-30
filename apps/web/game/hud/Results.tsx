'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  CloudOff,
  Home,
  Loader2,
  RotateCcw,
  Share2,
  ShieldCheck,
  Star,
  TrendingUp,
  Trophy,
  ArrowRight,
} from 'lucide-react';
import type { AttemptResult } from '@baha/shared/game';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SubmitResponse } from '@/lib/game/attempt-api';
import type { GameTexts } from '../store/game-store';

function useCountUp(target: number, ms = 900) {
  const reduce = useReducedMotion();
  const [v, setV] = useState(reduce ? target : 0);
  useEffect(() => {
    if (reduce) {
      setV(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setV(Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduce]);
  return v;
}

export type ResultsState =
  | { kind: 'preview'; result: AttemptResult }
  | { kind: 'verified'; result: AttemptResult; extras: SubmitResponse }
  | { kind: 'queued'; result: AttemptResult }
  | { kind: 'guest'; result: AttemptResult };

export function Results({
  state,
  texts,
  levelName,
  nextHref,
  onRetry,
}: {
  state: ResultsState;
  texts: GameTexts;
  levelName: string;
  nextHref: string | null;
  onRetry: () => void;
}) {
  const t = useTranslations('game.results');
  const tl = useTranslations('landing');
  const locale = useLocale();
  const r = state.result;
  const score = useCountUp(r.score);
  const survived = r.outcome === 'completed';
  const extras = state.kind === 'verified' ? state.extras : null;

  const describe = (f: AttemptResult['feedback'][number]) => {
    const group =
      f.ref === 'item'
        ? texts.items
        : f.ref === 'task'
          ? texts.tasks
          : f.ref === 'hazard'
            ? texts.hazards
            : f.ref === 'npc'
              ? texts.npcs
              : null;
    if (!group) return { name: t(`general.${f.key}` as 'general.timeout'), explanation: '' };
    const e = group[f.key];
    return { name: e?.name ?? f.key, explanation: e?.explanation ?? '' };
  };

  const sections = (['good', 'improve', 'danger'] as const).map((kind) => ({
    kind,
    items: r.feedback.filter((f) => f.kind === kind),
  }));

  const share = async () => {
    const text = t('shareText', { stars: r.stars, score: r.score, level: levelName });
    try {
      if (navigator.share) await navigator.share({ text, url: window.location.origin });
      else await navigator.clipboard.writeText(`${text} ${window.location.origin}`);
    } catch {
      // cancelled
    }
  };

  return (
    <div className="bg-background absolute inset-0 z-40 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
        <header
          className={cn(
            'rounded-2xl p-6 text-center text-white shadow-lg',
            survived ? 'bg-evac-green' : 'bg-storm-slate',
          )}
        >
          <p className="font-display text-lg font-semibold opacity-90">{levelName}</p>
          <h1 className="text-4xl font-bold">{survived ? t('survived') : t('failed')}</h1>
          {!survived && r.failReason && (
            <p className="mt-1 opacity-90">{t(`failReason.${r.failReason}`)}</p>
          )}
          <div
            className="mt-4 flex justify-center gap-2"
            aria-label={t('stars', { count: r.stars })}
            role="img"
          >
            {[0, 1, 2].map((i) => (
              <Star
                key={i}
                className={cn(
                  'size-12',
                  i < r.stars ? 'fill-signal-amber text-signal-amber drop-shadow' : 'text-white/40',
                )}
                aria-hidden
              />
            ))}
          </div>
          <p className="mt-3 text-sm opacity-80">{t('score')}</p>
          <p className="font-display text-6xl font-bold tabular-nums" aria-live="polite">
            {score}
          </p>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-sm">
            {state.kind === 'preview' && (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden /> {t('submitting')}
              </>
            )}
            {state.kind === 'verified' && !extras?.flagged && (
              <>
                <ShieldCheck className="size-4" aria-hidden /> {t('verified')}
              </>
            )}
            {state.kind === 'queued' && (
              <>
                <CloudOff className="size-4" aria-hidden /> {t('offlineQueued')}
              </>
            )}
          </p>
        </header>

        {extras?.flagged && (
          <p className="bg-signal-amber/15 border-signal-amber rounded-lg border-l-4 p-3 text-sm">
            {t('flagged')}
          </p>
        )}
        {state.kind === 'guest' && (
          <div className="bg-card flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">{t('guestUpsell')}</p>
            <Button
              asChild
              className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-11 font-bold"
            >
              <Link href="/sign-up">{tl('createAccount')}</Link>
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {nextHref && survived && (
            <Button
              asChild
              className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 flex-1 font-bold"
            >
              <Link href={nextHref}>
                {t('next')} <ArrowRight aria-hidden />
              </Link>
            </Button>
          )}
          <Button variant="outline" className="min-h-12 flex-1" onClick={onRetry}>
            <RotateCcw aria-hidden /> {t('retry')}
          </Button>
          <Button asChild variant="outline" className="min-h-12 flex-1">
            <Link href="/leaderboard">
              <Trophy aria-hidden /> {t('leaderboard')}
            </Link>
          </Button>
          <Button asChild variant="ghost" className="min-h-12">
            <Link href={state.kind === 'guest' ? '/' : '/home'}>
              <Home aria-hidden /> {t('home')}
            </Link>
          </Button>
          <Button variant="ghost" className="min-h-12" onClick={share}>
            <Share2 aria-hidden /> {t('share')}
          </Button>
        </div>

        {extras?.new_tips && extras.new_tips.length > 0 && (
          <section className="bg-card rounded-lg border p-5">
            <h2 className="mb-2 flex items-center gap-2 text-xl font-bold">
              <BookOpen className="text-evac-green size-5" aria-hidden /> {t('tipsUnlocked')}
            </h2>
            <ul className="divide-y">
              {extras.new_tips.map((tip) => (
                <li key={tip.id}>
                  <Link
                    href={`/tips/${tip.slug}`}
                    className="text-link flex min-h-11 items-center underline"
                  >
                    {locale === 'en' ? tip.title_en : tip.title_fil}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {sections.map(({ kind, items }) =>
          items.length ? (
            <section key={kind} className="bg-card rounded-lg border p-5">
              <h2 className="mb-3 flex items-center gap-2 text-xl font-bold">
                {kind === 'good' && <CheckCircle2 className="text-evac-green size-5" aria-hidden />}
                {kind === 'improve' && (
                  <TrendingUp className="text-signal-amber size-5" aria-hidden />
                )}
                {kind === 'danger' && (
                  <AlertTriangle className="text-signal-red size-5" aria-hidden />
                )}
                {t(kind)}
              </h2>
              <ul className="space-y-3">
                {items.map((f, i) => {
                  const d = describe(f);
                  return (
                    <li key={`${f.ref}-${f.key}-${i}`} className="flex gap-3">
                      <span
                        className={cn(
                          'mt-1.5 size-2.5 shrink-0 rounded-full',
                          kind === 'good'
                            ? 'bg-evac-green'
                            : kind === 'improve'
                              ? 'bg-signal-amber'
                              : 'bg-signal-red',
                        )}
                        aria-hidden
                      />
                      <div>
                        <p className="font-bold">
                          {kind === 'improve' && f.ref === 'item' && (f.points ?? 0) === 0
                            ? `${t('missingItem')}: `
                            : ''}
                          {kind === 'improve' && f.ref === 'task' ? `${t('skippedTask')}: ` : ''}
                          {kind === 'improve' && f.ref === 'npc' ? `${t('leftNpc')}: ` : ''}
                          {d.name}
                          {typeof f.points === 'number' && f.points !== 0 && (
                            <span
                              className={cn(
                                'ml-2 text-sm tabular-nums',
                                f.points > 0 ? 'text-evac-green' : 'text-signal-red',
                              )}
                            >
                              {f.points > 0 ? `+${f.points}` : f.points}
                            </span>
                          )}
                        </p>
                        {d.explanation && (
                          <p className="text-muted-foreground text-sm">{d.explanation}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null,
        )}

        <section className="bg-card rounded-lg border p-5">
          <h2 className="mb-3 text-xl font-bold">{t('breakdownTitle')}</h2>
          <dl className="divide-y text-sm">
            {Object.entries(r.breakdown).map(([k, v]) => (
              <div key={k} className="flex justify-between py-2">
                <dt>{t(`breakdown.${k}` as 'breakdown.essentials')}</dt>
                <dd
                  className={cn(
                    'font-bold tabular-nums',
                    v < 0 ? 'text-signal-red' : v > 0 ? 'text-evac-green' : '',
                  )}
                >
                  {v > 0 ? `+${v}` : v}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
