// Plays a level through the real attempt pipeline (start-attempt → deterministic, plausible
// run built from the seeded layout → submit-attempt). Shared by smoke tests and journeys.
import {
  dist,
  generateLayout,
  type GameEvent,
  type Vec2,
} from '../../packages/shared/src/game/index.ts';
import type { LevelConfig } from '../../packages/shared/src/level-config.ts';

const GOOD_ITEMS = [
  'drinking_water',
  'ready_food',
  'flashlight',
  'first_aid_kit',
  'maintenance_medicine',
  'whistle',
  'powerbank',
];

export async function callFunction(name: string, token: string, body: unknown) {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as { data?: any; error?: any } };
}

export type PlayOptions = {
  tamper?: boolean;
  /** Sprint (and jump) at the start of the evacuation, like a real player would. */
  sprint?: boolean;
  mode?: 'normal' | 'daily' | 'assignment' | 'live';
  assignment_id?: string;
  live_session_id?: string;
};

export async function playLevel(token: string, levelId: number, opts: PlayOptions = {}) {
  const start = await callFunction('start-attempt', token, {
    level_id: levelId,
    device_id: 'journey',
    ...(opts.mode ? { mode: opts.mode } : {}),
    ...(opts.assignment_id ? { assignment_id: opts.assignment_id } : {}),
    ...(opts.live_session_id ? { live_session_id: opts.live_session_id } : {}),
  });
  if (!start.body.data) return { start, submit: null };
  const { attempt_id, attempt_token, seed, config } = start.body.data as {
    attempt_id: string;
    attempt_token: string;
    seed: string;
    config: LevelConfig;
  };
  const { events: ev, durationMs } = buildRun(config, seed, opts.tamper, opts.sprint);
  const submit = await callFunction('submit-attempt', token, {
    attempt_id,
    attempt_token,
    events: ev,
    idempotency_key: crypto.randomUUID(),
    client_summary: { score: opts.tamper ? 99999 : 0, stars: 3, outcome: 'completed', durationMs },
  });
  return { start, submit, attempt_id, attempt_token, events: ev, config };
}

/** A plausible run for this config + seed (what a real player's client would record). */
export function buildRun(config: LevelConfig, seed: string, tamper = false, sprint = false) {
  const layout = generateLayout(config, seed);
  const ev: GameEvent[] = [{ t: 0, type: 'phase', payload: { phase: 'prep' } }];
  let t = 2;
  const available = new Set(config.items);
  const pack = new Set([...config.requiredItems, ...GOOD_ITEMS.filter((i) => available.has(i))]);
  for (const item of pack) ev.push({ t: (t += 1.5), type: 'item_packed', payload: { item } });
  for (const task of config.homeTasks ?? [])
    ev.push({ t: (t += 2), type: 'task_done', payload: { task } });
  t += 2;
  ev.push({ t, type: 'phase', payload: { phase: 'evac' } });
  let pos: Vec2 = { ...layout.start };
  const stops = [...layout.npcs.map((n) => n.pos), ...layout.route.slice(1)];
  ev.push({ t, type: 'pos', payload: { x: pos.x, z: pos.z } });
  // Optional honest sprint: ~7 m/s for the first 5 s (stamina lasts ~8 s), with two jumps.
  const sprintUntil = sprint ? t + 5 : -1;
  if (sprint) {
    ev.push({ t, type: 'jump', payload: {} });
    ev.push({ t, type: 'sprint', payload: { on: true } });
  }
  let sprintOn = sprint;
  for (const target of stops) {
    while (dist(pos, target) > 0.01) {
      const d = dist(pos, target);
      if (sprintOn && t >= sprintUntil) {
        ev.push({ t, type: 'sprint', payload: { on: false } });
        ev.push({ t, type: 'jump', payload: {} });
        sprintOn = false;
      }
      const step = Math.min(sprintOn ? 3.5 : 2, d);
      pos = {
        x: pos.x + ((target.x - pos.x) / d) * step,
        z: pos.z + ((target.z - pos.z) / d) * step,
      };
      t = Math.round((t + 0.5) * 100) / 100;
      ev.push({
        t,
        type: 'pos',
        payload: { x: Math.round(pos.x * 100) / 100, z: Math.round(pos.z * 100) / 100 },
      });
      for (const n of layout.npcs) {
        if (
          dist(pos, n.pos) < 1 &&
          !ev.some((e) => e.type === 'npc_follow' && e.payload.id === n.id)
        )
          ev.push({ t, type: 'npc_follow', payload: { id: n.id } });
      }
    }
  }
  if (tamper) ev.push({ t, type: 'pos', payload: { x: 400, z: -400 } });
  for (const n of layout.npcs) ev.push({ t, type: 'npc_rescued', payload: { id: n.id } });
  ev.push({ t, type: 'evac_reached', payload: {} });
  ev.push({ t, type: 'phase', payload: { phase: 'end' } });
  return { events: ev, durationMs: Math.round(t * 1000) };
}
