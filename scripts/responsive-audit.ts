// Responsive + accessibility audit of the game screens (Signal levels and Survival).
// For each viewport it opens the screens, takes a screenshot and flags:
//   overlap  — two different texts drawn on top of each other
//   clipped  — text cut off by its container or by the screen edge
//   control  — a button/toggle/link that is off-screen, covered by or overlapping another
//              control or text, or smaller than a 24px tap target (WCAG 2.5.8)
//   hscroll  — the page scrolls sideways
// and runs axe (WCAG 2.1 AA, serious/critical) on the non-3D pages.
// A temporary @test.local player is created and deleted afterwards.
// Usage: BASE=http://localhost:3000 node scripts/with-env.mjs node --import tsx scripts/responsive-audit.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Browser, type Page } from '@playwright/test';

const requireWeb = createRequire(path.resolve('apps/web/package.json'));
const { createClient } = requireWeb(
  '@supabase/supabase-js',
) as typeof import('@supabase/supabase-js');
const BASE = process.env.BASE ?? 'http://localhost:3000';
const OUT = 'test-results/responsive';
fs.mkdirSync(OUT, { recursive: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const VIEWPORTS = [
  { name: 'phone-portrait', width: 360, height: 640, mobile: true },
  { name: 'phone-landscape', width: 740, height: 360, mobile: true },
  { name: 'tablet', width: 768, height: 1024, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];
const ONLY = process.env.SCREENS?.split(',');
const ONLY_VP = process.env.VIEWPORTS?.split(',');

type Kind = 'overlap' | 'clipped' | 'control' | 'hscroll';
type Issue = { kind: Kind | 'axe'; detail: string };

/** Runs in the page: finds overlapping / clipped text and sideways scrolling. */
function layoutIssues(
  atBottom: boolean,
): { kind: 'overlap' | 'clipped' | 'control' | 'hscroll'; detail: string }[] {
  const out: { kind: 'overlap' | 'clipped' | 'control' | 'hscroll'; detail: string }[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const label = (el: Element) => {
    const t = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `"${t}" <${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}>`;
  };
  const visible = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05)
        return false;
    }
    return true;
  };
  const fixedish = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  };
  // Page content scrolling under fixed UI (bottom nav, header) is normal; it is a bug only if
  // it is still under the fixed UI at the very bottom of the page. So: the top-of-page pass
  // checks fixed↔fixed and flow↔flow pairs, the bottom pass checks only fixed↔flow pairs.
  const pairOk = (a: Element, b: Element) => (fixedish(a) !== fixedish(b)) === atBottom;
  /** Big layers (full-screen game / story) hide whatever is under them; that's not a bug. */
  const isLayer = (e: Element) => {
    const b = e.getBoundingClientRect();
    if (b.width * b.height < vw * vh * 0.45) return false;
    if (e.tagName === 'CANVAS') return true;
    // Only an opaque panel hides what is under it (a big transparent wrapper does not).
    const m = getComputedStyle(e).backgroundColor.match(/[\d.]+/g);
    const alpha = !m ? 0 : m.length === 4 ? Number(m[3]) : 1;
    return alpha >= 0.5;
  };
  const coveredByLayer = (el: Element, r: DOMRect) => {
    const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(x, y);
    if (!top || el.contains(top) || top.contains(el)) return false;
    if (top.closest('nextjs-portal')) return true; // dev-only badge
    // Walk the paint stack down to el: any opaque full-screen layer above it hides it.
    for (const hit of document.elementsFromPoint(x, y)) {
      if (el.contains(hit) || hit.contains(el)) break;
      for (let e: Element | null = hit; e; e = e.parentElement)
        if (isLayer(e) && !e.contains(el)) return true;
    }
    return false;
  };
  /** Bottom pass: only the bottom half (bottom nav, floating buttons) matters. */
  const lowEnough = (a: DOMRect, b: DOMRect) => !atBottom || Math.max(a.top, b.top) > vh / 2;
  const inScroll = (el: Element) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) return true;
    }
    return false;
  };
  // Text boxes: the union of an element's own text nodes (not its block box).
  const items: { el: Element; r: DOMRect }[] = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('script,style,noscript,nextjs-portal,[data-audit-ignore],.sr-only')) continue;
    const nodes = [...el.childNodes].filter(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim(),
    );
    if (!nodes.length || !visible(el)) continue;
    const range = document.createRange();
    let r: DOMRect | null = null;
    for (const n of nodes) {
      range.selectNodeContents(n);
      const b = range.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      r = r
        ? new DOMRect(
            Math.min(r.left, b.left),
            Math.min(r.top, b.top),
            Math.max(r.right, b.right) - Math.min(r.left, b.left),
            Math.max(r.bottom, b.bottom) - Math.min(r.top, b.top),
          )
        : b;
    }
    // Text shortened with "…" is drawn only inside its own box.
    if (r && getComputedStyle(el).textOverflow === 'ellipsis') {
      const b = el.getBoundingClientRect();
      const left = Math.max(r.left, b.left);
      const right = Math.min(r.right, b.right);
      r = new DOMRect(left, r.top, Math.max(0, right - left), r.height);
    }
    if (r && r.width > 0 && !coveredByLayer(el, r)) items.push({ el, r });
  }
  // With a dialog/sheet open, everything behind it is inert: audit only the dialog.
  const dialog = document.querySelector('[role=dialog][data-state=open],[role=dialog][open]');
  if (dialog) {
    for (let i = items.length - 1; i >= 0; i--)
      if (!dialog.contains(items[i]!.el)) items.splice(i, 1);
  }
  for (const { el, r } of atBottom ? [] : items) {
    // Cut by the screen edge (horizontally always; vertically only for fixed UI).
    if (
      !inScroll(el) &&
      (r.left < -1 || r.right > vw + 1 || (fixedish(el) && (r.top < -1 || r.bottom > vh + 1)))
    )
      out.push({ kind: 'clipped', detail: `${label(el)} off-screen` });
    // Cut by a container that hides overflow (scroll containers and ellipsis are fine).
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) break; // reachable by scrolling
      if (!clipX && !clipY) continue;
      if (getComputedStyle(el).textOverflow === 'ellipsis') break;
      const b = a.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) break; // visually-hidden helpers
      if (
        (clipX && (r.left < b.left - 2 || r.right > b.right + 2)) ||
        (clipY && (r.top < b.top - 2 || r.bottom > b.bottom + 2))
      )
        out.push({ kind: 'clipped', detail: `${label(el)} cut by its container` });
      break;
    }
  }
  // Texts drawn over each other (ignore nested elements of the same text).
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i]!;
      const B = items[j]!;
      if (A.el.contains(B.el) || B.el.contains(A.el) || !pairOk(A.el, B.el) || !lowEnough(A.r, B.r))
        continue;
      const w = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      const h = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      if (w > 3 && h > 3) {
        // Only if both are actually painted there (one is not hidden under a panel).
        const cx = Math.max(A.r.left, B.r.left) + w / 2;
        const cy = Math.max(A.r.top, B.r.top) + h / 2;
        const top = document.elementFromPoint(cx, cy);
        if (!top) continue;
        out.push({ kind: 'overlap', detail: `${label(A.el)} ⟷ ${label(B.el)}` });
      }
    }
  // Buttons, toggles, links and inputs.
  const ctrls: { el: Element; r: DOMRect }[] = [];
  const CTRL =
    'button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=switch],[role=tab],[role=slider],[role=checkbox],[role=radio],[role=application]';
  for (const el of document.body.querySelectorAll(CTRL)) {
    if (el.closest('[data-audit-ignore],[inert]') || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || coveredByLayer(el, r)) continue;
    if (dialog && !dialog.contains(el)) continue;
    // Controls inside a nested control (e.g. a label link in a button) count once.
    if (el.parentElement?.closest(CTRL)) continue;
    ctrls.push({ el, r });
  }
  const name = (el: Element) =>
    (el.getAttribute('aria-label') ?? el.textContent ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 30) || `<${el.tagName.toLowerCase()}>`;
  for (const { el, r } of ctrls) {
    const inScroller = (() => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) return true;
      }
      return false;
    })();
    if (
      !atBottom &&
      !inScroller &&
      (r.left < -1 || r.right > vw + 1 || (fixedish(el) && (r.top < -1 || r.bottom > vh + 1)))
    )
      out.push({ kind: 'control', detail: `"${name(el)}" is off-screen` });
    const inline = getComputedStyle(el).display === 'inline' && el.tagName === 'A';
    if (!atBottom && !inline && (r.width < 24 || r.height < 24))
      out.push({
        kind: 'control',
        detail: `"${name(el)}" tap target ${Math.round(r.width)}×${Math.round(r.height)}px`,
      });
    // Covered by something else at its centre (e.g. a HUD panel over a button).
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    if (r.top >= 0 && r.bottom <= vh) {
      const top = document.elementFromPoint(cx, cy);
      if (
        top &&
        !el.contains(top) &&
        !top.contains(el) &&
        pairOk(el, top) &&
        lowEnough(r, r) &&
        !top.closest('nextjs-portal,[role=dialog],[data-state=open]')
      )
        out.push({ kind: 'control', detail: `"${name(el)}" is covered by ${label(top)}` });
    }
  }
  for (let i = 0; i < ctrls.length; i++)
    for (let j = i + 1; j < ctrls.length; j++) {
      const A = ctrls[i]!;
      const B = ctrls[j]!;
      if (!pairOk(A.el, B.el) || !lowEnough(A.r, B.r)) continue;
      const w = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      const h = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      if (w > 2 && h > 2)
        out.push({ kind: 'control', detail: `"${name(A.el)}" overlaps "${name(B.el)}"` });
    }
  for (const c of ctrls)
    for (const t of items) {
      if (c.el.contains(t.el) || t.el.contains(c.el) || !pairOk(c.el, t.el) || !lowEnough(c.r, t.r))
        continue;
      const w = Math.min(c.r.right, t.r.right) - Math.max(c.r.left, t.r.left);
      const h = Math.min(c.r.bottom, t.r.bottom) - Math.max(c.r.top, t.r.top);
      if (w > 3 && h > 3)
        out.push({ kind: 'control', detail: `"${name(c.el)}" sits on text ${label(t.el)}` });
    }
  if (!atBottom && document.documentElement.scrollWidth > vw + 1)
    out.push({
      kind: 'hscroll',
      detail: `page is ${document.documentElement.scrollWidth}px wide (viewport ${vw}px)`,
    });
  return out;
}

