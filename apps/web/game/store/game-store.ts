'use client';

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { GameContent, GameEvent, Layout } from '@baha/shared/game';
import type { LevelConfig } from '@baha/shared/level-config';

export type Phase = 'loading' | 'briefing' | 'countdown' | 'prep' | 'evac' | 'ended';
export type Quality = 'low' | 'medium' | 'high';

export type TextEntry = { name: string; explanation: string };
export type GameTexts = {
  items: Record<string, TextEntry>;
  tasks: Record<string, TextEntry>;
  hazards: Record<string, TextEntry>;
  npcs: Record<string, TextEntry>;
};

export type HintKind = 'info' | 'warn' | 'danger' | 'success';
export type Hint = { id: number; text: string; kind: HintKind };

/**
 * Per-frame values live in `live` (mutated in useFrame, never triggers React renders).
 * Discrete game state lives in the store and changes a few times per second at most.
 */
export const live = {
  time: 0, // game seconds since attempt start (excludes pauses)
  player: { x: 0, z: 0, y: 0, yaw: 0 },
  cameraYaw: 0,
  waterY: 0,
  depth: 0,
  speed: 0,
  health: 100,
  stamina: 100,
  lastPosSampleT: -1,
  lightningFlash: 0,
  interactTarget: null as null | { kind: 'item' | 'task' | 'npc'; key: string; label: string },
};

export type GameState = {
  levelSlug: string;
  config: LevelConfig | null;
  content: GameContent | null;
  layout: Layout | null;
  seed: string;
  guest: boolean;
  texts: GameTexts;
  quality: Quality;
  phase: Phase;
  paused: boolean;
  prepEndsAt: number | null;
  evacStartedAt: number | null;
  evacEndsAt: number | null;
  packed: string[];
  tasksDone: string[];
  followers: string[];
  rescued: string[];
  hazardsHit: string[];
  events: GameEvent[];
  hint: Hint | null;
  announcement: { text: string; at: number } | null;
  healthUi: number;
  staminaUi: number;
  timeUi: number;
  depthUi: 'dry' | 'ankle' | 'knee' | 'waist' | 'chest';
  outcome: null | {
    reason: 'evac' | 'health' | 'timeout' | 'instant_fail' | 'quit';
    hazardKey?: string;
  };
  tutorialStep: number;
  moveTarget: { x: number; z: number } | null;
};

type Actions = {
  init: (
    p: Pick<
      GameState,
      'levelSlug' | 'config' | 'content' | 'layout' | 'seed' | 'guest' | 'quality' | 'texts'
    >,
  ) => void;
  setPhase: (phase: Phase) => void;
  setPaused: (paused: boolean) => void;
  log: (e: Omit<GameEvent, 't'> & { t?: number }) => void;
  pack: (item: string) => 'packed' | 'unpacked' | 'overweight';
  doTask: (task: string) => boolean;
  follow: (npcId: string) => void;
  rescueAll: () => void;
  hitHazard: (id: string, key: string) => void;
  showHint: (text: string, kind?: HintKind, force?: boolean) => void;
  clearHint: () => void;
  announce: (text: string) => void;
  end: (reason: NonNullable<GameState['outcome']>['reason'], hazardKey?: string) => void;
  setTutorialStep: (n: number) => void;
  setMoveTarget: (p: { x: number; z: number } | null) => void;
  reset: () => void;
};

const initial: GameState = {
  levelSlug: '',
  config: null,
  content: null,
  layout: null,
  seed: '0',
  guest: true,
  texts: { items: {}, tasks: {}, hazards: {}, npcs: {} },
  quality: 'medium',
  phase: 'loading',
  paused: false,
  prepEndsAt: null,
  evacStartedAt: null,
  evacEndsAt: null,
  packed: [],
  tasksDone: [],
  followers: [],
  rescued: [],
  hazardsHit: [],
  events: [],
  hint: null,
  announcement: null,
  healthUi: 100,
  staminaUi: 100,
  timeUi: 0,
  depthUi: 'dry',
  outcome: null,
  tutorialStep: 0,
  moveTarget: null,
};

let hintSeq = 0;
let lastHintAt = -Infinity;
const HINT_COOLDOWN_MS = 8000;

const r2 = (n: number) => Math.round(n * 100) / 100;

