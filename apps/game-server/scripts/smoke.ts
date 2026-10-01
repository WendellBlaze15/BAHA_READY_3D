// Live smoke test for a running game server (local or Railway) with REAL Supabase tokens.
// Creates a throwaway player + facilitator, checks: health, facilitator rejected, player creates
// a lobby (code reserved in Redis), a second player joins via code lookup, admin list/close,
// then deletes the throwaway accounts. Prints no secrets.
// Usage: node ../../scripts/with-env.mjs tsx scripts/smoke.ts [baseUrl]
import crypto from 'node:crypto';
import { ColyseusSDK } from '@colyseus/sdk';
import { Redis } from '@upstash/redis';
import { createClient } from '@supabase/supabase-js';
import { SURVIVAL_PROTOCOL_VERSION } from '@baha/shared/survival';

const base = (process.argv[2] ?? 'http://localhost:2567').replace(/\/+$/, '');
const origin = process.env.SMOKE_ORIGIN ?? process.env.PRODUCTION_URL ?? 'http://localhost:3000';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const anon = () =>
  createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(
    `${ok ? '✔' : '✘'} ${name}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`,
  );
};
const users: string[] = [];

async function mkUser(label: string, facilitator = false) {
  const tag = crypto.randomBytes(3).toString('hex');
  const username = `qags${label}${tag}`;
  const email = `${username}@test.local`;
  const password = crypto.randomBytes(18).toString('base64url') + 'Aa1!';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  users.push(data.user.id);
  const now = new Date().toISOString();
  await admin
    .from('profiles')
    .update({ username, display_name: username, consent_at: now, onboarded_at: now })
    .eq('id', data.user.id);
  if (facilitator) await admin.from('user_roles').insert({ user_id: data.user.id, role_id: 3 });
  const s = anon();
  const { data: sess, error: e2 } = await s.auth.signInWithPassword({ email, password });
  if (e2 || !sess.session) throw e2 ?? new Error('no session');
  return { id: data.user.id, token: sess.session.access_token };
}

function sdk(token: string) {
  const c = new ColyseusSDK(base, { headers: { origin } });
  c.auth.token = token;
  return c;
}

async function main() {
  const h = await fetch(`${base}/health`).then((r) => r.json() as Promise<{ ok: boolean }>);
  check('health', h.ok === true);

  const [p1, p2, fac] = await Promise.all([mkUser('a'), mkUser('b'), mkUser('f', true)]);
  const opts = { protocol: SURVIVAL_PROTOCOL_VERSION, mode: 'coop', difficulty: 'normal' };

  const facErr = await sdk(fac.token)
    .create('survival', opts)
    .then(
      () => null,
      (e: { code?: number }) => e.code,
    );
  check('facilitator rejected (403)', facErr === 403, facErr);
  const badOrigin = new ColyseusSDK(base, { headers: { origin: 'https://evil.example' } });
  badOrigin.auth.token = p1.token;
  const originErr = await badOrigin.create('survival', opts).then(
    () => null,
    (e: { code?: number }) => e.code,
  );
  check('foreign origin rejected (403)', originErr === 403, originErr);

  const host = await sdk(p1.token).create('survival', opts);
  await new Promise((r) => setTimeout(r, 300));
  const code = (host.state as { code: string }).code;
  check('player created a lobby with a code', /^[A-Z2-9]{6}$/.test(code), code);
  const roomId = await redis.get<string>(`survival:code:${code}`);
  check('code resolves in Redis', roomId === host.roomId);

  const guest = await sdk(p2.token).joinById(roomId!, { protocol: SURVIVAL_PROTOCOL_VERSION });
  await new Promise((r) => setTimeout(r, 300));
  check(
    'second player joined',
    (host.state as { players: Map<string, unknown> }).players.size === 2,
  );

  // Chat: delivered to the teammate and stored server-side; contact info is rejected.
  const got: { text: string }[] = [];
  guest.onMessage('chat:message', (m: { text: string }) => got.push(m));
  const rejected: { reasonKey: string }[] = [];
  host.onMessage('chat:rejected', (m: { reasonKey: string }) => rejected.push(m));
  host.onMessage('chat:message', () => {});
  host.send('chat:send', { text: 'tara sa palengke', clientMsgId: 's1' });
  await new Promise((r) => setTimeout(r, 1700));
  host.send('chat:send', { text: 'add mo ko sa fb', clientMsgId: 's2' });
  await new Promise((r) => setTimeout(r, 1200));
  check('chat delivered to teammate', got[0]?.text === 'tara sa palengke', got);
  check('contact-info message rejected', rejected[0]?.reasonKey === 'personal_info', rejected);
  const { data: runs } = await admin
    .from('survival_runs')
    .select('id, status')
    .eq('host_id', p1.id);
  const runId = runs?.[0]?.id as string | undefined;
  check('run row created (lobby)', runs?.length === 1 && runs[0]!.status === 'lobby', runs);
  const { data: chat } = await admin
    .from('survival_chat_messages')
    .select('status')
    .eq('run_id', runId ?? '')
    .order('id');
  check(
    'chat stored for moderation (delivered + rejected)',
    JSON.stringify(chat?.map((c) => c.status)) === '["delivered","rejected"]',
    chat,
  );

  // Start the run: roles, ready, start, cutscene → playing; the simulation ticks.
  for (const [r, role] of [
    [host, 'medic'],
    [guest, 'scout'],
  ] as const) {
    r.onMessage('*', () => {});
    r.send('lobby:setRole', { role });
    r.send('lobby:ready', { ready: true });
  }
  await new Promise((r) => setTimeout(r, 400));
  host.send('lobby:start', {});
  await new Promise((r) => setTimeout(r, 1200));
  host.send('cutscene:done', {});
  guest.send('cutscene:done', {});
  await new Promise((r) => setTimeout(r, 2500));
  const st = host.state as {
    phase: string;
    minute: number;
    players: Map<string, { bag?: unknown[] }>;
  };
  check('run is playing and the clock ticks', st.phase === 'playing' && st.minute > 360, {
    phase: st.phase,
    minute: st.minute,
  });
  check('own bag visible via StateView', (st.players.get(p1.id)?.bag?.length ?? 0) === 12);
  const { data: run2 } = await admin
    .from('survival_runs')
    .select('status')
    .eq('id', runId ?? '')
    .single();
  const { count: members } = await admin
    .from('survival_run_members')
    .select('*', { count: 'exact', head: true })
    .eq('run_id', runId ?? '');
  check('run active with 2 members', run2?.status === 'active' && members === 2, { run2, members });

  const auth = { authorization: `Bearer ${process.env.GAME_SERVER_ADMIN_SECRET}` };
  const list = (await fetch(`${base}/admin/rooms`, { headers: auth }).then((r) => r.json())) as {
    rooms: { roomId: string }[];
  };
  check(
    'admin lists the room',
    list.rooms.some((r) => r.roomId === host.roomId),
  );
  const left = new Promise<number>((r) => guest.onLeave((c) => r(c)));
  await fetch(`${base}/admin/rooms/${host.roomId}/close`, { method: 'POST', headers: auth });
  check('admin force-close disconnects players', (await left) === 4104);
  await new Promise((r) => setTimeout(r, 500));
  check('code released at start', (await redis.get(`survival:code:${code}`)) === null);
}

try {
  await main();
} catch (e) {
  failures++;
  console.log('✘ smoke crashed:', e instanceof Error ? e.message : e);
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  console.log(failures ? `\n${failures} check(s) failed` : '\nall smoke checks passed');
  process.exit(failures ? 1 : 0);
}
