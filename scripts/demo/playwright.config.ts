import path from 'node:path';
import { defineConfig } from '@playwright/test';

export const RAW_DIR = path.join(process.cwd(), 'docs', 'demo-raw');

export default defineConfig({
  testDir: __dirname,
  testMatch: 'record-demo.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: 'list',
  expect: { timeout: 15_000 },
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:3000',
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--window-size=1300,900'] },
  },
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { BUGREEL_TEST_CDP_PORT: '9333', NEXT_TELEMETRY_DISABLED: '1' },
  },
});