export const useGame = create<GameState & Actions>()(
  subscribeWithSelector((set, get) => ({
    ...initial,

    init: (p) => {
      Object.assign(live, {
        time: 0,
        waterY: 0,
        depth: 0,
        speed: 0,
        health: 100,
        stamina: 100,
        lastPosSampleT: -1,
        lightningFlash: 0,
        interactTarget: null,
      });
      live.player = { x: 0, z: 0, y: 0, yaw: 0 };
      lastHintAt = -Infinity;
      set({ ...initial, ...p, phase: 'briefing' });
    },

    setPhase: (phase) => {
      const s = get();
      const cfg = s.config;
      if (phase === 'prep') {
        live.time = 0;
        get().log({ type: 'phase', payload: { phase: 'prep' } });
        set({ phase, prepEndsAt: cfg?.prepTimeSec ?? null });
        return;
      }
      if (phase === 'evac') {
        get().log({ type: 'phase', payload: { phase: 'evac' } });
        set({
          phase,
          evacStartedAt: live.time,
          evacEndsAt: live.time + (cfg?.evacTimeSec ?? 120),
          moveTarget: null,
        });
        return;
      }
      set({ phase });
    },

    setPaused: (paused) => set({ paused }),

    log: (e) => {
      const ev = { ...e, t: r2(e.t ?? live.time) } as GameEvent;
      set((s) => ({ events: [...s.events, ev] }));
    },

    pack: (item) => {
      const s = get();
      const content = s.content!;
      const def = content.items.find((i) => i.key === item);
      if (!def) return 'unpacked';
      if (s.packed.includes(item)) {
        set({ packed: s.packed.filter((k) => k !== item) });
        get().log({ type: 'item_unpacked', payload: { item } });
        return 'unpacked';
      }
      const weight = s.packed.reduce(
        (w, k) => w + (content.items.find((i) => i.key === k)?.weight_kg ?? 0),
        0,
      );
      if (weight + def.weight_kg > (s.config?.weightLimitKg ?? 8) + 1e-6) return 'overweight';
      set({ packed: [...s.packed, item] });
      get().log({ type: 'item_packed', payload: { item } });
      return 'packed';
    },

    doTask: (task) => {
      if (get().tasksDone.includes(task)) return false;
      set((s) => ({ tasksDone: [...s.tasksDone, task] }));
      get().log({ type: 'task_done', payload: { task } });
      return true;
    },

    follow: (npcId) => {
      if (get().followers.includes(npcId) || get().rescued.includes(npcId)) return;
      set((s) => ({ followers: [...s.followers, npcId] }));
      get().log({ type: 'npc_follow', payload: { id: npcId } });
    },

    rescueAll: () => {
      const { followers } = get();
      for (const id of followers) get().log({ type: 'npc_rescued', payload: { id } });
      set((s) => ({ rescued: [...s.rescued, ...followers], followers: [] }));
    },

    hitHazard: (id, key) => {
      if (get().hazardsHit.includes(id)) return;
      set((s) => ({ hazardsHit: [...s.hazardsHit, id] }));
      get().log({ type: 'hazard_hit', payload: { id, key } });
    },

    showHint: (text, kind = 'info', force = false) => {
      const now = performance.now();
      // Max one hint per 8 seconds (Section 9.6), except forced tutorial/critical hints.
      if (!force && now - lastHintAt < HINT_COOLDOWN_MS) return;
      lastHintAt = now;
      set({ hint: { id: ++hintSeq, text, kind } });
    },
    clearHint: () => set({ hint: null }),

    announce: (text) => set({ announcement: { text, at: live.time } }),

    end: (reason, hazardKey) => {
      if (get().phase === 'ended') return;
      const s = get();
      if (reason === 'evac') {
        get().rescueAll();
        get().log({ type: 'evac_reached', payload: {} });
      } else if (reason === 'health') get().log({ type: 'health_zero', payload: {} });
      else if (reason === 'timeout')
        get().log({ type: 'timeout', payload: { phase: s.phase === 'prep' ? 'prep' : 'evac' } });
      else if (reason === 'quit') get().log({ type: 'quit', payload: {} });
      get().log({ type: 'phase', payload: { phase: 'end' } });
      set({ phase: 'ended', outcome: { reason, hazardKey }, paused: false });
    },

    setTutorialStep: (n) => set({ tutorialStep: n }),
    setMoveTarget: (p) => set({ moveTarget: p }),
    reset: () => set({ ...initial }),
  })),
);

/** Current go-bag weight (kg). */
export function bagWeight(packed: string[], content: GameContent | null) {
  if (!content) return 0;
  return r2(
    packed.reduce((w, k) => w + (content.items.find((i) => i.key === k)?.weight_kg ?? 0), 0),
  );
}

export function depthBand(depth: number): GameState['depthUi'] {
  if (depth < 0.08) return 'dry';
  if (depth < 0.3) return 'ankle';
  if (depth < 0.55) return 'knee';
  if (depth < 0.95) return 'waist';
  return 'chest';
}

/** Movement multiplier by water depth (Section 9.4). */
export function depthSpeed(depth: number) {
  const b = depthBand(depth);
  return b === 'dry' ? 1 : b === 'ankle' ? 0.9 : b === 'knee' ? 0.7 : b === 'waist' ? 0.45 : 0.3;
}
