import { activeState, expect, readDb, test, waitForEvents } from './fixtures/extension';
import { downloadText, runDraft, skipOnboarding, startRecording, stopRecording } from './fixtures/panel';

// Exported drafts must match the recorded failure and nothing else. The decoy page makes an unrelated origin
// fail with the same path, method, and status before any step, and (with ?only=decoy) instead of the real site.
// BugReel never runs drafts; these tests run them with the Playwright CLI only to prove the generator's semantics.

test('HTTP signature: only the recorded origin satisfies the draft, and a decoy origin alone makes it fail', async ({ panel, site, server }, testInfo) => {
  test.setTimeout(150_000);
  await site.goto(server.url('/decoy.html'));
  await skipOnboarding(panel);
  await startRecording(panel);
  const sessionId = (await activeState(panel))!.sessionId;
  await site.getByRole('button', { name: 'Checkout' }).click();
  await expect(site.locator('#result')).toHaveText('checkout done');
  await waitForEvents(panel, sessionId, list => list.some(event => event.kind === 'network' && event.item.url === server.url('/api/fail')));
  await stopRecording(panel);
  await panel.getByTestId('evidence-item').filter({ hasText: server.url('/api/fail') }).getByTestId('signature').check();
  const draft = (await downloadText(panel, 'export-playwright')).text;
  expect(draft).toContain(`url.origin === "${server.origin}" && url.pathname === "/api/fail" && response.status() === 500`);
  expect(draft.indexOf('const failureResponse')).toBeGreaterThan(draft.indexOf('1. Open /decoy.html'));

  const real = await runDraft(testInfo.outputPath('real'), draft);
  expect(real.exit, real.output).toBe(0);
  // Same draft, but the page now only hits the other origin (same path, method, and status): it must fail.
  const decoyOnly = draft.replace(`page.goto("${server.url('/decoy.html')}")`, `page.goto("${server.url('/decoy.html?only=decoy')}")`);
  expect(decoyOnly).not.toBe(draft);
  const decoy = await runDraft(testInfo.outputPath('decoy'), decoyOnly);
  expect(decoy.exit).not.toBe(0);
  expect(decoy.output).toContain(`Expected POST ${server.origin}/api/fail to return HTTP 500, as recorded`);
});

test('transport signature: only the recorded origin satisfies the draft, and a decoy origin alone makes it fail', async ({ panel, site, server }, testInfo) => {
  test.setTimeout(150_000);
  await site.goto(server.url('/decoy.html'));
  await skipOnboarding(panel);
  await startRecording(panel);
  const sessionId = (await activeState(panel))!.sessionId;
  await site.getByRole('button', { name: 'Break connection' }).click();
  await expect(site.locator('#result')).toHaveText('reset done');
  await waitForEvents(panel, sessionId, list => list.some(event => event.kind === 'network' && event.item.kind === 'transport' && event.item.url === server.url('/api/reset')));
  await stopRecording(panel);
  await panel.getByTestId('evidence-item').filter({ hasText: server.url('/api/reset') }).getByTestId('signature').check();
  const draft = (await downloadText(panel, 'export-playwright')).text;
  expect(draft).toContain(`request.method === "GET" && url.origin === "${server.origin}" && url.pathname === "/api/reset"`);
  const real = await runDraft(testInfo.outputPath('real'), draft);
  expect(real.exit, real.output).toBe(0);
  const decoy = await runDraft(testInfo.outputPath('decoy'), draft.replace(`page.goto("${server.url('/decoy.html')}")`, `page.goto("${server.url('/decoy.html?only=decoy')}")`));
  expect(decoy.exit).not.toBe(0);
  expect(decoy.output).toContain(`Expected GET ${server.origin}/api/reset to fail, as recorded`);
});

test('console.assert: the captured message is what Playwright replays, and the draft listens for assert messages', async ({ panel, site }, testInfo) => {
  test.setTimeout(120_000);
  await skipOnboarding(panel);
  await startRecording(panel);
  const sessionId = (await activeState(panel))!.sessionId;
  const [message] = await Promise.all([site.waitForEvent('console', item => item.type() === 'assert'), site.getByRole('button', { name: 'Assert' }).click()]);
  const events = await waitForEvents(panel, sessionId, list => list.some(event => event.kind === 'console'));
  const captured = events.find(event => event.kind === 'console').item;
  expect(captured).toMatchObject({ kind: 'console', consoleType: 'assert' });
  // No assumed "Assertion failed:" prefix: the stored text equals what Playwright's ConsoleMessage.text() reports.
  expect(captured.message).toBe(message.text());
  expect(captured.message).toBe('Cart total must stay positive after discount');
  await stopRecording(panel);
  const item = panel.getByTestId('evidence-item').filter({ hasText: 'Console assertion failure' });
  await expect(item).toHaveCount(1);
  await item.getByTestId('signature').check();
  const draft = (await downloadText(panel, 'export-playwright')).text;
  expect(draft).toContain('if (message.type() === "assert") consoleMessages.push(message.text());');
  expect(draft).toContain('text.includes("Cart total must stay positive after discount")');
  const run = await runDraft(testInfo.outputPath('assert'), draft);
  expect(run.exit, run.output).toBe(0);
  const json = JSON.parse((await downloadText(panel, 'export-json')).text);
  expect(json.evidence.console[0].consoleType).toBe('assert');
  expect((await readDb(panel)).events.filter(event => event.sessionId === sessionId && event.kind === 'console')).toHaveLength(1);
});
