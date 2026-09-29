'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Loader2, Pencil, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import {
  useMyAchievements,
  useMyAttempts,
  useProfile,
  useProgress,
  useUpdateProfile,
} from '@/lib/data/me';
import { useLevels } from '@/lib/data/content';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { BlockyAvatar } from '@/components/avatar/blocky-avatar';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { useApiErrorText } from '@/components/auth/use-api-error';
import { Skeleton, SkeletonStat } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function ProfilePage() {
  const t = useTranslations('profilePage');
  const format = useFormatter();
  const locale = useLocale();
  const errText = useApiErrorText();
  const { data: profile } = useProfile();
  const progress = useProgress();
  const attempts = useMyAttempts(20);
  const achievements = useMyAchievements();
  const levels = useLevels();
  const update = useUpdateProfile();
  const [form, setForm] = useState({ display_name: '', barangay: '', school: '' });

  useEffect(() => {
    if (profile) {
      setForm({
        display_name: profile.display_name ?? '',
        barangay: profile.barangay ?? '',
        school: profile.school ?? '',
      });
    }
  }, [profile]);

  const stars = (progress.data ?? []).reduce((s, p) => s + p.best_stars, 0);
  const levelsDone = (progress.data ?? []).filter((p) => p.level_id > 0 && p.best_stars > 0).length;
  const totalAttempts = (progress.data ?? []).reduce((s, p) => s + p.attempts_count, 0);
  const levelName = (id: number) => {
    const l = levels.data?.find((x) => x.id === id);
    return l ? (locale === 'en' ? l.name_en : l.name_fil) : `#${id}`;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <section className="bg-card flex flex-col gap-5 rounded-lg border p-5 sm:flex-row sm:items-center">
        <div className="flex flex-col items-center gap-2">
          {profile ? (
            <BlockyAvatar
              config={profile.avatar_config as Partial<AvatarConfig>}
              size={80}
              title={profile.username as string}
            />
          ) : (
            <Skeleton className="h-[120px] w-20" />
          )}
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href="/avatar">
              <Pencil aria-hidden /> {t('editAvatar')}
            </Link>
          </Button>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold break-words">
            {profile ? `@${profile.username}` : <Skeleton className="h-9 w-48" />}
          </h1>
          {profile && (
            <p className="text-muted-foreground text-sm">
              {t('memberSince', {
                date: format.dateTime(new Date(profile.created_at), { dateStyle: 'medium' }),
              })}
            </p>
          )}
          <form
            className="mt-4 grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate(
                {
                  display_name: form.display_name.trim() || null,
                  barangay: form.barangay.trim() || null,
                  school: form.school.trim() || null,
                },
                {
                  onSuccess: () => toast.success(t('save')),
                  onError: (err) => toast.error(errText(err)),
                },
              );
            }}
          >
            <Field
              id="dn"
              label={t('displayName')}
              value={form.display_name}
              max={40}
              onChange={(v) => setForm((f) => ({ ...f, display_name: v }))}
            />
            <Field
              id="brgy"
              label={t('barangay')}
              value={form.barangay}
              max={80}
              onChange={(v) => setForm((f) => ({ ...f, barangay: v }))}
            />
            <Field
              id="school"
              label={t('school')}
              value={form.school}
              max={120}
              onChange={(v) => setForm((f) => ({ ...f, school: v }))}
            />
            <div className="sm:col-span-3">
              <Button type="submit" className="min-h-11" disabled={update.isPending || !profile}>
                {update.isPending && <Loader2 className="animate-spin" aria-hidden />} {t('save')}
              </Button>
            </div>
          </form>
        </div>
      </section>

      <section aria-labelledby="stats-title">
        <h2 id="stats-title" className="mb-3 text-xl font-bold">
          {t('statsTitle')}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {progress.isPending || achievements.isPending ? (
            Array.from({ length: 4 }, (_, i) => <SkeletonStat key={i} />)
          ) : (
            <>
              <StatBox label={t('statLevels')} value={levelsDone} />
              <StatBox label={t('statStars')} value={stars} />
              <StatBox label={t('statAttempts')} value={totalAttempts} />
              <StatBox label={t('statBadges')} value={achievements.data?.length ?? 0} />
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="history-title" className="bg-card rounded-lg border">
        <h2 id="history-title" className="border-b p-4 text-xl font-bold">
          {t('historyTitle')}
        </h2>
        {attempts.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !attempts.data?.length ? (
          <p className="text-muted-foreground p-4">{t('historyEmpty')}</p>
        ) : (
          <ul className="divide-y">
            {attempts.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4">
                <span className="font-bold">{levelName(a.level_id)}</span>
                <span
                  className={cn(
                    'rounded-sm px-2 text-xs font-bold',
                    a.status === 'completed' ? 'bg-evac-green text-white' : 'bg-muted',
                  )}
                >
                  {t(`status.${a.status}` as 'status.completed')}
                </span>
                {a.flag_reasons.length > 0 && (
                  <span className="bg-signal-amber text-storm-slate rounded-sm px-2 text-xs font-bold">
                    {t('flagged')}
                  </span>
                )}
                <span className="flex items-center gap-0.5" aria-label={`${a.stars ?? 0} / 3`}>
                  {[0, 1, 2].map((i) => (
                    <Star
                      key={i}
                      aria-hidden
                      className={cn(
                        'size-4',
                        i < (a.stars ?? 0)
                          ? 'fill-signal-amber text-signal-amber'
                          : 'text-muted-foreground',
                      )}
                    />
                  ))}
                </span>
                <span className="font-display ml-auto text-lg font-bold tabular-nums">
                  {a.score ?? '—'}
                </span>
                <time
                  className="text-muted-foreground w-full text-xs sm:w-auto"
                  dateTime={a.started_at}
                >
                  {format.dateTime(new Date(a.started_at), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-card space-y-3 rounded-lg border p-5">
        <h2 className="text-xl font-bold">{t('devicesTitle')}</h2>
        <p className="text-muted-foreground text-sm">{t('devicesBody')}</p>
        <SignOutButton scope="others" />
      </section>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        className="h-11"
      />
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="font-display text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
