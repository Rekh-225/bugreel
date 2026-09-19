import { test, expect, chromium } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Session } from '../src/lib/session';

test('real UI recording captures the demo failure and persists actual evidence', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByTestId('start-recording').click();
  await expect(page).toHaveURL(/\/sessions\//);
  const id = page.url().split('/').at(-1)!;
  const recordingBrowser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const store = recordingBrowser.contexts()[0].pages()[0];
  try {
    await store.getByTestId('add-to-cart').click();
    await store.getByTestId('discount-code').pressSequentially('SAVE20');
    await store.getByTestId('apply-discount').click();
    await store.getByTestId('checkout').click();
    await expect(store.getByTestId('checkout-error')).toBeVisible();
    await page.getByTestId('stop-recording').click();
    await expect(page.getByTestId('session-status')).toHaveText('captured');
    const session: Session = await (await request.get(`/api/sessions/${id}`)).json();
    expect(session.actions.map(action => action.type)).toEqual(['goto', 'click', 'fill', 'click', 'click']);
    expect(session.actions[2].value).toBe('SAVE20');
    expect(session.failure?.code).toBe('DISCOUNT_CHECKOUT_FAILURE');
    expect(session.failure?.visible).toBe(true);
    expect(session.networkErrors.some(error => error.status === 500 && error.code === 'DISCOUNT_CHECKOUT_FAILURE')).toBe(true);
    expect(session.consoleErrors.some(error => error.message.includes('DISCOUNT_CHECKOUT_FAILURE'))).toBe(true);
    expect(session.screenshots[0].reason).toBe('failure');
    const screenshot = await request.get(`/api/sessions/${id}/artifacts/recorded-failure.png`);
    expect(screenshot.ok()).toBe(true);
    expect((await screenshot.body()).length).toBeGreaterThan(10_000);
    const persisted = JSON.parse(await fs.readFile(path.join('.bugreel', 'sessions', id, 'session.json'), 'utf8'));
    expect(persisted.failure.code).toBe('DISCOUNT_CHECKOUT_FAILURE');
    await expect(page.getByTestId('recorded-screenshot')).toBeVisible();
    console.log(`Verified recorded failure session: ${id}`);
  } finally {
    await request.post(`/api/sessions/${id}/stop`, { headers: { origin: 'http://127.0.0.1:3000' } });
    await recordingBrowser.close();
  }
});

test('recorder captures page exceptions, transport failures, HTTP 404, and navigation', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByTestId('start-recording').click();
  await expect(page).toHaveURL(/\/sessions\//);
  const id = page.url().split('/').at(-1)!;
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const store = browser.contexts()[0].pages()[0];
  try {
    await store.evaluate(() => { setTimeout(() => { throw new Error('recorded-page-exception'); }, 0); });
    await store.route('**/transport-check', route => route.abort('connectionfailed'));
    await store.evaluate(async () => { await fetch('/transport-check').catch(() => {}); await fetch('/missing-evidence-endpoint'); });
    await store.goto('http://127.0.0.1:3000/demo-store?navigation=verified');
    await page.getByTestId('stop-recording').click();
    await expect(page.getByTestId('session-status')).toHaveText('captured');
    const session: Session = await (await request.get(`/api/sessions/${id}`)).json();
    expect(session.consoleErrors.some(error => error.type === 'pageerror' && error.message.includes('recorded-page-exception'))).toBe(true);
    expect(session.networkErrors.some(error => error.kind === 'transport')).toBe(true);
    expect(session.networkErrors.some(error => error.status === 404)).toBe(true);
    expect(session.events.some(event => event.type === 'navigation' && event.url.includes('navigation=verified'))).toBe(true);
    expect(session.failure).toBeUndefined();
  } finally {
    await request.post(`/api/sessions/${id}/stop`, { headers: { origin: 'http://127.0.0.1:3000' } });
    await browser.close();
  }
});
