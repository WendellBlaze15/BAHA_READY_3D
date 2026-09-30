// End-to-end smoke test of the attempt pipeline against the linked project:
// sign in → start-attempt → simulate a plausible run from the seeded layout → submit-attempt.
// Usage: pnpm exec tsx scripts/smoke-attempt.ts [--tamper]
import path from 'node:path';
import dotenv from 'dotenv';
import {
  dist,
  generateLayout,
  type GameEvent,
  type Vec2,
} from '../packages/shared/src/game/index.ts';
import type { LevelConfig } from '../packages/shared/src/level-config.ts';

dotenv.config({ path: path.resolve('.env.local'), quiet: true });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const tamper = process.argv.includes('--tamper');

async function fn(name: string, token: string, body: unknown) {
  const r = await fetch(`${URL_}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

const login = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
  }),
}).then((r) => r.json());
const token = login.access_token as string;
console.log('login', token ? 'ok' : 'FAILED');

const start = await fn('start-attempt', token, { level_id: 1, device_id: 'smoke' });
console.log('start-attempt', start.status, start.body.error?.code ?? 'ok');
if (!start.body.data) process.exit(1);
const { attempt_id, attempt_token, seed, config } = start.body.data as {
  attempt_id: string;
  attempt_token: string;
  seed: string;
  config: LevelConfig;
};
const layout = generateLayout(config, seed);

const ev: GameEvent[] = [{ t: 0, type: 'phase', payload: { phase: 'prep' } }];
let t = 2;
for (const item of [
  'drinking_water',
  'ready_food',
  'flashlight',
  'first_aid_kit',
  'maintenance_medicine',
  'whistle',
  'powerbank',
]) {
  ev.push({ t: (t += 1.5), type: 'item_packed', payload: { item } });
}
for (const task of config.homeTasks) ev.push({ t: (t += 2), type: 'task_done', payload: { task } });
t += 2;
ev.push({ t, type: 'phase', payload: { phase: 'evac' } });
let pos: Vec2 = { ...layout.start };
const stops = [...layout.npcs.map((n) => n.pos), ...layout.route.slice(1)];
ev.push({ t, type: 'pos', payload: { x: pos.x, z: pos.z } });
for (const target of stops) {
  while (dist(pos, target) > 0.01) {
    const step = Math.min(2, dist(pos, target));
    const d = dist(pos, target);
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
      ) {
        ev.push({ t, type: 'npc_follow', payload: { id: n.id } });
      }
    }
  }
}
if (tamper) ev.push({ t, type: 'pos', payload: { x: 400, z: -400 } });
for (const n of layout.npcs) ev.push({ t, type: 'npc_rescued', payload: { id: n.id } });
ev.push({ t, type: 'evac_reached', payload: {} });
ev.push({ t, type: 'phase', payload: { phase: 'end' } });

const submit = await fn('submit-attempt', token, {
  attempt_id,
  attempt_token,
  events: ev,
  idempotency_key: crypto.randomUUID(),
  client_summary: {
    score: tamper ? 99999 : 0,
    stars: 3,
    outcome: 'completed',
    durationMs: Math.round(t * 1000),
  },
});
const d = submit.body.data;
console.log('submit-attempt', submit.status, submit.body.error?.code ?? 'ok');
if (d) {
  console.log({
    outcome: d.result.outcome,
    score: d.result.score,
    stars: d.result.stars,
    flags: d.result.flags,
    npcs: `${d.result.npcsRescued}/${d.result.npcsTotal}`,
    mistakes: d.result.mistakes.length,
    new_tips: d.new_tips?.length,
    new_achievements: d.new_achievements?.map((a: { key: string }) => a.key),
    unlocked_level: d.unlocked_level,
  });
}
const replay = await fn('submit-attempt', token, {
  attempt_id,
  attempt_token,
  events: ev,
  idempotency_key: crypto.randomUUID(),
});
console.log('resubmit same attempt (token single-use) →', replay.status, replay.body.error?.code);
