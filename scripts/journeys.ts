// Cross-role integration journeys: verifies that modules are actually connected end to end
// (application → approval → group → join → assignment → play → progress/analytics/reports,
// live sessions, announcements → notifications, moderation, suspension, content → players).
//
// Runs against a local production server (default http://localhost:3000) and the linked
// Supabase project, as REAL users with their own sessions (same RLS as the browser).
// Creates its own temporary users/data (…@test.local, never emailed) and deletes them.
//
// Usage: pnpm test:journeys   (server running on :3000)
// Side-effect-free for real users: no system-wide announcements, no maintenance toggling.
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type BrowserContext } from '@playwright/test';
import { buildRun, callFunction, playLevel } from './lib/simulate-attempt.ts';

const requireWeb = createRequire(path.resolve('apps/web/package.json'));
const { createClient } = requireWeb(
  '@supabase/supabase-js',
) as typeof import('@supabase/supabase-js');

const BASE = process.env.BASE ?? 'http://localhost:3000';
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(SB_URL).hostname.split('.')[0];
const admin = createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

// ── Result bookkeeping ─────────────────────────────────────────────────
const results: { journey: string; check: string; ok: boolean; detail?: string }[] = [];
let journey = '';
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({
    journey,
    check: name,
    ok,
    detail: detail === undefined ? undefined : String(JSON.stringify(detail)).slice(0, 300),
  });
  console.log(
    `${ok ? '  ✔' : '  ✘'} ${name}${ok || detail === undefined ? '' : ` → ${String(JSON.stringify(detail)).slice(0, 300)}`}`,
  );
  return ok;
}
async function step(name: string, fn: () => Promise<void>) {
  journey = name;
  console.log(`\n▶ ${name}`);
  try {
    await fn();
  } catch (e) {
    check('journey completed without exception', false, (e as Error).message);
  }
}
async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 12000) {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 700));
    v = await fn();
  }
  return v;
}

// ── Users & sessions ───────────────────────────────────────────────────
const ROLE_ID = { player: 2, facilitator: 3, admin: 4, super_admin: 5 } as const;
type Role = keyof typeof ROLE_ID;
type U = {
  id: string;
  username: string;
  email: string;
  password: string;
  role: Role;
  ctx?: BrowserContext;
  token?: string;
  secret?: string;
};
const tag = crypto.randomBytes(3).toString('hex');
const created = { users: [] as U[], groups: [] as string[], tips: [] as string[] };

// NOTE: each run signs in ~9 users; the password sign-in limit (10/15 min per IP) means
// back-to-back runs need a server restart plus clearing local rl:password_signin keys.
let skew = 0;
function totp(secret: string) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase())
    bits += alpha.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor((Date.now() + skew) / 30000)));
  const h = crypto.createHmac('sha1', key).update(ctr).digest();
  const o = h[19]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

async function mkUser(role: Role, label: string): Promise<U> {
  const username = `qa${label}${tag}`;
  const email = `${username}@test.local`;
  const password = crypto.randomBytes(18).toString('base64url') + 'Aa1!';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const now = new Date().toISOString();
  await admin
    .from('profiles')
    .update({
      username,
      display_name: username,
      consent_at: now,
      onboarded_at: now,
      barangay: 'Bulilan Norte',
    })
    .eq('id', data.user.id);
  if (role !== 'player') {
    const { error: e } = await admin
      .from('user_roles')
      .insert({ user_id: data.user.id, role_id: ROLE_ID[role] });
    if (e) throw e;
  }
  const u: U = { id: data.user.id, username, email, password, role };
  created.users.push(u);
  return u;
}

/** Reads the access token @supabase/ssr stored in the browser cookies (chunked, base64-). */
async function tokenFrom(ctx: BrowserContext) {
  const cookies = await ctx.cookies(BASE);
  const name = `sb-${REF}-auth-token`;
  const parts = cookies
    .filter((c) => c.name === name || c.name.startsWith(`${name}.`))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let raw = parts.map((c) => c.value).join('');
  raw = decodeURIComponent(raw);
  if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64url').toString('utf8');
  return (JSON.parse(raw) as { access_token: string }).access_token;
}

