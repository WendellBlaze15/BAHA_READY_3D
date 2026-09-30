'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { CloudLightning, Lock, Moon, Play, Star, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { LevelConfig } from '@baha/shared/level-config';
import { Link } from '@/i18n/navigation';
import { useProgress } from '@/lib/data/me';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { SkeletonLevelMarker } from '@/components/skeletons';
import { cn } from '@/lib/utils';

export type MapLevel = {
  id: number;
  slug: string;
  name_fil: string;
  name_en: string;
  config: LevelConfig;
};

const SIGNAL_BG = [
  'bg-lake',
  'bg-signal-1',
  'bg-signal-2',
  'bg-signal-3',
  'bg-signal-4',
  'bg-signal-5',
];

export function StormMap({
  levels,
  hazardNames,
}: {
  levels: MapLevel[];
  hazardNames: Record<string, string>;
}) {
  const t = useTranslations('levels');
  const locale = useLocale();
  const params = useSearchParams();
  const { data: progress, isPending } = useProgress();
  const [open, setOpen] = useState<MapLevel | null>(null);
  const [desktop, setDesktop] = useState(false);
  const byId = new Map((progress ?? []).map((p) => [p.level_id, p]));

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const f = () => setDesktop(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);

  useEffect(() => {
    if (params.get('locked') === '1') toast.error(t('lockedToast'));
    const pre = params.get('level');
    if (pre) setOpen(levels.find((l) => l.slug === pre) ?? null);
  }, [params, levels, t]);

  const name = (l: MapLevel) => (locale === 'en' ? l.name_en : l.name_fil);

  return (
    <>
      <ol className="relative mx-auto max-w-xl space-y-4 py-2">
        {/* the road */}
        <span
          aria-hidden
          className="bg-muted absolute top-6 bottom-6 left-1/2 w-3 -translate-x-1/2 rounded-full"
        />
        <span
          aria-hidden
          className="absolute top-6 bottom-6 left-1/2 w-0 -translate-x-1/2 border-l-2 border-dashed border-white/70"
        />
        {levels.map((l, i) => {
          if (isPending) {
            return (
              <li key={l.id} className={cn('relative w-[78%] sm:w-[62%]', i % 2 ? 'ml-auto' : '')}>
                <SkeletonLevelMarker />
              </li>
            );
          }
          const p = byId.get(l.id);
          const unlocked = l.id <= 1 || !!p?.unlocked;
          const stars = p?.best_stars ?? 0;
          return (
            <li key={l.id} className={cn('relative w-[78%] sm:w-[62%]', i % 2 ? 'ml-auto' : '')}>
              <button
                onClick={() => (unlocked ? setOpen(l) : toast.error(t('lockedHint')))}
                aria-disabled={!unlocked}
                className={cn(
                  'bg-card flex min-h-28 w-full items-center gap-4 rounded-2xl border-2 p-4 text-left shadow-sm transition-transform hover:-translate-y-0.5',
                  unlocked ? 'hover:border-primary border-transparent' : 'opacity-70',
                )}
              >
                <span
                  className={cn(
                    'font-display flex size-14 shrink-0 items-center justify-center rounded-xl text-2xl font-bold text-white shadow',
                    unlocked ? SIGNAL_BG[l.config.signal] : 'bg-muted-foreground',
                  )}
                >
                  {unlocked ? (
                    l.config.signal === 0 ? (
                      'T'
                    ) : (
                      l.config.signal
                    )
                  ) : (
                    <Lock className="size-6" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold">{name(l)}</span>
                  <span className="mt-1 flex items-center gap-0.5" aria-label={`${stars}/3`}>
                    {[0, 1, 2].map((s) => (
                      <Star
                        key={s}
                        aria-hidden
                        className={cn(
                          'size-4',
                          s < stars
                            ? 'fill-signal-amber text-signal-amber'
                            : 'text-muted-foreground/40',
                        )}
                      />
                    ))}
                  </span>
                  <span className="text-muted-foreground block text-sm">
                    {!unlocked
                      ? t('locked')
                      : p?.best_score
                        ? t('best', { score: p.best_score })
                        : t('notPlayed')}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent
          side={desktop ? 'right' : 'bottom'}
          className={cn('overflow-y-auto', desktop ? 'w-[420px]' : 'max-h-[85dvh] rounded-t-2xl')}
        >
          {open && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0">
                <p className="text-primary font-display font-semibold">{t('briefing')}</p>
                <SheetTitle className="text-3xl">{name(open)}</SheetTitle>
                <SheetDescription>
                  {t('attempts', { count: byId.get(open.id)?.attempts_count ?? 0 })}
                </SheetDescription>
              </SheetHeader>
              <dl className="grid grid-cols-3 gap-2 text-center text-sm">
                <Stat
                  label={t('prep')}
                  value={open.config.prepTimeSec ? `${open.config.prepTimeSec}s` : '∞'}
                />
                <Stat label={t('evac')} value={`${open.config.evacTimeSec}s`} />
                <Stat label={t('limit')} value={`${open.config.weightLimitKg} kg`} />
              </dl>
              <div className="space-y-2 text-sm">
                <p className="font-bold">{t('hazards')}</p>
                <p className="text-muted-foreground">
                  {open.config.hazards.length
                    ? open.config.hazards
                        .map((h) => `${hazardNames[h.key] ?? h.key} ×${h.count}`)
                        .join(' · ')
                    : t('none')}
                </p>
                <p className="flex items-center gap-2 font-bold">
                  <Users className="size-4" aria-hidden /> {t('neighbors')}:{' '}
                  {open.config.npcs.length}
                </p>
                {open.config.night && (
                  <p className="flex items-center gap-2">
                    <Moon className="size-4" aria-hidden /> {t('night')}
                  </p>
                )}
                {open.config.lightning && (
                  <p className="flex items-center gap-2">
                    <CloudLightning className="size-4" aria-hidden /> {t('lightning')}
                  </p>
                )}
              </div>
              <Button
                asChild
                size="lg"
                className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-14 w-full text-lg font-bold"
              >
                <Link href={`/play/${open.slug}`}>
                  <Play className="fill-current" aria-hidden /> {t('startLevel')}
                </Link>
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted rounded-lg p-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-display text-xl font-bold">{value}</dd>
    </div>
  );
}
