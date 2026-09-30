// Live check of the jump/sprint anti-cheat against the deployed Edge Functions.
// Usage: node scripts/with-env.mjs pnpm exec tsx scripts/lib/verify-sprint.ts
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildRun, callFunction, playLevel } from './simulate-attempt.ts';
import type { GameEvent } from '../../packages/shared/src/game/index.ts';

const requireWeb = createRequire(path.resolve('apps/web/package.json'));
const { createClient } = requireWeb(
  '@supabase/supabase-js',
) as typeof import('@supabase/supabase-js');
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const email = `qasprint${crypto.randomBytes(3).toString('hex')}@test.local`;
const password = crypto.randomBytes(18).toString('base64url') + 'Aa1!';
const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const now = new Date().toISOString();
await admin.from('profiles').update({ consent_at: now, onboarded_at: now }).eq('id', u.user!.id);
let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : ' → ' + JSON.stringify(detail).slice(0, 300)}`);
};
try {
  const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data: s } = await anon.auth.signInWithPassword({ email, password });
  const token = s.session!.access_token;

  const honest = await playLevel(token, 1, { sprint: true });
  const r = honest.submit?.body.data?.result;
  check(
    'honest sprint + jumps: accepted and scored',
    honest.submit?.status === 200 && r?.outcome === 'completed',
    honest.submit?.body,
  );
  check(
    'honest sprint + jumps: no anti-cheat flags',
    Array.isArray(r?.flags) && r.flags.length === 0,
    r?.flags,
  );

  // Cheater: claims "sprint" but keeps 9.5 m/s far longer than stamina allows.
  const start = await callFunction('start-attempt', token, { level_id: 1, device_id: 'cheat' });
  const { attempt_id, attempt_token, seed, config } = start.body.data;
  const base = buildRun(config, seed).events;
  const evacAt = base.find((e) => e.type === 'phase' && e.payload.phase === 'evac')!.t;
  const startPos = base.find((e) => e.type === 'pos')! as Extract<GameEvent, { type: 'pos' }>;
  const cheat: GameEvent[] = base.filter((e) => e.t <= evacAt && e.type !== 'pos');
  cheat.push({ t: evacAt, type: 'sprint', payload: { on: true } });
  for (let i = 0; i <= 20; i++)
    cheat.push({
      t: evacAt + i,
      type: 'pos',
      payload: { x: startPos.payload.x + 9.5 * i * 0.7, z: startPos.payload.z + 9.5 * i * 0.7 },
    });
  cheat.push({ t: evacAt + 20, type: 'phase', payload: { phase: 'end' } });
  const sub = await callFunction('submit-attempt', token, {
    attempt_id,
    attempt_token,
    events: cheat,
    idempotency_key: crypto.randomUUID(),
    client_summary: { score: 5000, stars: 3, outcome: 'completed', durationMs: 60000 },
  });
  const flags = sub.body.data?.result?.flags ?? [];
  check(
    'endless "sprint" is flagged SPEED_IMPOSSIBLE',
    flags.includes('SPEED_IMPOSSIBLE'),
    sub.body,
  );
} finally {
  await admin.from('attempts').delete().eq('user_id', u.user!.id);
  await admin.auth.admin.deleteUser(u.user!.id);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exitCode = failed ? 1 : 0;
}
