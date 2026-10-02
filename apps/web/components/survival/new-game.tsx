'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { User, Users } from 'lucide-react';
import { DIFFICULTIES, type Difficulty } from '@baha/shared/survival';
import { useRouter } from '@/i18n/navigation';
import { createRoom, errorKey } from '@/lib/survival/client';
import { useSession } from '@/game/survival/session-store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function NewGame() {
  const t = useTranslations('survival');
  const router = useRouter();
  const [mode, setMode] = useState<'solo' | 'coop'>('coop');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom(mode, difficulty);
      useSession.getState().reset();
      useSession.getState().set({ room, roomId: room.roomId, status: 'connected' });
      router.push(`/survival/room/${room.roomId}`);
    } catch (e) {
      setError(errorKey(e));
      setBusy(false);
    }
  };

  const choice = (active: boolean) =>
    cn(
      'bg-card flex min-w-0 flex-col items-start gap-1 rounded-xl border-2 p-4 text-left transition-colors',
      active ? 'border-primary ring-primary/30 ring-2' : 'hover:border-foreground/30',
    );

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <h1 className="text-3xl font-bold">{t('new.title')}</h1>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold">{t('new.mode')}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['solo', 'coop'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              className={choice(mode === m)}
              onClick={() => setMode(m)}
            >
              <span className="flex items-center gap-2 text-lg font-semibold">
                {m === 'solo' ? <User aria-hidden /> : <Users aria-hidden />} {t(`mode.${m}`)}
              </span>
              <span className="text-muted-foreground text-sm">{t(`modeHint.${m}`)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold">{t('new.difficulty')}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={difficulty === d}
              className={choice(difficulty === d)}
              onClick={() => setDifficulty(d)}
            >
              <span className="text-lg font-semibold">{t(`difficulty.${d}`)}</span>
              <span className="text-muted-foreground text-sm">{t(`difficultyHint.${d}`)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-destructive font-medium">
          {t(`errors.${error}` as 'errors.generic')}
        </p>
      )}
      <Button size="lg" className="h-14 w-full text-base sm:w-auto" onClick={start} disabled={busy}>
        {busy ? t('new.creating') : t('new.start')}
      </Button>
    </div>
  );
}
