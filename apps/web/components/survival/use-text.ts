'use client';

import { useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { QUICK_CHAT, RADIO_TIPS, lessonFor } from '@baha/shared/survival';
import { useSurvivalConfig } from '@/lib/data/survival';
import { useRoomState } from '@/game/survival/session-store';

type Params = Record<string, string | number> | undefined;

/**
 * Resolves the session's message keys to text in the viewer's language: survival.* i18n keys,
 * `lesson:<key>` (Mga Natutunan catalog), `toast:<key>`, radio tips, item names and loot lists.
 */
export function useSurvivalText() {
  const t = useTranslations('survival');
  const locale: 'en' | 'fil' = useLocale() === 'en' ? 'en' : 'fil';
  const version = useRoomState((s) => s.configVersion as number, 1);
  const cfg = useSurvivalConfig(version);

  const item = useCallback(
    (key: string) => cfg.items.find((i) => i.key === key)?.name[locale] ?? key.replace(/_/g, ' '),
    [cfg, locale],
  );
  const recipe = useCallback(
    (key: string) => cfg.recipes.find((r) => r.key === key)?.name[locale] ?? item(key),
    [cfg, locale, item],
  );

  const text = useCallback(
    (key: string, params?: Params): string => {
      if (key.startsWith('lesson:')) {
        const l = lessonFor(key.slice(7));
        return l ? l[locale] : '';
      }
      if (key === 'loot') {
        const items = JSON.parse(String(params?.items ?? '[]')) as { item: string; qty: number }[];
        if (!items.length) return t('toastMsg.nothingFound');
        return t('toastMsg.loot', {
          items: items.map((i) => `${i.qty}× ${item(i.item)}`).join(', '),
        });
      }
      if (key.startsWith('toast:')) {
        const k = key.slice(6);
        const p = params?.item ? { item: item(String(params.item)) } : {};
        return t.has(`toastMsg.${k}`) ? t(`toastMsg.${k}` as 'toastMsg.loot', p as never) : '';
      }
      if (key === 'event.radio') {
        const tip = RADIO_TIPS[Number(params?.tip ?? 0)];
        return `📻 ${tip ? tip[locale] : ''}`;
      }
      if (key === 'event.built' && params?.structure) {
        const s = cfg.recipes.find((r) => r.structure === params.structure);
        return t('event.built', {
          ...params,
          structure: s ? s.name[locale] : String(params.structure),
        } as never);
      }
      if (!t.has(key)) return '';
      return t(key as 'title', params as never);
    },
    [t, locale, item, cfg],
  );

  const quick = useCallback((id: number) => QUICK_CHAT[id]?.[locale] ?? '', [locale]);

  return { text, item, recipe, quick, cfg, locale };
}
