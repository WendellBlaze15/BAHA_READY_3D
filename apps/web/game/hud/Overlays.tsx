'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Clock, Info, Play, RotateCcw, Scale, Smartphone, Target, Volume2, X } from 'lucide-react';
import { StormSignalMeter } from '@/components/storm-signal-meter/storm-signal-meter';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { LevelConfig } from '@baha/shared/level-config';
import { audio } from '../systems/audio';

export function LoadingScreen({ stage, tips }: { stage: number; tips: string[] }) {
  const t = useTranslations('game');
  const [tip, setTip] = useState(0);
  useEffect(() => {
    if (tips.length < 2) return;
    const id = window.setInterval(() => setTip((i) => (i + 1) % tips.length), 4500);
    return () => window.clearInterval(id);
  }, [tips.length]);
  const labels = [t('loadingEngine'), t('loadingPhysics'), t('loadingWorld')];
  return (
    <div
      className="bg-storm-slate text-mist auth-rain absolute inset-0 z-40 flex items-center justify-center p-6"
      role="status"
      aria-live="polite"
    >
      <div className="relative z-10 w-full max-w-md space-y-6">
        <h1 className="text-3xl font-bold">{t('loadingTitle')}</h1>
        <StormSignalMeter
          value={Math.min(5, (stage / 3) * 5)}
          label={t('loadingTitle')}
          className="[&_span]:text-mist/70"
        />
        <p className="text-mist/80 text-sm">{labels[Math.min(stage, 2)]}…</p>
        {tips.length > 0 && (
          <p className="bg-mist/10 rounded-lg p-4 text-sm leading-relaxed">
            <span className="text-signal-amber font-bold">{t('tipLabel')}: </span>
            {tips[tip]}
          </p>
        )}
      </div>
    </div>
  );
}

export function Briefing({
  levelName,
  config,
  bestScore,
  guest,
  onStart,
  busy,
  error,
  signal,
}: {
  levelName: string;
  config: LevelConfig;
  bestScore: number | null;
  guest: boolean;
  onStart: () => void;
  busy: boolean;
  error?: string;
  signal: number;
}) {
  const t = useTranslations('game');
  const objectives = [
    t('objective1', { kg: config.weightLimitKg }),
    t('objective2'),
    t('objective3'),
    ...(config.npcs.length ? [t('objective4', { count: config.npcs.length })] : []),
    ...(config.requiredItems.includes('flashlight') ? [t('objectiveFlashlight')] : []),
  ];
  return (
    <div className="bg-storm-slate/80 short:p-2 absolute inset-0 z-30 flex items-center justify-center overflow-y-auto p-4 backdrop-blur-sm">
      {/* Phones in landscape: two columns so Start is visible without scrolling. */}
      <div className="bg-card text-card-foreground short:grid short:max-w-3xl short:grid-cols-2 short:items-center short:gap-x-5 short:space-y-0 short:p-4 my-auto w-full max-w-lg space-y-5 rounded-2xl p-6 text-center shadow-2xl sm:p-8">
        <div className="short:space-y-3 space-y-5">
          <p className="text-primary font-display short:text-sm font-semibold">
            {t('briefingEyebrow')}
          </p>
          <h1 className="short:text-2xl text-4xl font-bold">{levelName}</h1>
          <StormSignalMeter
            value={Math.max(0.2, signal)}
            label={levelName}
            className="mx-auto max-w-xs"
          />
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div className="bg-muted rounded-lg p-2">
              <dt className="text-muted-foreground flex items-center justify-center gap-1 text-xs">
                <Clock className="size-3" aria-hidden /> {t('prepTime')}
              </dt>
              <dd className="font-display short:text-base text-xl font-bold">
                {config.prepTimeSec ? `${config.prepTimeSec}s` : t('untimed')}
              </dd>
            </div>
            <div className="bg-muted rounded-lg p-2">
              <dt className="text-muted-foreground flex items-center justify-center gap-1 text-xs">
                <Clock className="size-3" aria-hidden /> {t('evacTime')}
              </dt>
              <dd className="font-display short:text-base text-xl font-bold">
                {config.evacTimeSec}s
              </dd>
            </div>
            <div className="bg-muted rounded-lg p-2">
              <dt className="text-muted-foreground flex items-center justify-center gap-1 text-xs">
                <Scale className="size-3" aria-hidden /> {t('weightLimit')}
              </dt>
              <dd className="font-display short:text-base text-xl font-bold">
                {config.weightLimitKg} kg
              </dd>
            </div>
          </dl>
        </div>
        <div className="short:space-y-2.5 space-y-5">
          <div className="text-left">
            <h2 className="short:mb-1 short:text-base mb-2 flex items-center gap-2 text-lg font-bold">
              <Target className="size-4" aria-hidden /> {t('objectivesTitle')}
            </h2>
            <ul className="short:space-y-1 short:text-xs space-y-1.5 text-sm">
              {objectives.map((o) => (
                <li key={o} className="flex gap-2">
                  <span
                    className="bg-signal-amber mt-1.5 size-2 shrink-0 rounded-full"
                    aria-hidden
                  />{' '}
                  {o}
                </li>
              ))}
            </ul>
          </div>
          {bestScore !== null && (
            <p className="text-muted-foreground text-sm">{t('bestScore', { score: bestScore })}</p>
          )}
          {guest && (
            <p className="bg-muted flex items-start gap-2 rounded-lg p-3 text-left text-xs">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('guestNotice')}
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <Button
            size="lg"
            onClick={onStart}
            disabled={busy}
            className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 short:min-h-11 short:text-base min-h-14 w-full text-lg font-bold"
          >
            <Play className="fill-current" aria-hidden /> {t('start')}
          </Button>
          <p className="text-muted-foreground hidden text-xs [@media(pointer:fine)]:block">
            {t('controlsDesktop')}
          </p>
          <p className="text-muted-foreground text-xs [@media(pointer:fine)]:hidden">
            {t('controlsMobile')}
          </p>
        </div>
      </div>
    </div>
  );
}

export function Countdown({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    if (n === 0) {
      onDone();
      return;
    }
    audio.blip('pack');
    const id = window.setTimeout(() => setN((x) => x - 1), 800);
    return () => window.clearTimeout(id);
  }, [n, onDone]);
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
      aria-live="assertive"
    >
      <span
        key={n}
        className="font-display text-signal-amber animate-in zoom-in-50 fade-in short:text-[88px] text-[120px] leading-none font-bold drop-shadow-2xl sm:text-[160px]"
      >
        {n || ''}
      </span>
    </div>
  );
}

