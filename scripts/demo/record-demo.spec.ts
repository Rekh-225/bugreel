import fs from 'node:fs';
import path from 'node:path';
import { test, expect, chromium, type Browser } from '@playwright/test';
import type { Session } from '../../src/lib/session';
import { RAW_DIR } from './playwright.config';

const VIEWPORT = { width: 1280, height: 800 };
const RECORD_VIDEO = { dir: RAW_DIR, size: VIEWPORT };

test('records the full BugReel demo workflow', async ({ browser, request }) => {
  fs.rmSync(RAW_DIR, { recursive: true, force: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });

  let id = '';
  let cdp: Browser | undefined;
  const segments: string[] = [];
  try {
    // Segment A: record, generate, and start the reproduction.
    const contextA = await browser.newContext({ viewport: VIEWPORT, recordVideo: RECORD_VIDEO });
    const pageA = await contextA.newPage();
    const videoA = pageA.video();
    if (!videoA) throw new Error('recordVideo produced no video for segment A');

    await pageA.goto('/');
    await pageA.waitForTimeout(1500);
    await pageA.getByTestId('start-recording').click();
    await expect(pageA).toHaveURL(/\/sessions\//);
    id = pageA.url().split('/').at(-1)!;
    await pageA.waitForTimeout(2000);

    cdp = await chromium.connectOverCDP('http://127.0.0.1:9333');
    const store = cdp.contexts()[0].pages()[0];
    await store.getByTestId('add-to-cart').click();
    await pageA.waitForTimeout(1200);
    await store.getByTestId('discount-code').pressSequentially('SAVE20', { delay: 90 });
    await store.getByTestId('apply-discount').click();
    await expect(store.getByTestId('discount-applied')).toBeVisible();
    await pageA.waitForTimeout(1200);
    await store.getByTestId('checkout').click();
    await expect(store.getByTestId('checkout-error')).toBeVisible();
    await pageA.waitForTimeout(2500);

    await pageA.getByTestId('stop-recording').click();
    await expect(pageA.getByTestId('session-status')).toHaveText('captured');
    await expect(pageA.getByTestId('generated-source')).toBeVisible();
    await pageA.waitForTimeout(2000);

    await pageA.getByTestId('recorded-screenshot').scrollIntoViewIfNeeded();
    await pageA.waitForTimeout(1800);
    await pageA.getByTestId('generated-source').scrollIntoViewIfNeeded();
    await pageA.waitForTimeout(2500);
    await pageA.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await pageA.waitForTimeout(1200);

    await pageA.getByTestId('run-reproduction').click();
    await expect(pageA.getByTestId('replay-status')).toHaveText('RUNNING REPRODUCTION');
    await pageA.waitForTimeout(2000);
    await contextA.close();
    segments.push(await videoA.path());

    // The replay itself takes ~15s; skip it by polling the API off-camera.
    const deadline = Date.now() + 90_000;
    let latest: Session['latestRun'];
    while (Date.now() < deadline) {
      const session = (await (await request.get(`/api/sessions/${id}`)).json()) as Session;
      latest = session.latestRun;
      if (latest && latest.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (latest?.status !== 'confirmed') {
      throw new Error(`Reproduction did not confirm (status: ${latest?.status ?? 'none'}): ${latest?.message ?? 'no run recorded'}`);
    }

    // Segment B: the confirmed report and the replay screenshot.
    const contextB = await browser.newContext({ viewport: VIEWPORT, recordVideo: RECORD_VIDEO });
    const pageB = await contextB.newPage();
    const videoB = pageB.video();
    if (!videoB) throw new Error('recordVideo produced no video for segment B');
    await pageB.goto(`/sessions/${id}`);
    await expect(pageB.getByTestId('replay-status')).toHaveText('REPRODUCTION CONFIRMED');
    await pageB.waitForTimeout(1500);
    await pageB.locator('details.replay-artifact summary').first().click();
    await pageB.locator('details.replay-artifact').first().scrollIntoViewIfNeeded();
    await pageB.waitForTimeout(2200);
    await pageB.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await expect(pageB.getByTestId('replay-status')).toBeInViewport();
    await pageB.waitForTimeout(3000);
    await contextB.close();
    segments.push(await videoB.path());

    fs.writeFileSync(path.join(RAW_DIR, 'segments.json'), `${JSON.stringify({ segments }, null, 2)}\n`);
  } finally {
    if (id) await request.post(`/api/sessions/${id}/stop`, { headers: { origin: 'http://127.0.0.1:3000' } });
    if (cdp) await cdp.close();
  }
});
