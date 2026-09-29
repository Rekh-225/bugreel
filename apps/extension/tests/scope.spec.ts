import { activeState, expect, readDb, stopServiceWorker, test, waitForEvents } from './fixtures/extension';
import { skipOnboarding, startRecording, stopRecording } from './fixtures/panel';

// Diagnostic scope: same-process child frames share the tab's debugger target, so the worker must map every
// execution context and request to a frame and keep only the selected main frame's evidence.

const diagnostics = (events: any[]) => events.filter(event => event.kind === 'console' || event.kind === 'network').map(event => `${event.item.kind}:${event.item.message ?? event.item.url}`); // eslint-disable-line @typescript-eslint/no-explicit-any
const outOfScope = async (panel: import('@playwright/test').Page, sessionId: string) => (await readDb(panel)).sessions.find(session => session.id === sessionId).counts.outOfScope ?? 0;

test('errors and failed requests from a same-process iframe are not stored, main-frame ones are, including cross-origin destinations', async ({ panel, site, server }) => {
  await skipOnboarding(panel);
  await startRecording(panel);
  const sessionId = (await activeState(panel))!.sessionId;
  const frame = site.frameLocator('iframe');
  await Promise.all([site.waitForEvent('pageerror'), frame.getByRole('button', { name: 'Frame throw' }).click()]);
  await frame.getByRole('button', { name: 'Frame error' }).click();
  await Promise.all([site.waitForResponse(response => response.url().includes('from=frame')), frame.getByRole('button', { name: 'Frame fetch' }).click()]);
  await expect.poll(() => outOfScope(panel, sessionId)).toBeGreaterThanOrEqual(3);

  await site.getByRole('button', { name: 'Log problem' }).click();
  await site.getByRole('button', { name: 'Load missing' }).click();
  await site.getByRole('button', { name: 'Fetch other origin' }).click();
  const events = await waitForEvents(panel, sessionId, list => list.filter(event => event.kind === 'network').length >= 2 && list.some(event => event.kind === 'console'));
  const seen = diagnostics(events);
  expect(seen).toContain('console:Problem logged with token=[REDACTED]');
  expect(seen).toContain(`http:${server.url('/api/missing')}`);
  expect(seen).toContain(`http:${server.otherOrigin}/api/missing`);
  expect(seen.some(entry => /FRAME_ONLY|from=frame/.test(entry))).toBe(false);
  await stopRecording(panel);
  await expect(panel.getByTestId('out-of-scope')).toContainText('embedded frames');
  await expect(panel.getByTestId('evidence-item').filter({ hasText: /FRAME_ONLY|from=frame/ })).toHaveCount(0);
});

test('frame attribution survives navigation (contexts cleared and recreated) and a worker restart', async ({ context, panel, site, server }) => {
  await skipOnboarding(panel);
  await startRecording(panel);
  const sessionId = (await activeState(panel))!.sessionId;
  await site.getByRole('link', { name: 'Go to second page' }).click();
  await site.waitForURL(server.url('/second.html'));
  await site.getByRole('button', { name: 'Second error' }).click();
  let events = await waitForEvents(panel, sessionId, list => list.some(event => event.kind === 'console'));
  expect(diagnostics(events)).toEqual(['console:Second page error']);

  await site.getByRole('link', { name: 'Back to shop' }).click();
  await site.waitForURL(server.url('/app.html'));
  await stopServiceWorker(context, panel);
  await site.frameLocator('iframe').getByRole('button', { name: 'Frame error' }).click();
  await site.getByRole('button', { name: 'Log problem' }).click();
  events = await waitForEvents(panel, sessionId, list => list.filter(event => event.kind === 'console').length >= 2);
  expect(diagnostics(events)).toEqual(['console:Second page error', 'console:Problem logged with token=[REDACTED]']);
  // The frame's console error plus the iframe's own document request are both out of scope.
  expect(await outOfScope(panel, sessionId)).toBeGreaterThanOrEqual(1);
  const active = (await activeState(panel)) as unknown as { contexts: Record<string, string>; mainFrameId: string };
  expect(Object.values(active.contexts)).toContain(active.mainFrameId);
  await stopRecording(panel);
});

test('coordination state and stored evidence never contain raw secret-bearing URLs', async ({ panel, site, server }) => {
  const secret = 'Zk9x2mQ7rT4vW8yB1nC5dF3gH6jK0lPq';
  await site.goto(server.url(`/app.html?token=${secret}&page=3#access_token=${secret}`));
  await skipOnboarding(panel);
  await startRecording(panel);
  const sessionId = (await activeState(panel))!.sessionId;
  await site.getByRole('button', { name: 'Open settings view' }).click();
  await site.evaluate(secret => history.pushState({}, '', `/app/settings?session=${secret}`), secret);
  await site.waitForTimeout(300);
  await panel.getByTestId('pause').click();
  await site.evaluate(secret => history.pushState({}, '', `/app/paused?otp=${secret}`), secret);
  await site.waitForTimeout(300);
  await panel.getByTestId('resume').click();
  await expect(panel.getByTestId('recording-status')).toHaveText('Recording');
  const sessionState = await panel.evaluate(() => chrome.storage.session.get(null));
  expect(JSON.stringify(sessionState)).not.toContain(secret);
  expect(JSON.stringify(sessionState)).toContain('/app/paused?otp=REDACTED');
  await stopRecording(panel);
  const db = await readDb(panel);
  expect(JSON.stringify(db)).not.toContain(secret);
  const urls = db.events.filter(event => event.sessionId === sessionId && event.kind === 'interaction').map(event => event.event.url);
  expect(urls[0]).toBe(server.url('/app.html?token=REDACTED&page=3#access_token=REDACTED'));
  // The resume anchored the following steps at the (sanitized) page where recording resumed.
  expect(urls).toContain(server.url('/app/paused?otp=REDACTED'));
});
