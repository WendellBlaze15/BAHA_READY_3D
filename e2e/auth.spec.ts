import { expect, test } from '@playwright/test';

test.describe('auth forms', () => {
  test('sign-in validates the email client-side', async ({ page }) => {
    await page.goto('/en/sign-in');
    const email = page.getByRole('textbox', { name: /email/i });
    await email.fill('not-an-email');
    await email.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: /valid email/i })).toBeVisible();
  });

  test('honeypot is off-screen and hidden from assistive tech', async ({ page }) => {
    await page.goto('/en/sign-up');
    const hp = page.locator('input[name="website"]');
    await expect(hp).toHaveAttribute('tabindex', '-1');
    const box = await hp.boundingBox();
    expect(box === null || box.x + box.width < 0).toBe(true);
    await expect(page.locator('[aria-hidden="true"]:has(input[name="website"])')).toHaveCount(1);
  });

  test('keyboard: skip link is the first stop on content pages', async ({ page }) => {
    await page.goto('/en/tips');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /skip/i })).toBeFocused();
  });

  test('sign-up offers a facilitator path that carries next=/apply', async ({ page }) => {
    await page.goto('/en/sign-up');
    await page
      .getByRole('link', { name: /facilitator/i })
      .first()
      .click();
    await expect(page).toHaveURL(/next=(%2F|\/)apply/);
    await expect(page.getByText(/an admin approves your account/i)).toBeVisible();
  });
});
