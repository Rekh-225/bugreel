import { defineConfig } from '@playwright/test';

// Chrome extension and portable-core verification. Separate from playwright.config.ts because these tests
// do not need the Next.js server. Build the extension first: npm run ext:build
export default defineConfig({
  testDir: '.',
  testMatch: ['packages/core/tests/**/*.spec.ts', 'apps/extension/tests/**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/extension',
  reporter: 'list',
});
