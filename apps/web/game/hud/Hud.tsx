'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Backpack,
  CheckCircle2,
  Circle,
  Hand,
  Heart,
  Navigation,
  Pause,
  ArrowUpFromLine,
  Footprints,
  Radio,
  Users,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { bagWeight, live, useGame } from '../store/game-store';
import { useNearby } from '../systems/interactions';
import { inputActions } from '../systems/input';
import { Joystick } from './Joystick';

const fmt = (s: number) => {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

function useIsTouch() {
  const [touch, setTouch] = useState(false);
  useEffect(() => setTouch(window.matchMedia('(pointer: coarse)').matches), []);
  return touch;
}

function Timer() {
  const t = useTranslations('game');
  const phase = useGame((s) => s.phase);
  const time = useGame((s) => s.timeUi);
  const prepEnds = useGame((s) => s.prepEndsAt);
  const evacEnds = useGame((s) => s.evacEndsAt);
  const end = phase === 'prep' ? prepEnds : evacEnds;
  const left = end === null ? null : end - time;
  const urgent = left !== null && left <= 30;
  // Screen-reader announcements only at 30s and 10s.
  const [announce, setAnnounce] = useState('');
  const said = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (left === null) return;
    for (const mark of [30, 10]) {
      if (left <= mark && !said.current.has(mark)) {
        said.current.add(mark);
        setAnnounce(`${t('timeLeft')}: ${mark}s`);
      }
    }
  }, [left, t]);
  useEffect(() => said.current.clear(), [phase]);

  return (
    <div
      className={cn(
        'rounded-lg px-3 py-1.5 text-white shadow-lg',
        urgent ? 'bg-signal-red' : 'bg-storm-slate/85',
      )}
    >
      <p className="text-[11px] font-bold opacity-80">
        {phase === 'prep' ? t('phasePrep') : t('phaseEvac')}
      </p>
      <p className="font-display text-3xl leading-none font-bold tabular-nums">
        {left === null ? '∞' : fmt(left)}
      </p>
      <span className="sr-only" aria-live="assertive">
        {announce}
      </span>
    </div>
  );
}

const STRIPES =
  'repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 6px, rgba(255,255,255,.25) 6px 12px)';

function Bar({
  label,
  value,
  color,
  icon,
  striped = false,
  highlight = false,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
  /** Locked state (e.g. Hingal): grey diagonal stripes. */
  striped?: boolean;
  /** Brief flash, e.g. when sprint becomes available again. */
  highlight?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <span className="text-white">{icon}</span>
      <div
        className={cn(
          'h-2.5 w-28 overflow-hidden rounded-full bg-black/40 transition-shadow sm:w-36',
          highlight && 'ring-evac-green ring-2',
        )}
      >
        <div
          className={cn('h-full origin-left rounded-full', color)}
          style={{
            transform: `scaleX(${value / 100})`,
            transition: 'transform 200ms',
            ...(striped ? { backgroundImage: STRIPES } : {}),
          }}
        />
      </div>
    </div>
  );
}

