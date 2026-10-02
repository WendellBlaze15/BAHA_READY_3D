// Survival Mode browser E2E (two real players, real Supabase, local or deployed game server).
// Host creates a co-op game → guest joins via the invite link → roles/ready/start → story →
// 3D game renders → host walks (server position changes) → team chat → screenshots (desktop +
// phone landscape). Temporary @test.local users are deleted afterwards.
// Usage: BASE=http://localhost:3000 node scripts/with-env.mjs tsx scripts/survival-e2e.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

const requireWeb = createRequire(path.resolve('apps/web/package.json'));
const { createClient } = requireWeb(
  '@supabase/supabase-js',
) as typeof import('@supabase/supabase-js');

const BASE = process.env.BASE ?? 'http://localhost:3000';
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  },
);
const OUT = 'test-results/survival';
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(
    `${ok ? '✔' : '✘'} ${name}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`,
  );
};
const users: string[] = [];
const pages: Page[] = [];

async function mkPlayer(label: string) {
  const tag = crypto.randomBytes(3).toString('hex');
  const username = `qasv${label}${tag}`;
  const password = crypto.randomBytes(18).toString('base64url') + 'Aa1!';
  const { data, error } = await admin.auth.admin.createUser({
    email: `${username}@test.local`,
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
  return { id: data.user.id, username, password };
}

async function signIn(ctx: BrowserContext, u: { username: string; password: string }) {
  await ctx.addInitScript(() => {
    (window as unknown as { __BAHA_E2E__: boolean }).__BAHA_E2E__ = true;
  });
  const page = await ctx.newPage();
  pages.push(page);
  page.on('console', (m) => {
    if (m.type() === 'error')
      console.log(`  [console] ${m.text().slice(0, process.env.E2E_FULL ? 3000 : 200)}`);
  });
  const r = await page.request.post(`${BASE}/api/auth/password`, {
    headers: { Origin: BASE },
    data: { identifier: u.username, password: u.password },
  });
  if (r.status() !== 200) throw new Error(`sign-in ${u.username}: ${r.status()}`);
  return page;
}

const myState = (page: Page) =>
  page.evaluate(() => {
    const s = (
      window as unknown as {
        __survival?: { getState(): { room: { state: any } | null; myId: string | null } };
      }
    ).__survival?.getState();
    const st = s?.room?.state;
    const me = s?.myId ? st?.players?.get(s.myId) : null;
    return { phase: st?.phase ?? null, x: me?.x ?? null, z: me?.z ?? null, code: st?.code ?? null };
  });

async function main() {
  // Bundled Chromium if installed, else the system Edge (Chromium) — same engine.
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'msedge' }));
  const [host, guest] = await Promise.all([mkPlayer('h'), mkPlayer('g')]);
  const hctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const gctx = await browser.newContext({
    viewport: { width: 740, height: 360 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  });
  const hp = await signIn(hctx, host);
  const gp = await signIn(gctx, guest);

  // Hub → new game (co-op, normal).
  await hp.goto(`${BASE}/en/survival`, { waitUntil: 'domcontentloaded' });
  await hp.getByRole('link', { name: /new game/i }).click();
  await hp.getByRole('button', { name: /create game/i }).click();
  await hp.waitForURL(/\/survival\/room\//, { timeout: 60_000 });
  await hp
    .getByText(/room code/i)
    .first()
    .waitFor({ timeout: 60_000 });
  const code = (await myState(hp)).code as string;
  check('host created a lobby with a code', /^[A-Z2-9]{6}$/.test(code ?? ''), code);
  await hp.screenshot({ path: `${OUT}/lobby-desktop.png` });

  // Guest opens the invite link (auto-join).
  await gp.goto(`${BASE}/en/survival/join/${code}`, { waitUntil: 'domcontentloaded' });
  await gp.waitForURL(/\/survival\/room\//, { timeout: 60_000 });
  await gp
    .getByText(/players 2\/5/i)
    .first()
    .waitFor({ timeout: 30_000 });
  check('guest joined through the invite link', true);
  await gp.screenshot({ path: `${OUT}/lobby-phone-landscape.png` });

  await hp.getByRole('button', { name: /^medic/i }).click();
  await gp.getByRole('button', { name: /^scout/i }).click();
  await hp.getByRole('button', { name: /i'm ready/i }).click();
  await gp.getByRole('button', { name: /i'm ready/i }).click();
  await hp.getByRole('button', { name: /start the game/i }).click({ timeout: 15_000 });

  // Story → skip for both.
  for (const p of [hp, gp])
    await p.getByRole('button', { name: /^skip$/i }).click({ timeout: 30_000 });
  await hp.locator('canvas').first().waitFor({ timeout: 60_000 });
  await hp
    .getByText(/day 1 ·/i)
    .first()
    .waitFor({ timeout: 60_000 });
  check('game world + HUD render', true);
  await hp.waitForTimeout(2000);
  await hp.screenshot({ path: `${OUT}/game-desktop.png` });
  await gp.screenshot({ path: `${OUT}/game-phone-landscape.png` });

  // Walk forward 1.5 s; the authoritative (server) position must change, no correction.
  const before = await myState(hp);
  await hp
    .locator('canvas')
    .first()
    .click({ position: { x: 640, y: 400 } });
  await hp.keyboard.down('KeyW');
  await hp.waitForTimeout(1500);
  await hp.keyboard.up('KeyW');
  await hp.waitForTimeout(600);
  const after = await myState(hp);
  const moved = Math.hypot((after.x ?? 0) - (before.x ?? 0), (after.z ?? 0) - (before.z ?? 0));
  check('server accepted the walk (moved ≥ 2 m)', moved >= 2, { before, after, moved });

  // Team chat: host → guest.
  await hp.getByRole('button', { name: /open chat/i }).click();
  await hp.getByPlaceholder(/message your team/i).fill('tara sa palengke');
  await hp.getByRole('button', { name: /^send$/i }).click();
  await gp.getByRole('button', { name: /open chat/i }).click();
  await gp.getByText('tara sa palengke').first().waitFor({ timeout: 15_000 });
  check('team chat delivered to the teammate', true);
  await gp.screenshot({ path: `${OUT}/chat-phone-landscape.png` });

  await browser.close();
}

try {
  await main();
} catch (e) {
  failures++;
  console.log(
    '✘ e2e crashed:',
    e instanceof Error ? e.message.split('\n').slice(0, 4).join(' | ') : e,
  );
  for (const [i, p] of pages.entries()) {
    await p.screenshot({ path: `${OUT}/failure-${i}.png` }).catch(() => {});
    console.log(`  page ${i}: ${p.url()}`);
  }
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  console.log(failures ? `\n${failures} check(s) failed` : '\nall survival e2e checks passed');
  process.exit(failures ? 1 : 0);
}
