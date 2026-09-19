import { test, expect, chromium } from '@playwright/test';
import type { Session } from '../src/lib/session';

for (const failing of [true, false]) test(`complete UI workflow: ${failing ? 'SAVE20 reproduces the real failure' : 'healthy checkout is NOT REPRODUCED'}`, async ({ page, request }) => {
  test.setTimeout(90_000);
  const dashboardErrors: string[] = [];
  page.on('pageerror', error => dashboardErrors.push(error.message));
  await page.goto('/');
  await page.getByTestId('start-recording').click();
  await expect(page).toHaveURL(/\/sessions\//);
  const id = page.url().split('/').at(-1)!;
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const store = browser.contexts()[0].pages()[0];
  try {
    await store.getByTestId('add-to-cart').click();
    if (failing) {
      await store.getByTestId('discount-code').pressSequentially('SAVE20');
      await store.getByTestId('apply-discount').click();
      await expect(store.getByTestId('discount-applied')).toBeVisible();
    }
    await store.getByTestId('checkout').click();
    await expect(store.getByTestId(failing ? 'checkout-error' : 'checkout-success')).toBeVisible();
    await page.getByTestId('stop-recording').click();
    await expect(page.getByTestId('session-status')).toHaveText('captured');
    await expect(page.getByTestId('generated-source')).toBeVisible();
    const session: Session = await (await request.get(`/api/sessions/${id}`)).json();
    const displayed = await page.getByTestId('generated-source').textContent();
    const downloaded = await (await request.get(`/api/sessions/${id}/artifacts/reproduction.spec.ts`)).text();
    expect(displayed).toBe(session.generatedTest?.source);
    expect(downloaded).toBe(displayed);
    expect(session.actions.map(action => action.type)).toEqual(failing ? ['goto', 'click', 'fill', 'click', 'click'] : ['goto', 'click', 'click']);
    expect(!!session.failure).toBe(failing);
    await expect(page.getByTestId('recorded-screenshot')).toBeVisible();
    await expect.poll(() => page.getByTestId('recorded-screenshot').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(1000);
    await page.getByTestId('run-reproduction').click();
    await expect(page.getByTestId('replay-status')).toHaveText(failing ? 'REPRODUCTION CONFIRMED' : 'NOT REPRODUCED', { timeout: 70_000 });
    const completed: Session = await (await request.get(`/api/sessions/${id}`)).json();
    expect(completed.latestRun?.sourceHash).toBe(session.generatedTest?.hash);
    expect(completed.latestRun?.screenshot).toBeTruthy();
    expect(completed.latestRun?.status).toBe(failing ? 'confirmed' : 'not_reproduced');
    await page.reload();
    await expect(page.getByTestId('replay-status')).toHaveText(failing ? 'REPRODUCTION CONFIRMED' : 'NOT REPRODUCED');
    expect(dashboardErrors).toEqual([]);
    await page.setViewportSize({ width: 390, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    console.log(`Verified complete ${failing ? 'confirmed' : 'negative'} workflow: http://127.0.0.1:3000/sessions/${id}`);
  } finally {
    await request.post(`/api/sessions/${id}/stop`, { headers: { origin: 'http://127.0.0.1:3000' } });
    await browser.close();
  }
});

test('a real selector failure produces REPLAY ERROR, never confirmation', async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByTestId('start-recording').click();
  await expect(page).toHaveURL(/\/sessions\//);
  const id = page.url().split('/').at(-1)!;
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const store = browser.contexts()[0].pages()[0];
  try {
    await store.getByTestId('add-to-cart').evaluate(element => element.setAttribute('data-testid', 'transient-recorded-selector'));
    await store.getByTestId('transient-recorded-selector').click();
    await store.getByTestId('discount-code').fill('SAVE20');
    await store.getByTestId('apply-discount').click();
    await store.getByTestId('checkout').click();
    await expect(store.getByTestId('checkout-error')).toBeVisible();
    await page.getByTestId('stop-recording').click();
    await expect(page.getByTestId('generated-source')).toContainText('transient-recorded-selector');
    await page.getByTestId('run-reproduction').click();
    await expect(page.getByTestId('replay-status')).toHaveText('REPLAY ERROR', { timeout: 70_000 });
    const completed: Session = await (await request.get(`/api/sessions/${id}`)).json();
    expect(completed.latestRun?.status).toBe('error');
    expect(completed.latestRun?.output).toContain('transient-recorded-selector');
  } finally {
    await request.post(`/api/sessions/${id}/stop`, { headers: { origin: 'http://127.0.0.1:3000' } });
    await browser.close();
  }
});