async function audit(page: Page, screen: string, vp: string, axe: boolean) {
  // tsx (esbuild keepNames) wraps functions in __name(); give the page a no-op.
  await page.evaluate('window.__name = window.__name || ((f) => f)');
  const issues: Issue[] = await page.evaluate(layoutIssues, false);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  issues.push(...(await page.evaluate(layoutIssues, true)));
  await page.evaluate(() => window.scrollTo(0, 0));
  if (axe) {
    const r = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .exclude('canvas')
      .analyze();
    for (const v of r.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')))
      issues.push({ kind: 'axe', detail: `${v.id}: ${v.nodes[0]?.target.join(' ')}` });
  }
  await page.screenshot({ path: `${OUT}/${screen}-${vp}.png` });
  const uniq = [...new Map(issues.map((i) => [`${i.kind}${i.detail}`, i])).values()];
  console.log(`${uniq.length ? '✘' : '✔'} ${screen} @ ${vp}${uniq.length ? '' : ' — clean'}`);
  for (const i of uniq) console.log(`    ${i.kind}: ${i.detail}`);
  return uniq.length;
}

async function main(
  browser: Browser,
  user: { username: string; password: string },
  endRuns: () => Promise<void>,
) {
  let total = 0;
  // Sign in once (the password limit is 10 per 15 min) and reuse the session cookies.
  const login = await browser.newContext();
  const r = await login.request.post(`${BASE}/api/auth/password`, {
    headers: { Origin: BASE },
    data: { identifier: user.username, password: user.password },
  });
  if (r.status() !== 200) throw new Error(`sign-in: ${r.status()}`);
  const storageState = await login.storageState();
  await login.close();
  for (const vp of VIEWPORTS.filter((v) => !ONLY_VP || ONLY_VP.includes(v.name))) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      reducedMotion: 'reduce',
      storageState,
    });
    await ctx.addInitScript(() => {
      (window as unknown as { __BAHA_E2E__: boolean }).__BAHA_E2E__ = true;
    });
    const page = await ctx.newPage();
    const want = (s: string) => !ONLY || ONLY.includes(s);

    for (const [screen, url] of [
      ['home', '/en/home'],
      ['levels', '/en/levels'],
      ['survival-hub', '/en/survival'],
      ['survival-new', '/en/survival/new'],
      ['survival-leaderboard', '/en/survival/leaderboard'],
    ] as const) {
      if (!want(screen)) continue;
      await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.locator('main').first().waitFor({ timeout: 60_000 });
      // Skeletons gone (data loaded).
      await page
        .locator('[aria-busy=true],[data-skeleton]')
        .first()
        .waitFor({ state: 'detached', timeout: 20_000 })
        .catch(() => {});
      await page.waitForTimeout(1200);
      total += await audit(page, screen, vp.name, true);
    }

    // Signal level: briefing, then the 3D HUD.
    if (want('level-briefing') || want('level-hud')) {
      await page.goto(`${BASE}/en/play/tutorial`, {
        waitUntil: 'domcontentloaded',
        timeout: 120_000,
      });
      const start = page.getByRole('button', { name: /start/i }).first();
      await start.waitFor({ timeout: 120_000 });
      await page.waitForTimeout(800);
      if (want('level-briefing')) total += await audit(page, 'level-briefing', vp.name, true);
      await start.click();
      await page.locator('canvas').first().waitFor({ timeout: 120_000 });
      await page.waitForTimeout(6000); // past the 3-2-1 countdown
      if (want('level-hud')) total += await audit(page, 'level-hud', vp.name, false);
    }

    // Survival: solo lobby → story → in-game HUD → chat sheet.
    if (want('survival-lobby') || want('survival-hud')) {
      await endRuns(); // max 3 unfinished games per player
      await page.goto(`${BASE}/en/survival/new`, {
        waitUntil: 'domcontentloaded',
        timeout: 120_000,
      });
      await page.getByRole('button', { name: /^solo/i }).click();
      await page.getByRole('button', { name: /create game/i }).click();
      await page.waitForURL(/\/survival\/room\//, { timeout: 60_000 });
      await page.getByRole('button', { name: /i'm ready/i }).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(800);
      if (want('survival-lobby')) total += await audit(page, 'survival-lobby', vp.name, true);
      await page.getByRole('button', { name: /i'm ready/i }).click();
      await page.getByRole('button', { name: /start the game/i }).click();
      const skip = page.getByRole('button', { name: /^skip$/i });
      await skip.waitFor({ timeout: 30_000 });
      await page.waitForTimeout(500);
      if (want('survival-lobby')) total += await audit(page, 'survival-story', vp.name, true);
      await skip.click();
      await page.locator('canvas').first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(4000);
      if (want('survival-hud')) {
        // A typical notification (e.g. "Get closer.") must not cover the middle.
        await page.evaluate(() =>
          (window as any).__survival?.getState().toast({ tone: 'warn', key: 'denied.too_far' }),
        );
        await page.waitForTimeout(300);
        total += await audit(page, 'survival-hud', vp.name, false);
        await page.getByRole('button', { name: /open chat/i }).click();
        await page.waitForTimeout(600);
        total += await audit(page, 'survival-chat', vp.name, true);
        await page.keyboard.press('Escape');
      }
      // Leave the run so the next viewport can create a new one (max active runs).
      await page.evaluate(async () => {
        const s = (
          window as unknown as { __survival?: { getState(): { room: any } } }
        ).__survival?.getState();
        await s?.room?.leave(true);
      });
    }
    await ctx.close();
  }
  return total;
}

const tag = crypto.randomBytes(3).toString('hex');
const username = `qaresp${tag}`;
const password = crypto.randomBytes(18).toString('base64url') + 'Aa1!';
const { data: u, error } = await admin.auth.admin.createUser({
  email: `${username}@test.local`,
  password,
  email_confirm: true,
});
if (error) throw error;
const now = new Date().toISOString();
await admin
  .from('profiles')
  .update({ username, display_name: username, consent_at: now, onboarded_at: now })
  .eq('id', u.user.id);
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'msedge' }));
let issues = 0;
try {
  issues = await main(browser, { username, password }, async () => {
    await admin
      .from('survival_runs')
      .update({ status: 'abandoned' })
      .eq('host_id', u.user.id)
      .in('status', ['lobby', 'active']);
  });
} catch (e) {
  issues++;
  console.log('✘ audit crashed:', e instanceof Error ? e.message.split('\n')[0] : e);
} finally {
  await browser.close();
  await admin.auth.admin.deleteUser(u.user.id);
}
console.log(issues ? `\n${issues} issue(s) — screenshots in ${OUT}` : '\nno layout or a11y issues');
process.exit(issues ? 1 : 0);
