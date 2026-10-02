// One-off profiler: solo Survival game on a phone-landscape profile, CPU profile for 5 s,
// prints the hottest functions (self time). Temp users are deleted afterwards.
// Usage: BASE=http://localhost:3000 node scripts/with-env.mjs tsx scripts/survival-profile.ts
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

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

type Node = {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount: number;
};

const tag = crypto.randomBytes(3).toString('hex');
const username = `qaprof${tag}`;
const password = crypto.randomBytes(18).toString('base64url') + 'Aa1!';
const { data: u } = await admin.auth.admin.createUser({
  email: `${username}@test.local`,
  password,
  email_confirm: true,
});
const now = new Date().toISOString();
await admin
  .from('profiles')
  .update({ username, display_name: username, consent_at: now, onboarded_at: now })
  .eq('id', u.user!.id);
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'msedge' }));
try {
  const ctx = await browser.newContext({
    viewport: { width: 740, height: 360 },
    isMobile: true,
    hasTouch: true,
  });
  await ctx.addInitScript(
    () => ((window as unknown as { __BAHA_E2E__: boolean }).__BAHA_E2E__ = true),
  );
  const page = await ctx.newPage();
  await page.request.post(`${BASE}/api/auth/password`, {
    headers: { Origin: BASE },
    data: { identifier: username, password },
  });
  await page.goto(`${BASE}/en/survival/new`);
  await page.getByRole('button', { name: /^solo/i }).click();
  await page.getByRole('button', { name: /create game/i }).click();
  await page.waitForURL(/\/survival\/room\//, { timeout: 60_000 });
  await page.getByRole('button', { name: /i'm ready/i }).click();
  await page.getByRole('button', { name: /start the game/i }).click();
  await page.getByRole('button', { name: /^skip$/i }).click({ timeout: 30_000 });
  await page
    .locator('canvas')
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(async (e) => {
      await page.screenshot({ path: 'test-results/survival/profile-fail.png' });
      throw e;
    });
  await page.waitForTimeout(4000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  await page.waitForTimeout(5000);
  const { profile } = (await cdp.send('Profiler.stop')) as {
    profile: { nodes: Node[]; samples: number[] };
  };
  const perf = await page.evaluate(
    () => (window as unknown as { __survivalPerf?: unknown }).__survivalPerf,
  );
  const self = new Map<string, number>();
  const total = profile.nodes.reduce((n, x) => n + x.hitCount, 0);
  for (const n of profile.nodes) {
    const f = n.callFrame;
    const file = f.url.split('/').pop()?.split('?')[0] ?? '';
    const k = `${f.functionName || '(anon)'} ${file}:${f.lineNumber}`;
    self.set(k, (self.get(k) ?? 0) + n.hitCount);
  }
  console.log('perf', JSON.stringify(perf));
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
} finally {
  await browser.close();
  await admin.auth.admin.deleteUser(u.user!.id);
}
