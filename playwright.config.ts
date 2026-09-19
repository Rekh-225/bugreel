import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:3000', viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure' },
  webServer: {
    command: process.env.BUGREEL_TEST_PRODUCTION === '1' ? 'npm run start' : 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { BUGREEL_TEST_CDP_PORT: '9333', NEXT_TELEMETRY_DISABLED: '1' },
  },
  reporter: 'list',
});
