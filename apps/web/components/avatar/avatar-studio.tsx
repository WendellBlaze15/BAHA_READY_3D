'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Lock, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { presetAvatarConfig } from '@/lib/avatar/presets';
import { useMyAchievements, useProfile, useUpdateProfile } from '@/lib/data/me';
import { useAchievementDefs } from '@/lib/data/content';
import { Skeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Json } from '@/lib/supabase/database.types';

const Preview = dynamic(() => import('./avatar-preview-3d'), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-2xl" />,
});

const SKINS = ['#F1C27D', '#E0AC69', '#C68B59', '#A86B3C', '#8D5524', '#6B3E26'];
const HAIRS = ['#1B1B1B', '#3B2314', '#6B4423', '#A0522D', '#D9D9D9', '#C0392B'];
const CLOTHES = [
  '#2F6F7E',
  '#D2402F',
  '#F2A516',
  '#2E8B57',
  '#3F8FD2',
  '#8E44AD',
  '#FFFFFF',
  '#1E2A38',
  '#E0672A',
];
const PANTS = ['#1E2A38', '#1F3A93', '#5D4037', '#6B5B45', '#34495E', '#7F8C8D'];
const SHOES = ['#F2EFEA', '#111111', '#8A6B4A', '#D2402F', '#3E3E3E'];
const STYLES = ['short', 'long', 'cap', 'bun', 'buzz'] as const;
const FACES = ['smile', 'grin', 'calm', 'determined'] as const;
// Free items vs. items earned from achievements (reward_items like "hat_cap_blue").
const HATS = ['cap_red', 'helmet_yellow', 'salakot', 'cap_blue', 'grad_cap'] as const;
const ACCESSORIES = [
  'backpack_blue',
  'vest_reflective',
  'apron',
  'backpack_orange',
  'badge_flame',
  'headlamp',
] as const;
const FREE = new Set([
  'cap_red',
  'helmet_yellow',
  'salakot',
  'backpack_blue',
  'vest_reflective',
  'apron',
]);

export function AvatarStudio() {
  const t = useTranslations('avatar');
  const { data: profile } = useProfile();
  const achievements = useMyAchievements();
  const defs = useAchievementDefs();
  const update = useUpdateProfile();
  const [cfg, setCfg] = useState<AvatarConfig | null>(null);

  useEffect(() => {
    if (profile && !cfg)
      setCfg({
        ...presetAvatarConfig('lakeside'),
        ...((profile.avatar_config ?? {}) as Partial<AvatarConfig>),
      });
  }, [profile, cfg]);

  const unlocked = useMemo(() => {
    const earned = new Set((achievements.data ?? []).map((a) => a.achievement_id));
    const items = new Set<string>(FREE);
    for (const d of defs.data ?? []) {
      if (!earned.has(d.id)) continue;
      for (const r of d.reward_items) items.add(r.replace(/^(hat|acc|shirt)_/, ''));
    }
    return items;
  }, [achievements.data, defs.data]);

  if (!cfg) {
    return (
      <div className="grid gap-6 md:grid-cols-[340px_1fr]">
        <Skeleton className="aspect-[3/4] w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }
  const set = <K extends keyof AvatarConfig>(k: K, v: AvatarConfig[K]) =>
    setCfg((c) => (c ? { ...c, [k]: v } : c));

  return (
    <div className="grid gap-6 md:grid-cols-[340px_1fr]">
      <div className="space-y-3 md:sticky md:top-20 md:self-start">
        <div className="bg-storm-slate aspect-[3/4] w-full overflow-hidden rounded-2xl">
          <Preview config={cfg} />
        </div>
        <p className="text-muted-foreground text-center text-xs">{t('rotate')}</p>
        <Button
          className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 w-full font-bold"
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              { avatar_config: cfg as unknown as Json, avatar_key: 'custom' },
              { onSuccess: () => toast.success(t('saved')) },
            )
          }
        >
          {update.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Save aria-hidden />
          )}{' '}
          {t('save')}
        </Button>
      </div>

      <div className="space-y-5">
        <Swatches
          label={t('skin')}
          colors={SKINS}
          value={cfg.skin}
          onChange={(v) => set('skin', v)}
        />
        <Swatches
          label={t('hair')}
          colors={HAIRS}
          value={cfg.hair}
          onChange={(v) => set('hair', v)}
        />
        <Chips
          label={t('hairStyle')}
          options={STYLES.map((s) => ({ value: s, label: t(`styles.${s}`) }))}
          value={cfg.hairStyle}
          onChange={(v) => set('hairStyle', v as AvatarConfig['hairStyle'])}
        />
        <Chips
          label={t('face')}
          options={FACES.map((f) => ({ value: f, label: t(`faces.${f}`) }))}
          value={cfg.face}
          onChange={(v) => set('face', v as AvatarConfig['face'])}
        />
        <Swatches
          label={t('shirt')}
          colors={CLOTHES}
          value={cfg.shirt}
          onChange={(v) => set('shirt', v)}
        />
        <Swatches
          label={t('pants')}
          colors={PANTS}
          value={cfg.pants}
          onChange={(v) => set('pants', v)}
        />
        <Swatches
          label={t('shoes')}
          colors={SHOES}
          value={cfg.shoes}
          onChange={(v) => set('shoes', v)}
        />
        <Chips
          label={t('hat')}
          options={[
            { value: '', label: t('none') },
            ...HATS.map((h) => ({ value: h, label: t(`hats.${h}`), locked: !unlocked.has(h) })),
          ]}
          value={cfg.hat ?? ''}
          onChange={(v) => set('hat', v || null)}
          lockedLabel={t('lockedItem')}
        />
        <Chips
          label={t('accessory')}
          options={[
            { value: '', label: t('none') },
            ...ACCESSORIES.map((a) => ({
              value: a,
              label: t(`accessories.${a}`),
              locked: !unlocked.has(a),
            })),
          ]}
          value={cfg.accessory ?? ''}
          onChange={(v) => set('accessory', v || null)}
          lockedLabel={t('lockedItem')}
        />
      </div>
    </div>
  );
}

function Swatches({
  label,
  colors,
  value,
  onChange,
}: {
  label: string;
  colors: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-bold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`${label} ${c}`}
            aria-pressed={value.toLowerCase() === c.toLowerCase()}
            className={cn(
              'flex size-11 items-center justify-center rounded-lg border-2',
              value.toLowerCase() === c.toLowerCase() ? 'border-primary' : 'border-border',
            )}
            style={{ background: c }}
          >
            {value.toLowerCase() === c.toLowerCase() && (
              <Check className="size-5 text-white mix-blend-difference" aria-hidden />
            )}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Chips({
  label,
  options,
  value,
  onChange,
  lockedLabel,
}: {
  label: string;
  options: { value: string; label: string; locked?: boolean }[];
  value: string;
  onChange: (v: string) => void;
  lockedLabel?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-bold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value || 'none'}
            type="button"
            disabled={o.locked}
            title={o.locked ? lockedLabel : undefined}
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cn(
              'flex min-h-11 items-center gap-1.5 rounded-lg border-2 px-3 text-sm font-bold',
              value === o.value ? 'border-primary bg-accent' : 'border-border bg-card',
              o.locked && 'cursor-not-allowed opacity-50',
            )}
          >
            {o.locked && <Lock className="size-3.5" aria-label={lockedLabel} />} {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
