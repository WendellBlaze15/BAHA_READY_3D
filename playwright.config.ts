import { defineConfig, devices } from '@playwright/test';

/**
 * E2E + accessibility suite. Locally it reuses a running server on :3000 (or starts
 * `pnpm start` after a build). Set E2E_BASE_URL to test a deployed environment.
 * PW_CHANNEL=msedge uses installed Edge instead of the bundled Chromium.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: 2, // the WebGL game test is CPU-heavy under SwiftShader
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    channel: process.env.PW_CHANNEL,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL } },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL },
      grepInvert: /@desktop-only/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter @baha/web start',
        url: `${baseURL}/api/health`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
