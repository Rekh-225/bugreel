import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { validateRecording } from '../../../packages/core/src/index';
import { activeState, expect, extensionIdOf, readDb, tabIdFor, test } from './fixtures/extension';
import { downloadText, skipOnboarding, startRecording, stopRecording } from './fixtures/panel';

// Smoke test for the reviewer/manual-test demo site (apps/extension/demo, `npm run ext:demo`): the same flows the
// manual test plan asks a human to perform must work against it with the built extension.

let child: ChildProcess;
const port = 4390;
const origin = `http://127.0.0.1:${port}`;

test.beforeAll(async () => {
  child = spawn(process.execPath, [path.resolve('apps/extension/demo/serve.mjs')], { env: { ...process.env, BUGREEL_DEMO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on('data', data => { if (String(data).includes('BugReel demo site')) resolve(); });
    child.on('exit', code => reject(new Error(`demo server exited with ${code}`)));
  });
});
test.afterAll(() => { child.kill(); });

test('the demo site exercises ordinary and sensitive inputs, controlled failures, navigation, and the frame case', async ({ context }) => {
  const extensionId = await extensionIdOf(context);
  const site = context.pages()[0] ?? await context.newPage();
  await site.goto(`${origin}/`);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${await tabIdFor(panel, `${origin}/`)}`);
  await skipOnboarding(panel);
  await startRecording(panel, { recordValues: true });
  const sessionId = (await activeState(panel))!.sessionId;

  await site.getByLabel('Full name').fill('Ada Example');
  await site.getByLabel('Coupon code').fill('SAVE20');
  await site.getByLabel('Password').pressSequentially('demo-password');
  await site.getByLabel('Email').pressSequentially('someone@example.test');
  await site.getByLabel('Card number').pressSequentially('4111111111111111');
  await site.getByLabel('Size').selectOption('m');
  await site.frameLocator('iframe').getByRole('button', { name: 'Log an error inside the frame' }).click();
  await site.getByRole('button', { name: 'Fail an assertion' }).click();
  await site.getByTestId('checkout').click();
  await expect(site.locator('#result')).toHaveText('Checkout failed (HTTP 500)');
  await site.getByRole('button', { name: /Open the settings view/ }).click();
  await site.getByRole('link', { name: /second page/ }).click();
  await site.waitForURL(`${origin}/second.html`);
  await site.getByRole('button', { name: 'Continue' }).click();
  await expect(panel.getByTestId('live-counts')).toContainText('2 console errors · 1 network errors');
  await panel.getByTestId('capture-screenshot').click();
  await expect(panel.getByTestId('screenshot-preview')).toBeVisible();
  await stopRecording(panel);

  const json = JSON.parse((await downloadText(panel, 'export-json')).text);
  expect(validateRecording(json).ok).toBe(true);
  const text = JSON.stringify(json);
  for (const secret of ['demo-password', 'someone@example.test', '4111111111111111', 'FRAME_ONLY_ERROR']) expect(text).not.toContain(secret);
  expect(json.actions.find((action: { label: string }) => action.label.includes('Coupon code')).value).toBe('SAVE20');
  expect(json.evidence.console.map((item: { consoleType?: string }) => item.consoleType).sort()).toEqual(['assert', 'error']);
  expect(json.evidence.network[0]).toMatchObject({ method: 'POST', status: 500, url: `${origin}/api/checkout` });
  expect(json.actions.map((action: { type: string }) => action.type)).toEqual(['goto', 'fill', 'fill', 'fill', 'fill', 'fill', 'select', 'click', 'click', 'click', 'waitForURL', 'click', 'waitForURL', 'click']);
  expect((await readDb(panel)).sessions.find(session => session.id === sessionId).counts.outOfScope).toBeGreaterThanOrEqual(1);
});
