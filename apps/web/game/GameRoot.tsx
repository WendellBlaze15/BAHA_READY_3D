'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import {
  computeResult,
  generateLayout,
  type AttemptResult,
  type GameContent,
} from '@baha/shared/game';
import { levelConfigSchema, type LevelConfig } from '@baha/shared/level-config';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { useRouter } from '@/i18n/navigation';
import { qk } from '@/lib/query-keys';
import {
  saveGuestAttempt,
  startAttempt,
  submitAttempt,
  type StartResponse,
} from '@/lib/game/attempt-api';
import { useApiErrorText } from '@/components/auth/use-api-error';
import { useGame, type GameTexts, live } from './store/game-store';
import { attachKeyboard, inputActions } from './systems/input';
import { audio } from './systems/audio';
import { detectQuality } from './systems/quality';
import type { Msg } from './systems/logic';
import { Hud } from './hud/Hud';
import { Briefing, Countdown, LoadingScreen, PauseMenu, RotatePrompt } from './hud/Overlays';
import { Results, type ResultsState } from './hud/Results';
import { LiveReporter } from './hud/LiveReporter';

// The 3D chunk (three + R3F + Rapier WASM) loads lazily and never blocks other routes.
const GameCanvas = dynamic(() => import('./scenes/GameCanvas'), { ssr: false });

export type GameLevel = { id: number; slug: string; name: string; signal: number };

