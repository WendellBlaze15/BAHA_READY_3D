import { expect, test } from '@playwright/test';

// Guest play of the tutorial: loads the lazy 3D engine (Rapier WASM) under the real CSP.
test('@desktop-only guest can start the tutorial', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/en/play/tutorial');
  await page.getByRole('button', { name: /start/i }).first().click({ timeout: 120_000 });
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  expect(errors.filter((e) => !/WebGL|GPU stall|swiftshader/i.test(e))).toEqual([]);
});
