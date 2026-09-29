import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, extensionIdOf, tabIdFor, test } from './fixtures/extension';
import { skipOnboarding, startRecording, stopRecording } from './fixtures/panel';

// Regenerates docs/extension/store/*.png (1280x800) from the side-panel page loaded as a tab against the synthetic
// demo site. Run with: npm run ext:store-shots. These are real captures of the panel UI, not of Chrome's side-panel
// chrome. Skipped in the normal suite.

test.skip(process.env.BUGREEL_STORE_SHOTS !== '1', 'set BUGREEL_STORE_SHOTS=1 to regenerate store screenshots');

let child: ChildProcess;
const port = 4391;
const origin = `http://127.0.0.1:${port}`;
const out = path.resolve('docs', 'extension', 'store');

test.beforeAll(async () => {
  await fs.mkdir(out, { recursive: true });
  child = spawn(process.execPath, [path.resolve('apps/extension/demo/serve.mjs')], { env: { ...process.env, BUGREEL_DEMO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>(resolve => child.stdout!.on('data', data => { if (String(data).includes('BugReel demo site')) resolve(); }));
});
test.afterAll(() => { child?.kill(); });

test('store screenshots', async ({ context }) => {
  const extensionId = await extensionIdOf(context);
  const site = context.pages()[0] ?? await context.newPage();
  await site.setViewportSize({ width: 1280, height: 800 });
  await site.goto(`${origin}/`);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 1280, height: 800 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${await tabIdFor(panel, `${origin}/`)}`);
  await expect(panel.getByTestId('onboarding')).toBeVisible();
  await panel.screenshot({ path: path.join(out, '1-onboarding.png') });
  await skipOnboarding(panel);
  await panel.screenshot({ path: path.join(out, '2-start.png') });
  await startRecording(panel);
  await site.getByLabel('Full name').fill('Ada Example');
  await site.getByLabel('Coupon code').fill('SAVE20');
  await site.getByLabel('Password').pressSequentially('demo-password');
  await site.getByLabel('Size').selectOption('m');
  await site.getByTestId('checkout').click();
  await expect(site.locator('#result')).toHaveText('Checkout failed (HTTP 500)');
  await expect(panel.getByTestId('live-counts')).toContainText('1 network errors');
  await panel.getByTestId('capture-screenshot').click();
  await expect(panel.getByTestId('screenshot-preview')).toBeVisible();
  await site.screenshot({ path: path.join(out, '3-demo-page-while-recording.png') });
  await panel.screenshot({ path: path.join(out, '4-recording.png') });
  await stopRecording(panel);
  await panel.getByTestId('title').fill('Checkout fails after applying a coupon');
  await panel.getByTestId('expected').fill('The order is placed and a confirmation is shown.');
  await panel.getByTestId('actual').fill('An error message appears and POST /api/checkout returns HTTP 500.');
  await panel.getByTestId('evidence-item').filter({ hasText: 'POST → HTTP 500' }).getByTestId('signature').check();
  await panel.evaluate(() => window.scrollTo(0, 0));
  await panel.screenshot({ path: path.join(out, '5-review.png') });
  await panel.getByText('Preview Playwright draft').click();
  await panel.getByTestId('playwright-preview').scrollIntoViewIfNeeded();
  await panel.screenshot({ path: path.join(out, '6-export.png') });
});