export function GameRoot({
  level,
  config: baseConfig,
  content,
  texts,
  avatar,
  guest,
  bestScore,
  nextHref,
  tips,
  settings,
  mode = 'normal',
  liveSessionId,
  assignmentId,
  me,
  sandbox = false,
}: {
  level: GameLevel;
  config: LevelConfig;
  content: GameContent;
  texts: GameTexts;
  avatar: Partial<AvatarConfig> | null;
  guest: boolean;
  bestScore: number | null;
  nextHref: string | null;
  tips: string[];
  settings: {
    graphics_quality?: string;
    audio?: { master?: number; sfx?: number };
    controls?: { joystickSize?: 'sm' | 'md' | 'lg' };
  } | null;
  mode?: 'normal' | 'daily' | 'live' | 'assignment';
  liveSessionId?: string;
  /** Assignment being played: lets the server open a not-yet-unlocked assigned level. */
  assignmentId?: string;
  me?: { id: string; username: string };
  /** Admin test mode: draft config from Level Configuration, nothing is recorded. */
  sandbox?: boolean;
}) {
  const t = useTranslations('game');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const errText = useApiErrorText();
  const phase = useGame((s) => s.phase);
  const paused = useGame((s) => s.paused);
  const outcome = useGame((s) => s.outcome);

  const [loadStage, setLoadStage] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();
  const [counting, setCounting] = useState(false);
  const [results, setResults] = useState<ResultsState | null>(null);
  const [volume, setVolume] = useState(settings?.audio?.master ?? 0.8);
  const attempt = useRef<StartResponse | null>(null);
  const configRef = useRef<LevelConfig>(baseConfig);

  // Localized messages usable inside the Canvas (announcements come from the level config).
  const msg: Msg = useCallback(
    (key, values) => {
      if (key.startsWith('__ann__')) {
        const a = configRef.current.announcements[Number(key.slice(7))];
        return a ? (locale === 'en' ? a.en : a.fil) : '';
      }
      return t(key as 'packed', values as never);
    },
    [t, locale],
  );

  const quality = useMemo(
    () => detectQuality(settings?.graphics_quality),
    [settings?.graphics_quality],
  );

  // Prepare an initial (unseeded) world so the 3D chunk + physics warm up behind the briefing.
  useEffect(() => {
    const layout = generateLayout(baseConfig, 1);
    useGame.getState().init({
      levelSlug: level.slug,
      config: baseConfig,
      content,
      layout,
      seed: '1',
      guest,
      quality,
      texts,
    });
    setLoadStage(1);
    const id = window.setTimeout(() => setLoadStage(3), 900);
    return () => window.clearTimeout(id);
  }, [baseConfig, content, guest, level.slug, quality, texts]);

  useEffect(() => attachKeyboard(), []);
  useEffect(() => audio.setVolumes({ master: volume }), [volume]);

  // Auto-pause when the tab/app goes to the background (Section 9.8).
  useEffect(() => {
    const onVis = () => {
      const g = useGame.getState();
      if (document.hidden && (g.phase === 'prep' || g.phase === 'evac')) {
        g.setPaused(true);
        audio.suspend();
      } else if (!document.hidden) audio.resume();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(
    () => () => {
      audio.stop();
      useGame.getState().reset();
    },
    [],
  );

  const begin = async () => {
    setStartError(undefined);
    setStarting(true);
    audio.start();
    audio.setVolumes({ master: volume, sfx: settings?.audio?.sfx ?? 0.8 });
    try {
      let seed = String(Math.floor(Math.random() * 2 ** 31));
      let cfg = baseConfig;
      if (sandbox) {
        try {
          const raw = sessionStorage.getItem(`baha.sandbox.${level.slug}`);
          const parsed = raw ? levelConfigSchema.safeParse(JSON.parse(raw)) : null;
          if (parsed?.success) cfg = parsed.data;
        } catch {
          // fall back to the published config
        }
      } else if (!guest) {
        const res = await startAttempt({
          level_id: level.id,
          mode,
          ...(liveSessionId ? { live_session_id: liveSessionId } : {}),
          ...(assignmentId ? { assignment_id: assignmentId } : {}),
        });
        attempt.current = res;
        seed = res.seed;
        cfg = res.config;
      }
      configRef.current = cfg;
      useGame.getState().init({
        levelSlug: level.slug,
        config: cfg,
        content,
        layout: generateLayout(cfg, seed),
        seed,
        guest,
        quality,
        texts,
      });
      setResults(null);
      setCounting(true);
    } catch (e) {
      setStartError(errText(e));
    } finally {
      setStarting(false);
    }
  };

  const onCountdownDone = useCallback(() => {
    setCounting(false);
    useGame.getState().setPhase('prep');
    audio.setRain(configRef.current.rainIntensity * 0.5);
  }, []);

  // Game over → local preview immediately, then authoritative server result.
  useEffect(() => {
    if (phase !== 'ended' || !outcome) return;
    const g = useGame.getState();
    const preview: AttemptResult = computeResult(g.config!, g.content!, g.layout!, g.events);
    const summary = {
      score: preview.score,
      stars: preview.stars,
      outcome: preview.outcome,
      durationMs: preview.durationMs,
    };
    if (sandbox) {
      setResults({ kind: 'guest', result: preview });
      return;
    }
    if (guest) {
      void saveGuestAttempt({
        level_id: level.id,
        seed: g.seed,
        events: g.events,
        client_summary: summary,
      });
      setResults({ kind: 'guest', result: preview });
      return;
    }
    setResults({ kind: 'preview', result: preview });
    const a = attempt.current!;
    void submitAttempt({
      idempotency_key: crypto.randomUUID(),
      attempt_id: a.attempt_id,
      attempt_token: a.attempt_token,
      events: g.events,
      client_summary: summary,
      level_id: level.id,
    })
      .then((res) => {
        if ('queued' in res) setResults({ kind: 'queued', result: preview });
        else {
          setResults({ kind: 'verified', result: res.result, extras: res });
          void qc.invalidateQueries({ queryKey: qk.me.all() });
          void qc.invalidateQueries({ queryKey: qk.leaderboard.all() });
        }
      })
      .catch(() => setResults({ kind: 'queued', result: preview }));
  }, [phase, outcome, guest, sandbox, level.id, qc]);

  const evacuate = () => useGame.getState().setPhase('evac');
  const resume = () => {
    useGame.getState().setPaused(false);
    audio.resume();
  };

  return (
    <div className="bg-storm-slate fixed inset-0 overflow-hidden" style={{ height: '100dvh' }}>
      <GameCanvas avatar={avatar} msg={msg} />
      {liveSessionId && me && (
        <LiveReporter sessionId={liveSessionId} me={me} stars={results?.result.stars} />
      )}
      {loadStage < 3 && <LoadingScreen stage={loadStage} tips={tips} />}
      {phase === 'briefing' && !counting && loadStage >= 3 && (
        <Briefing
          levelName={level.name}
          config={baseConfig}
          bestScore={bestScore}
          guest={guest}
          busy={starting}
          error={startError}
          signal={level.signal}
          onStart={begin}
        />
      )}
      {counting && <Countdown onDone={onCountdownDone} />}
      <Hud
        onPause={() => inputActions.pause()}
        onEvacuate={evacuate}
        joystickSize={settings?.controls?.joystickSize ?? 'md'}
      />
      {paused && (
        <PauseMenu
          onResume={resume}
          onRestart={() => {
            useGame.getState().setPaused(false);
            if (!guest && attempt.current) useGame.getState().end('quit');
            void begin();
          }}
          onQuit={() => {
            useGame.getState().setPaused(false);
            useGame.getState().end('quit');
            router.push(guest ? '/' : '/levels');
          }}
          volume={volume}
          onVolume={setVolume}
        />
      )}
      {(phase === 'prep' || phase === 'evac') && <RotatePrompt />}
      {results && (
        <Results
          state={results}
          texts={texts}
          levelName={level.name}
          nextHref={guest && level.id >= 1 ? '/sign-up' : nextHref}
          onRetry={() => {
            live.time = 0;
            void begin();
          }}
        />
      )}
    </div>
  );
}
