import { test, expect } from '@playwright/test';

test('browser can capture input, diagnostics, and a screenshot', async ({ page }, testInfo) => {
  const events: string[] = [];
  const errors: string[] = [];
  await page.exposeBinding('__capture', (_, value: string) => events.push(value));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setContent('<button id="verify">Verify browser</button>');
  await page.evaluate(() => document.querySelector('button')!.addEventListener('click', () => {
    (window as unknown as { __capture: (value: string) => void }).__capture('clicked');
    console.error('diagnostic-smoke');
  }));
  await page.locator('#verify').click();
  await expect.poll(() => events).toEqual(['clicked']);
  expect(errors).toContain('diagnostic-smoke');
  await page.screenshot({ path: testInfo.outputPath('browser-smoke.png') });
});