export function PauseMenu({
  onResume,
  onRestart,
  onQuit,
  volume,
  onVolume,
}: {
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  volume: number;
  onVolume: (v: number) => void;
}) {
  const t = useTranslations('game');
  const [confirmQuit, setConfirmQuit] = useState(false);
  return (
    <div
      className="bg-storm-slate/85 absolute inset-0 z-40 flex items-center justify-center p-4 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-title"
    >
      <div className="bg-card text-card-foreground w-full max-w-sm space-y-4 rounded-2xl p-6 shadow-2xl">
        <h2 id="pause-title" className="text-3xl font-bold">
          {t('paused')}
        </h2>
        <Button
          autoFocus
          onClick={onResume}
          className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 w-full font-bold"
        >
          <Play aria-hidden /> {t('resume')}
        </Button>
        <Button variant="outline" onClick={onRestart} className="min-h-12 w-full">
          <RotateCcw aria-hidden /> {t('restart')}
        </Button>
        {confirmQuit ? (
          <div className="space-y-2">
            <p className="text-sm">{t('evacuateConfirm').split('?')[0]}?</p>
            <Button variant="destructive" onClick={onQuit} className="min-h-12 w-full">
              {t('quit')}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmQuit(true)} className="min-h-12 w-full">
            <X aria-hidden /> {t('quit')}
          </Button>
        )}
        <div className="flex items-center gap-3 pt-2">
          <Volume2 className="size-4 shrink-0" aria-hidden />
          <Slider
            value={[Math.round(volume * 100)]}
            min={0}
            max={100}
            step={5}
            onValueChange={([v]) => onVolume((v ?? 0) / 100)}
            aria-label="Volume"
          />
        </div>
        <div className="text-muted-foreground border-t pt-3 text-xs">
          <p className="mb-1 font-bold">{t('controlsTitle')}</p>
          <p className="hidden [@media(pointer:fine)]:block">{t('controlsDesktop')}</p>
          <p className="[@media(pointer:fine)]:hidden">{t('controlsMobile')}</p>
        </div>
      </div>
    </div>
  );
}

/** Phones in portrait get a non-blocking rotate prompt (landscape plays best). */
export function RotatePrompt() {
  const t = useTranslations('game');
  const [portrait, setPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Non-blocking: fades out on its own so it never hides the HUD for long.
  useEffect(() => {
    if (!portrait || dismissed) return;
    const id = window.setTimeout(() => setDismissed(true), 6000);
    return () => window.clearTimeout(id);
  }, [portrait, dismissed]);
  useEffect(() => {
    const mq = window.matchMedia(
      '(orientation: portrait) and (pointer: coarse) and (max-width: 700px)',
    );
    const f = () => setPortrait(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  if (!portrait || dismissed) return null;
  return (
    <button
      type="button"
      onClick={() => setDismissed(true)}
      className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+17rem)] z-20 flex items-center gap-2 rounded-lg bg-white/95 p-3 text-left text-sm font-bold text-slate-900 shadow-xl"
      role="status"
    >
      <Smartphone className="size-5 shrink-0 rotate-90" aria-hidden /> {t('rotate')}
    </button>
  );
}
