'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CloudRain, Home, Radio, Ship, Users, Waves } from 'lucide-react';
import { useSession } from '@/game/survival/session-store';
import { Button } from '@/components/ui/button';

const PANELS = [
  { key: 'p1', Icon: CloudRain, bg: 'from-slate-700 to-slate-900' },
  { key: 'p2', Icon: Waves, bg: 'from-sky-800 to-slate-900' },
  { key: 'p3', Icon: Home, bg: 'from-amber-800 to-slate-900' },
  { key: 'p4', Icon: Radio, bg: 'from-emerald-800 to-slate-900' },
  { key: 'p5', Icon: Ship, bg: 'from-cyan-800 to-slate-900' },
  { key: 'p6', Icon: Users, bg: 'from-orange-700 to-slate-900' },
] as const;

/** Synced intro (Section 3): everyone finishes or skips; the server moves the team on together. */
export function Cutscene() {
  const t = useTranslations('survival.cutscene');
  const room = useSession((s) => s.room)!;
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);
  const finish = () => {
    setDone(true);
    room.send('cutscene:done', {});
  };
  const p = PANELS[i]!;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      style={{ height: '100dvh' }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={p.key}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.5 }}
          className={`flex flex-1 flex-col items-center justify-center gap-6 bg-gradient-to-b px-6 text-center ${p.bg}`}
        >
          <p.Icon className="size-20 opacity-90 sm:size-28" aria-hidden />
          <p
            className="max-w-2xl text-2xl leading-snug font-semibold sm:text-3xl"
            aria-live="polite"
          >
            {t(p.key)}
          </p>
          <p className="text-sm opacity-70">
            {i + 1} / {PANELS.length}
          </p>
        </motion.div>
      </AnimatePresence>
      {!done && (
        <Button
          variant="ghost"
          className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] text-white hover:bg-white/10"
          onClick={finish}
        >
          {t('skip')}
        </Button>
      )}
      <div
        className="flex justify-center p-4"
        style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}
      >
        {done ? (
          <p className="text-center opacity-80" role="status">
            {t('waiting')}
          </p>
        ) : (
          <Button
            size="lg"
            className="h-12 min-w-40"
            onClick={() => (i < PANELS.length - 1 ? setI(i + 1) : finish())}
          >
            {t('next')}
          </Button>
        )}
      </div>
    </div>
  );
}
