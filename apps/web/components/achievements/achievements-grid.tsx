'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import {
  Award,
  Backpack,
  Flame,
  Flashlight,
  Footprints,
  GraduationCap,
  HeartHandshake,
  Lock,
  ShieldCheck,
  Shirt,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMyAchievements } from '@/lib/data/me';
import { useAchievementDefs } from '@/lib/data/content';
import { SkeletonCard } from '@/components/skeletons';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  footprints: Footprints,
  backpack: Backpack,
  'heart-handshake': HeartHandshake,
  'shield-check': ShieldCheck,
  flame: Flame,
  'graduation-cap': GraduationCap,
  flashlight: Flashlight,
};

export function AchievementsGrid() {
  const t = useTranslations('achievementsPage');
  const format = useFormatter();
  const locale = useLocale();
  const defs = useAchievementDefs();
  const mine = useMyAchievements();
  const earned = new Map((mine.data ?? []).map((a) => [a.achievement_id, a.unlocked_at]));

  if (defs.isPending || mine.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} className="h-28" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground font-bold">
        {t('progress', { earned: earned.size, total: defs.data?.length ?? 0 })}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {(defs.data ?? []).map((a) => {
          const at = earned.get(a.id);
          const Icon = ICONS[a.icon_key] ?? Award;
          return (
            <li
              key={a.id}
              className={cn('bg-card flex gap-4 rounded-lg border p-4', !at && 'opacity-75')}
            >
              <span
                className={cn(
                  'flex size-14 shrink-0 items-center justify-center rounded-xl',
                  at ? 'bg-signal-amber text-storm-slate' : 'bg-muted text-muted-foreground',
                )}
              >
                {at ? (
                  <Icon className="size-7" aria-hidden />
                ) : (
                  <Lock className="size-6" aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <p className="font-bold">{locale === 'en' ? a.name_en : a.name_fil}</p>
                <p className="text-muted-foreground text-sm">
                  {locale === 'en' ? a.description_en : a.description_fil}
                </p>
                <p className="mt-1 text-xs font-bold">
                  {at
                    ? t('earned', { date: format.dateTime(new Date(at), { dateStyle: 'medium' }) })
                    : t('locked')}
                </p>
                {a.reward_items.length > 0 && (
                  <p className="text-primary mt-0.5 flex items-center gap-1 text-xs">
                    <Shirt className="size-3" aria-hidden /> {t('reward')}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