async function signIn(browser: import('@playwright/test').Browser, u: U) {
  u.ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await u.ctx.newPage();
  const r = await page.request.post(`${BASE}/api/auth/password`, {
    headers: { Origin: BASE },
    data: { identifier: u.username, password: u.password },
  });
  if (r.status() !== 200) throw new Error(`sign-in ${u.username}: ${r.status()} ${await r.text()}`);
  if (u.role !== 'player') {
    await page.goto(`${BASE}/en/mfa`, { waitUntil: 'domcontentloaded' });
    const code = page.locator('code, [data-secret]').first();
    const challenge = page.getByText(/open your authenticator/i);
    await Promise.race([code.waitFor({ timeout: 30000 }), challenge.waitFor({ timeout: 30000 })]);
    if (await code.isVisible()) u.secret = (await code.textContent())!.replace(/\s/g, '');
    await page.locator('input').first().click();
    await page.keyboard.type(totp(u.secret!), { delay: 40 });
    await page.waitForURL((x) => !x.pathname.includes('/mfa'), { timeout: 30000 });
  }
  await page.close();
  u.token = await tokenFrom(u.ctx);
  return u;
}
const sb = (u: U) =>
  createClient(SB_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${u.token}` } },
  });
async function api(u: U, method: 'GET' | 'POST', p: string, data?: unknown) {
  const res = await u.ctx!.request.fetch(`${BASE}${p}`, {
    method,
    headers: { Origin: BASE },
    ...(data !== undefined ? { data } : {}),
    maxRedirects: 0,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status(), body, headers: res.headers() };
}
async function notifs(u: U, since: string) {
  const { data } = await admin
    .from('notifications')
    .select('type, title, data, created_at')
    .eq('user_id', u.id)
    .gte('created_at', since)
    .order('created_at');
  return data ?? [];
}
async function pageText(u: U, route: string, wait = 3500) {
  const page = await u.ctx!.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/en${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(wait);
  const text = await page.locator('body').innerText();
  const url = new URL(page.url()).pathname;
  await page.close();
  return { text, url, errors };
}

// ── Journeys ───────────────────────────────────────────────────────────
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
try {
  skew =
    new Date((await fetch(`${SB_URL}/auth/v1/health`)).headers.get('date')!).getTime() - Date.now();
  const A = await signIn(browser, await mkUser('admin', 'adm'));
  const S = await signIn(browser, await mkUser('super_admin', 'sup'));
  const F = await signIn(browser, await mkUser('facilitator', 'fac'));
  const P = await signIn(browser, await mkUser('player', 'ply'));
  const P2 = await signIn(browser, await mkUser('player', 'pl2'));
  const T = await signIn(browser, await mkUser('player', 'tch'));
  let G = '',
    G2 = '',
    joinCode = '';

  await step('1. Facilitator application → admin review → role granted', async () => {
    const since = new Date().toISOString();
    const res = await T.ctx!.request.post(`${BASE}/api/applications`, {
      headers: { Origin: BASE },
      multipart: {
        full_name: 'QA Teacher',
        organization: 'Pila QA School',
        position: 'Science Teacher',
        contact: '0917 000 0000',
        reason: 'Class drills for grade 9.',
        website: '',
      },
    });
    check('applicant can submit application', res.status() === 200, await res.text());
    const { data: app } = await admin
      .from('facilitator_applications')
      .select('id, status')
      .eq('user_id', T.id)
      .single();
    check('application stored as pending', app?.status === 'pending', app);
    const adminNotes = await eventually(
      () => notifs(A, since),
      (n) => n.some((x) => x.type === 'application_new'),
    );
    check(
      'admins are notified of the new application',
      adminNotes.some((x) => x.type === 'application_new'),
      adminNotes,
    );
    const queue = await sb(A).from('facilitator_applications').select('id').eq('status', 'pending');
    check(
      'admin sees it in the review queue (RLS)',
      !!queue.data?.some((x) => x.id === app!.id),
      queue.error,
    );
    const dup = await T.ctx!.request.post(`${BASE}/api/applications`, {
      headers: { Origin: BASE },
      multipart: {
        full_name: 'QA Teacher',
        organization: 'Pila QA School',
        position: 'Teacher',
        contact: '0917 000 0000',
        reason: 'Duplicate attempt here.',
      },
    });
    check(
      'duplicate pending application is rejected cleanly (409)',
      dup.status() === 409,
      dup.status(),
    );
    const decided = await callFunction('approve-facilitator', A.token!, {
      application_id: app!.id,
      decision: 'approve',
    });
    check('admin approval succeeds', decided.status === 200, decided.body);
    const { data: roles } = await admin.from('user_roles').select('role_id').eq('user_id', T.id);
    check('applicant now has the facilitator role', !!roles?.some((r) => r.role_id === 3), roles);
    const tNotes = await eventually(
      () => notifs(T, since),
      (n) => n.some((x) => /approv/i.test(x.type)),
    );
    check(
      'applicant is notified of the decision',
      tNotes.some((x) => /approv/i.test(x.type)),
      tNotes.map((x) => x.type),
    );
    const href = (tNotes.find((x) => /approv/i.test(x.type))?.data as { href?: string } | null)
      ?.href;
    check(
      'decision notification links somewhere useful',
      !!href && /\/(mfa|facilitator)/.test(href),
      href,
    );
    const apply = await pageText(T, '/apply');
    check(
      "applicant's status page shows Approved",
      /approved/i.test(apply.text),
      apply.text.slice(0, 200),
    );
    const { data: audit } = await admin
      .from('audit_logs')
      .select('action')
      .eq('target_id', app!.id);
    check('decision is audit-logged', (audit?.length ?? 0) > 0, audit);
  });

  await step(
    '2. Facilitator creates group → student joins by code → roster & notifications',
    async () => {
      const since = new Date().toISOString();
      const { data: g, error } = await sb(F)
        .from('groups')
        .insert({ name: `QA Class ${tag}` })
        .select('id, join_code')
        .single();
      check('facilitator can create a group', !error && !!g, error);
      G = g!.id;
      joinCode = g!.join_code;
      created.groups.push(G);
      check('join code is generated', /^[A-Z2-9]{6}$/.test(joinCode), joinCode);
      const bad = await api(P, 'POST', '/api/groups/join', { code: 'ZZZZZ2' });
      check(
        'wrong code is rejected with a clear error (not 500)',
        bad.status >= 400 && bad.status < 500,
        bad,
      );
      const j = await api(P, 'POST', '/api/groups/join', { code: joinCode });
      check(
        'student joins with the code',
        j.status === 200 && j.body?.data?.status === 'active',
        j.body,
      );
      const again = await api(P, 'POST', '/api/groups/join', { code: joinCode });
      check(
        'joining twice is idempotent',
        again.status === 200 && again.body?.data?.already === true,
        again.body,
      );
      const roster = await sb(F).rpc('get_group_roster', { p_group_id: G });
      check(
        'student appears in the facilitator roster',
        !!roster.data?.some((r: { user_id: string }) => r.user_id === P.id),
        roster.error,
      );
      // DECISION (by design): open-group joins don't ping the facilitator (a class of 40 would be
      // 40 notifications); the roster updates live instead. Join *requests* do notify (journey 3).
      const mine = await pageText(P, '/groups');
      check(
        "group shows on the student's Groups page",
        mine.text.includes(`QA Class ${tag}`),
        mine.text.slice(0, 300),
      );
      const detail = await pageText(P, `/groups/${G}`);
      check(
        'student can open the group page',
        detail.url.endsWith(G) && detail.errors.length === 0,
        detail.errors,
      );
      const other = await sb(P2).from('groups').select('id').eq('id', G);
      check('non-members cannot see the group (RLS)', (other.data?.length ?? 0) === 0, other.data);
      const fac = await pageText(F, `/facilitator/groups/${G}`);
      check(
        'facilitator group page lists the student',
        fac.text.includes(P.username),
        fac.text.slice(0, 300),
      );
    },
  );

  await step(
    '3. Approval-required group → pending → facilitator approves → student notified',
    async () => {
      const { data: g2 } = await sb(F)
        .from('groups')
        .insert({ name: `QA Approval ${tag}`, requires_approval: true })
        .select('id, join_code')
        .single();
      G2 = g2!.id;
      created.groups.push(G2);
      const since = new Date().toISOString();
      const j = await api(P2, 'POST', '/api/groups/join', { code: g2!.join_code });
      check('join request is pending', j.body?.data?.status === 'pending', j.body);
      const fNotes = await eventually(
        () => notifs(F, since),
        (n) => n.length > 0,
      );
      check('facilitator is notified of the join request', fNotes.length > 0, fNotes);
      const upd = await sb(F)
        .from('group_members')
        .update({ status: 'active' })
        .eq('group_id', G2)
        .eq('user_id', P2.id)
        .select('status');
      check(
        'facilitator can approve the request',
        !upd.error && upd.data?.[0]?.status === 'active',
        upd.error,
      );
      const pNotes = await eventually(
        () => notifs(P2, since),
        (n) => n.length > 0,
      );
      check('student is notified of approval', pNotes.length > 0, pNotes);
      const self = await sb(P2)
        .from('group_members')
        .update({ status: 'active' })
        .eq('group_id', G)
        .eq('user_id', P2.id)
        .select();
      check(
        'students cannot self-approve into other groups (RLS)',
        (self.data?.length ?? 0) === 0,
        self.data,
      );
    },
  );

  await step(
    '4. Assignment → student notified → plays → progress, analytics, overview',
    async () => {
      const since = new Date().toISOString();
      const due = new Date(Date.now() + 7 * 864e5).toISOString();
      const { data: asg, error } = await sb(F)
        .from('assignments')
        .insert({
          group_id: G,
          title: `QA Signal 1 drill ${tag}`,
          level_ids: [1],
          min_stars: 1,
          due_at: due,
        })
        .select('id')
        .single();
      check('facilitator creates an assignment', !error && !!asg, error);
      const pNotes = await eventually(
        () => notifs(P, since),
        (n) => n.some((x) => /assign/i.test(x.type)),
      );
      const an = pNotes.find((x) => /assign/i.test(x.type));
      check(
        'student is notified of the assignment',
        !!an,
        pNotes.map((x) => x.type),
      );
      check(
        'assignment notification links to the group',
        (an?.data as { href?: string })?.href === `/groups/${G}`,
        an?.data,
      );
      const seen = await sb(P).from('assignments').select('id').eq('group_id', G);
      check(
        'student can read the assignment (RLS)',
        !!seen.data?.some((x) => x.id === asg!.id),
        seen.error,
      );
      const before = await sb(F).rpc('assignment_progress', { p_assignment_id: asg!.id });
      check(
        'progress starts as not done',
        before.data?.find((r: { user_id: string }) => r.user_id === P.id)?.done === false,
        before,
      );
      const play = await playLevel(P.token!, 1);
      check(
        'student plays the assigned level (server-scored)',
        play.submit?.status === 200 && play.submit.body.data?.result?.outcome === 'completed',
        play.submit?.body ?? play.start.body,
      );
      const newAch = play.submit?.body.data?.new_achievements ?? [];
      const after = await eventually(
        () => sb(F).rpc('assignment_progress', { p_assignment_id: asg!.id }),
        (r) => r.data?.find((x: { user_id: string }) => x.user_id === P.id)?.done === true,
      );
      check(
        'assignment shows as done for the facilitator',
        after.data?.find((r: { user_id: string }) => r.user_id === P.id)?.done === true,
        after.data,
      );
      const mineProg = await sb(P).rpc('assignment_progress', { p_assignment_id: asg!.id });
      check('student sees their own progress', !!mineProg.data?.length, mineProg.error);
      const an2 = await sb(F).rpc('group_analytics', { p_group_id: G });
      check(
        'group analytics include the attempt',
        (an2.data as { attempts?: number })?.attempts! >= 1,
        an2.error ?? an2.data,
      );
      const ov = await sb(F).rpc('facilitator_overview', { p_group_id: G });
      check('facilitator overview works for the group', !ov.error, ov.error);
      const { data: prog } = await admin
        .from('player_level_progress')
        .select('level_id, best_stars')
        .eq('user_id', P.id);
      check(
        'player progress updated (level 1 stars)',
        !!prog?.some((x) => x.level_id === 1 && x.best_stars > 0),
        prog,
      );
      check('next level unlocked', !!prog?.some((x) => x.level_id === 2), prog);
      if (newAch.length) {
        const achN = await eventually(
          () => notifs(P, since),
          (n) => n.some((x) => /achiev/i.test(x.type)),
        );
        check(
          'achievement earned → notification',
          achN.some((x) => /achiev/i.test(x.type)),
          achN.map((x) => x.type),
        );
      }
      // Leaderboards are materialized views refreshed every minute by pg_cron.
      const lb = await eventually(
        () => api(P, 'GET', `/api/leaderboard?scope=group&group=${G}&period=weekly`),
        (r) => !!r.body?.data?.rows?.some((x: { username?: string }) => x.username === P.username),
        75_000,
      );
      check(
        'group leaderboard includes the student (≤ 1 min refresh)',
        !!lb.body?.data?.rows?.some((r: { username?: string }) => r.username === P.username),
        lb.body,
      );
      const home = await pageText(P, '/home');
      check('student home renders after playing', home.errors.length === 0, home.errors);
      const gd = await pageText(P, `/groups/${G}`);
      check(
        'student group page shows the assignment',
        gd.text.includes(`QA Signal 1 drill ${tag}`),
        gd.text.slice(0, 400),
      );
    },
  );

  await step('5. Group announcement → members notified; outsiders cannot read it', async () => {
    const since = new Date().toISOString();
    const { error } = await sb(F)
      .from('announcements')
      .insert({
        scope: 'group',
        group_id: G,
        title: `QA notice ${tag}`,
        body: 'Bring your go-bag tomorrow.',
      });
    check('facilitator posts a group announcement', !error, error);
    const n = await eventually(
      () => notifs(P, since),
      (x) => x.some((y) => y.type === 'announcement'),
    );
    check(
      'member is notified',
      n.some((y) => y.type === 'announcement'),
      n,
    );
    const read = await sb(P).from('announcements').select('id').eq('group_id', G);
    check('member can read it', (read.data?.length ?? 0) > 0, read.error);
    const out = await sb(P2).from('announcements').select('id').eq('group_id', G);
    check('non-member cannot read it (RLS)', (out.data?.length ?? 0) === 0, out.data);
    const sys = await sb(F)
      .from('announcements')
      .insert({ scope: 'system', title: 'nope', body: 'nope' });
    check('facilitators cannot post system-wide announcements', !!sys.error, sys.error);
    const nc = await pageText(P, '/notifications');
    check(
      'notification center lists it',
      nc.text.includes(`QA notice ${tag}`),
      nc.text.slice(0, 300),
    );
  });

  await step('6. Reports: CSV + PDF generated, downloadable, owner-only', async () => {
    for (const type of ['group_csv', 'group_pdf'] as const) {
      const r = await api(F, 'POST', '/api/reports', { type, group_id: G });
      check(`${type} generated`, r.status === 200 && r.body?.data?.status === 'ready', r.body);
      const id = r.body?.data?.job_id;
      if (!id) continue;
      const dl = await api(F, 'GET', `/api/reports/${id}/download`);
      const loc = dl.headers['location'];
      check(`${type} download redirects to a signed URL`, dl.status === 303 && !!loc, dl.status);
      if (loc) {
        const file = await fetch(loc);
        const buf = Buffer.from(await file.arrayBuffer());
        check(`${type} file downloads`, file.ok && buf.length > 50, file.status);
        if (type === 'group_csv')
          check(
            'CSV contains the student',
            buf.toString('utf8').includes(P.username),
            buf.toString('utf8').slice(0, 200),
          );
      }
      const steal = await api(P, 'GET', `/api/reports/${id}/download`);
      check(
        `students cannot download the ${type}`,
        steal.status >= 400 && steal.status !== 500,
        steal.status,
      );
    }
    const other = await api(F, 'POST', '/api/reports', {
      type: 'group_csv',
      group_id: G2 === '' ? G : crypto.randomUUID(),
    });
    check(
      'reports for groups you do not own are refused',
      other.status === 403 || other.status === 404,
      other.status,
    );
  });

  await step(
    '7. Live session: create → student finds it → start → play → end summary',
    async () => {
      const c = await api(F, 'POST', '/api/live', { action: 'create', group_id: G, level_id: 1 });
      check('facilitator creates a live session', c.status === 200 && !!c.body?.data?.code, c.body);
      const sid = c.body?.data?.id as string;
      const code = c.body?.data?.code as string;
      const found = await sb(P)
        .from('live_sessions')
        .select('id, status')
        .eq('code', code)
        .neq('status', 'ended')
        .maybeSingle();
      check('member finds the session by code', found.data?.id === sid, found.error ?? found.data);
      const hidden = await sb(P2).from('live_sessions').select('id').eq('code', code).maybeSingle();
      check('non-members cannot find it', !hidden.data, hidden.data);
      const s = await api(F, 'POST', '/api/live', { action: 'start', session_id: sid });
      check('facilitator starts it', s.body?.data?.status === 'running', s.body);
      const play = await playLevel(P.token!, 1, { mode: 'live', live_session_id: sid });
      check(
        'student plays in the live session',
        play.submit?.status === 200,
        play.submit?.body ?? play.start.body,
      );
      const e = await api(F, 'POST', '/api/live', { action: 'end', session_id: sid });
      check('end summary counts the student', (e.body?.data?.summary?.survived ?? 0) >= 1, e.body);
      const lobby = await pageText(P, '/live');
      check('student live page renders', lobby.errors.length === 0, lobby.errors);
    },
  );

  await step(
    '8. Anti-cheat → moderation queue → admin voids → leaderboard excludes it',
    async () => {
      const t = await playLevel(P.token!, 1, { tamper: true });
      const flags = t.submit?.body.data?.result?.flags ?? [];
      check('tampered run is flagged by the server', flags.length > 0, t.submit?.body);
      const q = await eventually(
        () => sb(A).rpc('flagged_attempts'),
        (r) => !!r.data?.some((x: { id: string }) => x.id === t.attempt_id),
      );
      check(
        'it appears in the admin moderation queue',
        !!q.data?.some((x: { id: string }) => x.id === t.attempt_id),
        q.error,
      );
      const ev = await api(A, 'GET', `/api/admin/attempts/${t.attempt_id}`);
      check(
        'admin can inspect the event log',
        ev.status === 200 && (ev.body?.data?.events?.length ?? 0) > 0,
        ev.status,
      );
      const v = await api(A, 'POST', `/api/admin/attempts/${t.attempt_id}`, {
        action: 'void',
        reason: 'QA tamper test',
      });
      check('admin voids it', v.status === 200, v.body);
      const { data: row } = await admin
        .from('attempts')
        .select('status')
        .eq('id', t.attempt_id!)
        .single();
      check('attempt is voided', row?.status === 'voided', row);
      const pv = await api(P, 'GET', `/api/admin/attempts/${t.attempt_id}`);
      check(
        'players cannot use moderation APIs',
        pv.status === 403 || pv.status === 401,
        pv.status,
      );
      const replay = await callFunction('submit-attempt', P.token!, {
        attempt_id: t.attempt_id,
        attempt_token: t.attempt_token,
        events: t.events,
        idempotency_key: crypto.randomUUID(),
      });
      check('attempt tokens are single-use', replay.status >= 400, replay.status);
    },
  );

  await step('9. Content CMS → players see the change', async () => {
    const slug = `qa-tip-${tag}`;
    const ins = await sb(A)
      .from('tips')
      .insert({
        slug,
        title_fil: `QA Tip ${tag}`,
        title_en: `QA Tip ${tag}`,
        body_fil: 'Pagsubok.',
        body_en: 'Test.',
        category: 'before',
        is_published: true,
      })
      .select('id')
      .single();
    check('admin publishes a tip', !ins.error, ins.error);
    if (ins.data) created.tips.push(ins.data.id);
    const pub = await fetch(`${BASE}/en/tips`).then((r) => r.text());
    check('tip is visible on the public Tips page', pub.includes(`QA Tip ${tag}`));
    const fx = await sb(F).from('tips').update({ title_en: 'hack' }).eq('slug', slug).select();
    check('non-admins cannot edit content (RLS)', (fx.data?.length ?? 0) === 0, fx.data);
  });

  await step('10. Suspension → sessions revoked → restore', async () => {
    const r = await api(A, 'POST', `/api/admin/users/${P2.id}`, {
      action: 'suspend',
      days: 1,
      reason: 'QA suspension test',
    });
    check('admin suspends a player', r.status === 200, r.body);
    const { data: prof } = await admin.from('profiles').select('status').eq('id', P2.id).single();
    check('profile marked suspended', prof?.status === 'suspended', prof);
    const pg = await pageText(P2, '/home', 1500);
    check(
      'suspended player is locked out of the app',
      /\/(suspended|sign-in)/.test(pg.url),
      pg.url,
    );
    const u = await api(A, 'POST', `/api/admin/users/${P2.id}`, { action: 'unsuspend' });
    check('admin restores the player', u.status === 200, u.body);
    const ctx2 = await browser.newContext();
    const re = await ctx2.request.post(`${BASE}/api/auth/password`, {
      headers: { Origin: BASE },
      data: { identifier: P2.username, password: P2.password },
    });
    check('restored player can sign in again', re.status() === 200, re.status());
    await ctx2.close();
    const f = await api(F, 'POST', `/api/admin/users/${P2.id}`, {
      action: 'suspend',
      days: 1,
      reason: 'nope nope',
    });
    check('facilitators cannot suspend users', f.status === 403 || f.status === 401, f.status);
    const self = await api(A, 'POST', `/api/admin/users/${S.id}`, {
      action: 'suspend',
      days: 1,
      reason: 'QA escalate',
    });
    check('admins cannot suspend a super admin', self.status >= 400, self.status);
  });

  await step('11. Super admin & sensitive actions are guarded', async () => {
    const sa = await api(S, 'POST', '/api/super/admins', { user_id: P.id, make_admin: true });
    check(
      'promoting an admin requires fresh re-auth',
      sa.status === 401 || sa.status === 403,
      sa.body,
    );
    const aa = await api(A, 'POST', '/api/super/admins', { user_id: P.id, make_admin: true });
    check('admins cannot manage admins', aa.status === 403 || aa.status === 401, aa.status);
    const sec = await sb(S).rpc('security_overview');
    check('super admin security overview loads', !sec.error, sec.error);
    const secA = await sb(A).rpc('security_overview');
    check('admins cannot load the security overview', !!secA.error, secA.data);
    const flags = await fetch(
      `${SB_URL}/rest/v1/system_settings?select=key,value&key=in.(maintenance,require_staff_mfa)`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
    ).then((r) => r.json());
    check(
      'middleware can read maintenance + MFA flags (public settings)',
      Array.isArray(flags) && flags.length === 2,
      flags,
    );
    const del = await api(P, 'POST', '/api/account/delete', {});
    check(
      'account deletion requires re-auth (not 500)',
      del.status >= 400 && del.status < 500,
      del,
    );
    const exp = await api(P, 'POST', '/api/account/export', {});
    check('data export responds (ok or re-auth), never 500', exp.status < 500, exp);
  });

  await step('12. Settings & notifications sync across devices', async () => {
    const cur = await sb(P)
      .from('user_settings')
      .select('notifications')
      .eq('user_id', P.id)
      .single();
    check('player can read their settings', !cur.error && !!cur.data, cur.error);
    const merged = { ...((cur.data?.notifications as object) ?? {}), push: false };
    const up = await sb(P)
      .from('user_settings')
      .update({ notifications: merged })
      .eq('user_id', P.id)
      .select('notifications');
    check('player updates settings', !up.error, up.error);
    const ctx2 = await browser.newContext();
    const r = await ctx2.request.post(`${BASE}/api/auth/password`, {
      headers: { Origin: BASE },
      data: { identifier: P.username, password: P.password },
    });
    const other = { ...P, ctx: ctx2, token: await tokenFrom(ctx2) };
    const s2 = await sb(other)
      .from('user_settings')
      .select('notifications')
      .eq('user_id', P.id)
      .single();
    check(
      'second device sees the same settings',
      r.status() === 200 && (s2.data?.notifications as { push?: boolean })?.push === false,
      s2.data,
    );
    const { data: unread } = await sb(P).from('notifications').select('id').is('read_at', null);
    const mark = await sb(P)
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null)
      .select('id');
    check(
      'mark-all-read works',
      !mark.error && (mark.data?.length ?? 0) === (unread?.length ?? 0),
      mark.error,
    );
    const s3 = await sb(other).from('notifications').select('id').is('read_at', null);
    check(
      'read state is synced to the other device',
      (s3.data?.length ?? 1) === 0,
      s3.data?.length,
    );
    await ctx2.close();
  });

  await step(
    "13. Data isolation: outsiders and anonymous visitors see nobody else's data",
    async () => {
      const Z = await signIn(browser, await mkUser('player', 'iso'));
      const anon = createClient(SB_URL, ANON, { auth: { persistSession: false } });
      // [table, owner column] — every user-scoped table/view exposed through the API.
      const TABLES: [string, string][] = [
        ['attempts', 'user_id'],
        ['audit_logs', 'actor_id'],
        ['email_outbox', 'user_id'],
        ['facilitator_applications', 'user_id'],
        ['group_members', 'user_id'],
        ['group_progress_view', 'user_id'],
        ['groups', 'facilitator_id'],
        ['announcements', 'created_by'],
        ['assignments', 'created_by'],
        ['live_sessions', 'created_by'],
        ['notifications', 'user_id'],
        ['player_achievements', 'user_id'],
        ['player_level_progress', 'user_id'],
        ['player_tips', 'user_id'],
        ['profiles', 'id'],
        ['report_jobs', 'requested_by'],
        ['streaks', 'user_id'],
        ['user_devices', 'user_id'],
        ['user_roles', 'user_id'],
        ['user_settings', 'user_id'],
        ['leaderboard_weekly', 'user_id'],
        ['leaderboard_all_time', 'user_id'],
      ];
      for (const [table, col] of TABLES) {
        const z = await sb(Z).from(table).select(col).neq(col, Z.id).limit(3);
        check(
          `${table}: outsider sees no one else's rows`,
          !z.data?.length,
          z.data ?? z.error?.code,
        );
        const a = await anon.from(table).select(col).limit(3);
        check(`${table}: anonymous sees nothing`, !a.data?.length, a.data);
      }
      // Writes into other users' data must fail too.
      const w1 = await sb(Z)
        .from('notifications')
        .insert({ user_id: P.id, type: 'x', title: 'spoof', body: 'spoof' });
      check('cannot create notifications for others', !!w1.error, w1.error);
      const w2 = await sb(Z).from('user_roles').insert({ user_id: Z.id, role_id: 4 });
      check('cannot self-grant admin', !!w2.error, w2.error);
      const w3 = await sb(Z)
        .from('profiles')
        .update({ status: 'active', username: 'hijack' })
        .eq('id', P.id)
        .select();
      check('cannot edit another profile', !w3.data?.length, w3.data);
      const w4 = await sb(Z)
        .from('attempts')
        .insert({ user_id: Z.id, level_id: 1, score: 99999, status: 'completed' });
      check('cannot insert attempts directly (server-scored only)', !!w4.error, w4.error);
      const w5 = await sb(Z)
        .from('group_members')
        .insert({ group_id: G, user_id: Z.id, status: 'active' });
      check('cannot join a group without its code', !!w5.error, w5.error);
    },
  );

  await step('14. Guest progress migrates on sign-up; daily challenge is playable', async () => {
    const N = await signIn(browser, await mkUser('player', 'new'));
    // A guest plays Signal 1 locally (no server attempt), then signs up.
    const cfgStart = await callFunction('start-attempt', N.token!, {
      level_id: 1,
      device_id: 'cfg',
    });
    const config = cfgStart.body.data?.config;
    check('level config is served', !!config, cfgStart.body);
    const good = buildRun(config, '424242');
    const bad = buildRun(config, '777', true);
    const mig = await callFunction('guest-migrate', N.token!, {
      attempts: [
        {
          level_id: 1,
          seed: '424242',
          events: good.events,
          client_summary: { score: 0, stars: 3, outcome: 'completed', durationMs: good.durationMs },
        },
        {
          level_id: 1,
          seed: '777',
          events: bad.events,
          client_summary: {
            score: 99999,
            stars: 3,
            outcome: 'completed',
            durationMs: bad.durationMs,
          },
        },
      ],
    });
    check('guest-migrate accepts the guest runs', mig.status === 200, mig.body);
    const { data: prog } = await admin
      .from('player_level_progress')
      .select('level_id, best_stars')
      .eq('user_id', N.id);
    check(
      'valid guest run becomes real progress',
      !!prog?.some((p) => p.level_id === 1 && p.best_stars > 0),
      prog,
    );
    const { data: kept } = await admin
      .from('attempts')
      .select('flag_reasons')
      .eq('user_id', N.id)
      .neq('status', 'in_progress')
      .neq('status', 'abandoned');
    check(
      'tampered guest run is discarded, not stored',
      !kept?.some((a) => (a.flag_reasons as string[]).length > 0),
      kept,
    );

    // Daily challenge: today's level (Manila date) must be playable from the Daily page.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    const { data: daily } = await admin
      .from('daily_challenges')
      .select('level_id')
      .eq('date', today)
      .maybeSingle();
    check("today's daily challenge exists (cron)", !!daily, today);
    if (daily) {
      const d = await playLevel(N.token!, daily.level_id, { mode: 'daily' });
      check(
        'a new player can play the daily challenge',
        d.submit?.status === 200,
        d.submit?.body ?? d.start.body,
      );
      const lb = await api(N, 'GET', '/api/leaderboard?period=daily');
      check(
        'daily leaderboard shows it immediately',
        !!lb.body?.data?.rows?.some((r: { username?: string }) => r.username === N.username),
        lb.body,
      );
      const pg = await pageText(N, '/daily');
      check('daily page renders', pg.errors.length === 0, pg.errors);
    }

    // A teacher assigns a level the student hasn't unlocked (Signal 3).
    const { data: lvl3 } = await admin.from('levels').select('id, slug').eq('id', 3).single();
    const { data: asg3 } = await sb(F)
      .from('assignments')
      .insert({
        group_id: G,
        title: `QA locked level ${tag}`,
        level_ids: [3],
        min_stars: 1,
        due_at: new Date(Date.now() + 864e5).toISOString(),
      })
      .select('id')
      .single();
    const { data: p3 } = await admin
      .from('player_level_progress')
      .select('unlocked')
      .eq('user_id', P.id)
      .eq('level_id', 3)
      .maybeSingle();
    check('precondition: student has not unlocked Signal 3', !p3?.unlocked, p3);
    const locked = await callFunction('start-attempt', P.token!, { level_id: 3, device_id: 'x' });
    check(
      'Signal 3 stays locked in normal play',
      locked.body.error?.message === 'errors.level_locked',
      locked.body,
    );
    const viaAsg = await playLevel(P.token!, 3, { mode: 'assignment', assignment_id: asg3!.id });
    check(
      'assigned locked level is playable via the assignment',
      viaAsg.submit?.status === 200,
      viaAsg.submit?.body ?? viaAsg.start.body,
    );
    const page = await pageText(
      P,
      `/play/${lvl3!.slug}?mode=assignment&assignment=${asg3!.id}`,
      2500,
    );
    check(
      'assignment play page opens (no locked redirect)',
      page.url.endsWith(`/play/${lvl3!.slug}`),
      page.url,
    );
    const outsider = await playLevel(P2.token!, 3, { mode: 'assignment', assignment_id: asg3!.id });
    check(
      "non-members cannot use someone else's assignment to unlock",
      outsider.start.body.error?.message === 'errors.level_locked',
      outsider.start.body,
    );
    const gd = await pageText(P, `/groups/${G}`);
    check('group page links assignments with their context', gd.text.length > 0);
  });
} finally {
  // ── Cleanup ──
  for (const id of created.tips) await admin.from('tips').delete().eq('id', id);
  for (const g of created.groups) {
    await admin.from('live_sessions').delete().eq('group_id', g);
    await admin.from('groups').delete().eq('id', g);
  }
  for (const u of created.users) {
    await u.ctx?.close().catch(() => {});
    await admin.from('report_jobs').delete().eq('requested_by', u.id);
    await admin.from('facilitator_applications').delete().eq('user_id', u.id);
    await admin.from('attempts').delete().eq('user_id', u.id);
    await admin.from('user_roles').delete().eq('user_id', u.id);
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) console.log('cleanup failed for', u.username, error.message);
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n══ ${results.length - failed.length}/${results.length} checks passed`);
  for (const f of failed)
    console.log(`  ✘ [${f.journey}] ${f.check}${f.detail ? ` → ${f.detail}` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
}
