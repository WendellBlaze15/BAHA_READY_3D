import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PUBLIC = ['/', '/en', '/sign-in', '/sign-up', '/tips', '/hotlines', '/about', '/privacy'];

test.describe('public pages', () => {
  for (const path of PUBLIC) {
    test(`${path} renders with CSP and no serious a11y violations`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      expect(res?.headers()['content-security-policy']).toContain("'strict-dynamic'");
      await expect(page.locator('main, #main').first()).toBeVisible();

      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      const serious = axe.violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      );
      expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
      expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
    });
  }

  test('fil is default, en is prefixed', async ({ browser }) => {
    const page = await (await browser.newContext({ locale: 'fil-PH' })).newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fil');
    await page.goto('/en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('route guards', () => {
  for (const path of ['/home', '/levels', '/settings', '/admin', '/super', '/facilitator']) {
    test(`${path} redirects anonymous users to sign-in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in/);
    });
  }
});

test.describe('security headers & API', () => {
  test('health + hardened headers', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h['strict-transport-security']).toContain('max-age');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-powered-by']).toBeUndefined();
  });

  test('cross-origin POST is rejected', async ({ request }) => {
    const res = await request.post('/api/auth/otp/request', {
      headers: { origin: 'https://evil.example' },
      data: { email: 'x@example.com' },
    });
    expect(res.status()).toBe(403);
  });

  test('unauthenticated API calls get 401', async ({ request, baseURL }) => {
    const res = await request.post('/api/groups/join', {
      headers: { origin: baseURL! },
      data: { code: 'ABC234' },
    });
    expect(res.status()).toBe(401);
  });

  test('assetlinks.json is served for Android App Links', async ({ request }) => {
    const res = await request.get('/.well-known/assetlinks.json');
    expect(res.status()).toBe(200);
    expect(JSON.stringify(await res.json())).toContain('ph.bahaready.app');
  });

  test('manifest is installable', async ({ request }) => {
    const m = await (await request.get('/manifest.webmanifest')).json();
    expect(m.display).toBe('standalone');
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  });
});