function Vitals({ evac }: { evac: boolean }) {
  const t = useTranslations('game');
  const health = useGame((s) => s.healthUi);
  const stamina = useGame((s) => s.staminaUi);
  const sprint = useGame((s) => s.sprintUi);
  const depth = useGame((s) => s.depthUi);
  const followers = useGame((s) => s.followers.length);
  // Flash briefly when the Hingal lockout ends so players know sprint is available again.
  const [ready, setReady] = useState(false);
  const prev = useRef(sprint);
  useEffect(() => {
    const wasLocked = prev.current === 'exhausted';
    prev.current = sprint;
    if (!wasLocked || sprint === 'exhausted') return;
    setReady(true);
    const id = window.setTimeout(() => setReady(false), 900);
    return () => window.clearTimeout(id);
  }, [sprint]);
  return (
    <div className="bg-storm-slate/85 space-y-1.5 rounded-lg px-3 py-2 shadow-lg">
      {evac && (
        <Bar
          label={t('health')}
          value={health}
          color={health < 30 ? 'bg-signal-red' : 'bg-evac-green'}
          icon={<Heart className="size-4" aria-hidden />}
        />
      )}
      <div className="flex items-center gap-2">
        <Bar
          label={t('stamina')}
          value={stamina}
          color={
            sprint === 'exhausted'
              ? 'bg-slate-400'
              : sprint === 'sprinting'
                ? 'bg-signal-amber motion-safe:animate-pulse'
                : 'bg-signal-amber'
          }
          striped={sprint === 'exhausted'}
          highlight={ready}
          icon={<Zap className="size-4" aria-hidden />}
        />
        {sprint === 'exhausted' && (
          <span
            role="status"
            className="flex items-center gap-1 rounded bg-slate-600/95 px-1.5 py-0.5 text-[11px] font-bold text-white"
          >
            <Wind className="size-3" aria-hidden /> {t('exhausted')}
          </span>
        )}
        {ready && (
          <span
            role="status"
            className="bg-evac-green/95 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold text-white motion-safe:animate-pulse"
          >
            <Footprints className="size-3" aria-hidden /> {t('sprintReady')}
          </span>
        )}
      </div>
      {!evac ? null : (
        <>
          <p
            className={cn(
              'flex items-center gap-1.5 text-xs font-bold',
              depth === 'chest' ? 'text-red-300' : 'text-white/90',
            )}
          >
            <Waves className="size-4" aria-hidden /> {t(`depth.${depth}`)}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-white/90">
            <Users className="size-4" aria-hidden /> {t('followers', { count: followers })}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Touch action cluster (right thumb zone): Jump (tap) and Sprint (hold). Sized for phones in
 * landscape; keyboard/gamepad users get Space / Shift / A / LT instead.
 */
function ActionButtons() {
  const t = useTranslations('game');
  const sprint = useGame((s) => s.sprintUi);
  const release = () => inputActions.setSprint(false);
  return (
    <div className="flex items-end gap-3">
      <button
        type="button"
        aria-label={t('sprint')}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          inputActions.setSprint(true);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onContextMenu={(e) => e.preventDefault()}
        disabled={sprint === 'exhausted'}
        className={cn(
          'flex size-16 touch-none flex-col items-center justify-center rounded-full text-[11px] font-bold shadow-xl transition-transform active:scale-95',
          sprint === 'sprinting'
            ? 'bg-signal-amber text-storm-slate'
            : 'bg-storm-slate/85 text-white disabled:opacity-50',
        )}
      >
        <Footprints className="size-6" aria-hidden />
        {t('sprint')}
      </button>
      <button
        type="button"
        aria-label={t('jump')}
        onPointerDown={() => inputActions.jump()}
        onContextMenu={(e) => e.preventDefault()}
        className="bg-storm-slate/85 flex size-20 touch-none flex-col items-center justify-center rounded-full text-xs font-bold text-white shadow-xl transition-transform active:scale-95"
      >
        <ArrowUpFromLine className="size-7" aria-hidden />
        {t('jump')}
      </button>
    </div>
  );
}

/** One-time keyboard tip for desktop players. */
function useControlsTip(touch: boolean) {
  const t = useTranslations('game');
  useEffect(() => {
    if (touch) return;
    const id = window.setTimeout(() => useGame.getState().showHint(t('controlsTip'), 'info'), 1500);
    return () => window.clearTimeout(id);
  }, [touch, t]);
}

function Compass() {
  const t = useTranslations('game');
  const arrow = useRef<HTMLDivElement>(null);
  const layout = useGame((s) => s.layout);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (arrow.current && layout) {
        const dx = layout.evac.center.x - live.player.x;
        const dz = layout.evac.center.z - live.player.z;
        // World bearing relative to camera yaw (camera looks along -z when yaw = 0).
        // The Navigation glyph points north-east, hence the −45° correction.
        const bearing = Math.atan2(dx, -dz) + live.cameraYaw - Math.PI / 4;
        arrow.current.style.transform = `rotate(${bearing}rad)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout]);
  return (
    <div
      className="bg-storm-slate/85 flex size-16 items-center justify-center rounded-full border-2 border-white/30 shadow-lg"
      aria-label={t('compass')}
      role="img"
    >
      <div ref={arrow}>
        <Navigation className="text-evac-green size-8 fill-current" aria-hidden />
      </div>
    </div>
  );
}

function PrepPanel({ onEvacuate }: { onEvacuate: () => void }) {
  const t = useTranslations('game');
  const packed = useGame((s) => s.packed);
  const content = useGame((s) => s.content);
  const config = useGame((s) => s.config);
  const texts = useGame((s) => s.texts);
  const tasksDone = useGame((s) => s.tasksDone);
  const pack = useGame((s) => s.pack);
  const weight = bagWeight(packed, content);
  const limit = config?.weightLimitKg ?? 8;
  const ratio = Math.min(1, weight / limit);
  // Small screens (phone landscape or portrait) start collapsed so the panel never covers the
  // action buttons; tap the header to expand.
  const [open, setOpen] = useState(
    () =>
      typeof window === 'undefined' ||
      !window.matchMedia('(max-height: 500px), (max-width: 639px)').matches,
  );

  return (
    <div className="bg-storm-slate/90 w-60 rounded-lg p-3 text-white shadow-xl sm:w-72 [@media(max-height:500px)]:p-2">
      <button
        className="flex min-h-9 w-full items-center justify-between gap-2"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-bold">
          <Backpack className="text-signal-amber size-4" aria-hidden /> {t('bag')}
        </span>
        <span className="font-display text-lg tabular-nums">
          {weight.toFixed(1)} / {limit} kg
        </span>
      </button>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-black/40"
        role="meter"
        aria-label={t('bag')}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={weight}
      >
        <div
          className={cn(
            'h-full origin-left',
            ratio > 0.9 ? 'bg-signal-red' : ratio > 0.7 ? 'bg-signal-amber' : 'bg-evac-green',
          )}
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
      {open && (
        <>
          <ul className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto [@media(max-height:500px)]:max-h-14">
            {packed.length === 0 && <li className="text-xs text-white/70">{t('bagEmpty')}</li>}
            {packed.map((k) => (
              <li key={k}>
                <button
                  onClick={() => pack(k)}
                  className="rounded-sm bg-white/15 px-2 py-1 text-xs hover:bg-white/25"
                  aria-label={`${texts.items[k]?.name ?? k} ✕`}
                >
                  {texts.items[k]?.name ?? k} ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs font-bold text-white/80">{t('tasks')}</p>
          <ul className="mt-1 space-y-0.5">
            {(config?.homeTasks ?? []).map((k) => (
              <li key={k} className="flex items-center gap-1.5 text-xs">
                {tasksDone.includes(k) ? (
                  <CheckCircle2 className="text-evac-green size-3.5 shrink-0" aria-hidden />
                ) : (
                  <Circle className="size-3.5 shrink-0 text-white/50" aria-hidden />
                )}
                <span className={tasksDone.includes(k) ? 'line-through opacity-70' : ''}>
                  {texts.tasks[k]?.name ?? k}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <button
        onClick={onEvacuate}
        className="bg-signal-amber text-storm-slate mt-3 min-h-11 w-full rounded-lg font-bold shadow [@media(max-height:500px)]:mt-2"
      >
        {t('evacuateNow')}
      </button>
    </div>
  );
}

function HintToast() {
  const hint = useGame((s) => s.hint);
  const clear = useGame((s) => s.clearHint);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(clear, hint.kind === 'danger' ? 6000 : 3800);
    return () => window.clearTimeout(id);
  }, [hint, clear]);
  const colors = {
    info: 'bg-storm-slate/95 text-white',
    success: 'bg-evac-green text-white',
    warn: 'bg-signal-amber text-storm-slate',
    danger: 'bg-signal-red text-white',
  };
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-20 flex justify-center px-4"
      aria-live="polite"
    >
      <AnimatePresence>
        {hint && (
          <motion.p
            key={hint.id}
            initial={reduce ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'max-w-lg rounded-lg px-4 py-2.5 text-center text-sm font-bold shadow-xl',
              colors[hint.kind],
            )}
          >
            {hint.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function Announcement() {
  const a = useGame((s) => s.announcement);
  const time = useGame((s) => s.timeUi);
  if (!a || time - a.at > 7) return null;
  return (
    <div className="absolute inset-x-0 top-3 flex justify-center px-20" role="status">
      <p className="bg-signal-red flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white shadow-xl">
        <Radio className="size-4 shrink-0 animate-pulse" aria-hidden /> {a.text}
      </p>
    </div>
  );
}

function InteractButton() {
  const t = useTranslations('game');
  const nearby = useNearby((s) => s.nearby);
  if (!nearby) return null;
  const label =
    nearby.kind === 'item'
      ? t('interactItem', { item: nearby.label })
      : nearby.kind === 'task'
        ? t('interactTask', { task: nearby.label })
        : t('interactNpc', { npc: nearby.label });
  return (
    <button
      onClick={() => inputActions.interact()}
      className="bg-signal-amber text-storm-slate flex min-h-16 max-w-56 items-center gap-2 rounded-2xl px-5 text-left font-bold shadow-xl active:scale-95"
    >
      <Hand className="size-6 shrink-0" aria-hidden />
      <span className="text-sm leading-tight">{label}</span>
      <kbd className="ml-1 hidden rounded bg-black/15 px-1.5 text-xs [@media(pointer:fine)]:inline">
        E
      </kbd>
    </button>
  );
}

function TutorialCoach() {
  const t = useTranslations('game.tutorial');
  const step = useGame((s) => s.tutorialStep);
  const tutorial = useGame((s) => s.config?.tutorial);
  const phase = useGame((s) => s.phase);
  const setStep = useGame((s) => s.setTutorialStep);
  useEffect(() => {
    if (!tutorial || step !== 0) return;
    const id = window.setTimeout(() => setStep(1), 6000);
    return () => window.clearTimeout(id);
  }, [tutorial, step, setStep]);
  if (!tutorial || phase !== 'prep') return null;
  return (
    <div
      className="absolute inset-x-0 bottom-40 flex justify-center px-6 sm:bottom-28 [@media(max-height:500px)]:inset-x-[11rem] [@media(max-height:500px)]:bottom-3 [@media(max-height:500px)]:px-0"
      role="status"
    >
      <p className="border-signal-amber max-w-md rounded-lg border-2 bg-white/95 px-4 py-3 text-center text-sm font-bold text-slate-900 shadow-xl [@media(max-height:500px)]:px-3 [@media(max-height:500px)]:py-2 [@media(max-height:500px)]:text-xs">
        {t(`step${Math.min(step, 3)}` as 'step0')}
      </p>
    </div>
  );
}

export function Hud({
  onPause,
  onEvacuate,
  joystickSize,
}: {
  onPause: () => void;
  onEvacuate: () => void;
  joystickSize: 'sm' | 'md' | 'lg';
}) {
  const t = useTranslations('game');
  const phase = useGame((s) => s.phase);
  const touch = useIsTouch();
  useControlsTip(touch);
  if (phase !== 'prep' && phase !== 'evac') return null;
  return (
    <div className="pointer-events-none absolute inset-0 select-none [&_[role=application]]:pointer-events-auto [&_button]:pointer-events-auto">
      <div className="absolute top-[calc(env(safe-area-inset-top)+0.75rem)] left-[calc(env(safe-area-inset-left)+0.75rem)] flex items-start gap-2">
        <Timer />
        <Vitals evac={phase === 'evac'} />
      </div>
      <div className="absolute top-[calc(env(safe-area-inset-top)+0.75rem)] right-[calc(env(safe-area-inset-right)+0.75rem)] flex items-start gap-2">
        {phase === 'evac' && <Compass />}
        <button
          onClick={onPause}
          aria-label={t('pause')}
          className="bg-storm-slate/85 flex size-12 items-center justify-center rounded-full text-white shadow-lg"
        >
          <Pause className="size-5" aria-hidden />
        </button>
      </div>
      <Announcement />
      <HintToast />
      <TutorialCoach />
      {phase === 'prep' && (
        <div className="absolute top-24 right-[calc(env(safe-area-inset-right)+0.75rem)] sm:top-[calc(env(safe-area-inset-top)+4.5rem)] [@media(max-height:500px)]:top-[calc(env(safe-area-inset-top)+0.75rem)] [@media(max-height:500px)]:right-[calc(env(safe-area-inset-right)+4.25rem)]">
          <PrepPanel onEvacuate={onEvacuate} />
        </div>
      )}
      <div className="absolute right-[calc(env(safe-area-inset-right)+1rem)] bottom-[calc(env(safe-area-inset-bottom)+1rem)] flex flex-col items-end gap-3 [@media(max-height:500px)]:flex-row">
        <InteractButton />
        {touch && <ActionButtons />}
      </div>
      {touch && (
        <div className="pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-[calc(env(safe-area-inset-left)+1rem)]">
          <Joystick size={joystickSize} />
        </div>
      )}
    </div>
  );
}
