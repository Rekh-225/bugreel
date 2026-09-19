import { defineConfig } from '@playwright/test';
import path from 'node:path';

const sessionDir = process.env.BUGREEL_SESSION_DIR;
if (!sessionDir) throw new Error('BUGREEL_SESSION_DIR must select a generated session.');
const runDir = process.env.BUGREEL_RUN_DIR || path.join(sessionDir, 'standalone-run');

export default defineConfig({
  testDir: sessionDir,
  testMatch: 'reproduction.spec.ts',
  respectGitIgnore: false,
  outputDir: path.join(runDir, 'test-output'),
  reporter: [['json', { outputFile: path.join(runDir, 'result.json') }]],
  workers: 1,
  retries: 0,
  timeout: 30_000,
  globalTimeout: 60_000,
  expect: { timeout: 8000 },
  use: { browserName: 'chromium', headless: process.env.BUGREEL_HEADLESS === '1', viewport: { width: 1280, height: 900 }, actionTimeout: 8000, navigationTimeout: 15_000, serviceWorkers: 'block' },
});
