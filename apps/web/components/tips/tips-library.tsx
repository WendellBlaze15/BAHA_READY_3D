'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useTips, type TipRow } from '@/lib/data/content';
import { parseUnlockRule, TIP_CATEGORIES } from '@/lib/tips';
import { cn } from '@/lib/utils';

type Unlocked = { tip_id: string; read_at: string | null }[] | null;

export function TipsLibrary({
  initialTips,
  unlocked,
}: {
  initialTips: TipRow[];
  unlocked: Unlocked;
}) {
  const t = useTranslations('tipsPage');
  const locale = useLocale();
  const { data: tips = initialTips } = useTips(initialTips);
  const [cat, setCat] = useState<string>('all');
  const unlockedMap = useMemo(
    () => new Map((unlocked ?? []).map((u) => [u.tip_id, u])),
    [unlocked],
  );
  const signedIn = unlocked !== null;
  const shown = tips.filter((tip) => cat === 'all' || tip.category === cat);

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label={t('title')} className="flex gap-2 overflow-x-auto pb-1">
        {['all', ...TIP_CATEGORIES].map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={cat === c}
            onClick={() => setCat(c)}
            className={cn(
              'min-h-11 shrink-0 rounded-sm border px-3 text-sm font-bold',
              cat === c ? 'bg-storm-slate text-mist border-storm-slate' : 'bg-card hover:bg-muted',
            )}
          >
            {c === 'all' ? t('all') : t(`categories.${c}` as 'categories.before')}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((tip) => {
            const rule = parseUnlockRule(tip.unlock_rule);
            const mine = unlockedMap.get(tip.id);
            // Guests can read everything; signed-in players see personalized unlocks.
            const locked = signedIn && rule.type !== 'always' && !mine;
            const title = locale === 'en' ? tip.title_en : tip.title_fil;
            const body = locale === 'en' ? tip.body_en : tip.body_fil;
            if (locked) {
              return (
                <li key={tip.id} className="bg-card relative overflow-hidden rounded-lg border p-4">
                  <div aria-hidden className="pointer-events-none blur-sm select-none">
                    <p className="font-bold">{title}</p>
                    <p className="text-muted-foreground line-clamp-2 text-sm">{body}</p>
                  </div>
                  <div className="bg-card/70 absolute inset-0 flex items-center gap-3 p-4">
                    <Lock className="text-muted-foreground size-5 shrink-0" aria-hidden />
                    <div>
                      <p className="font-bold">{t('locked')}</p>
                      <p className="text-muted-foreground text-sm">
                        {rule.type === 'level_complete'
                          ? t('lockedHintLevel', { level: rule.level })
                          : t('lockedHintMistake')}
                      </p>
                    </div>
                  </div>
                </li>
              );
            }
            return (
              <li key={tip.id}>
                <Link
                  href={`/tips/${tip.slug}`}
                  className="bg-card hover:border-primary block h-full rounded-lg border p-4"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground text-xs font-bold">
                      {t(`categories.${tip.category}` as 'categories.before')}
                    </span>
                    {mine && !mine.read_at && (
                      <span className="bg-evac-green rounded-sm px-1.5 text-xs font-bold text-white">
                        {t('new')}
                      </span>
                    )}
                  </div>
                  <p className="font-bold">{title}</p>
                  <p className="text-muted-foreground line-clamp-2 text-sm">{body}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
