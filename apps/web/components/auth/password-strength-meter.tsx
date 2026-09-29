'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const COLORS = [
  'bg-signal-red',
  'bg-signal-red',
  'bg-signal-amber',
  'bg-evac-green',
  'bg-evac-green',
];

/** Live zxcvbn score (lazy-loaded so the dictionary never ships on other pages). */
export function usePasswordScore(password: string, inputs: string[] = []) {
  const [score, setScore] = useState<number | null>(null);
  const key = inputs.join('|');
  useEffect(() => {
    let cancelled = false;
    if (!password) {
      setScore(null);
      return;
    }
    const id = window.setTimeout(async () => {
      const { passwordScore } = await import('@/lib/auth/password-strength');
      if (!cancelled) setScore(passwordScore(password, key ? key.split('|') : []));
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [password, key]);
  return score;
}

export function PasswordStrengthMeter({ score, id }: { score: number | null; id?: string }) {
  const t = useTranslations('auth');
  if (score === null) return null;
  const label = t(`strength${score}` as 'strength0');
  return (
    <div id={id} className="space-y-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-sm',
              i < Math.max(1, score) ? COLORS[score] : 'bg-muted',
            )}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-xs">{t('strength', { label })}</p>
    </div>
  );
}
