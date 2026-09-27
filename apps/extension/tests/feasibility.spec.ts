import { buildRecording, validateRecording } from '../../../packages/core/src/index';
import { activeState, expect, interactions, readDb, sendToWorker, stopServiceWorker, tabIdFor, test, waitForEvents } from './fixtures/extension';

// Feasibility checkpoint: the capture approach (CDP isolated-world content script + debugger diagnostics)
// works end to end against a real Chromium with the built extension loaded.

test('captures a click, typed input, console error, and failed HTTP request', async ({ site, panel }) => {
  const tabId = await tabIdFor(panel, site.url());
  const { sessionId } = await sendToWorker<{ sessionId: string }>(panel, { type: 'start', tabId, recordValues: true });
  await site.getByLabel('Coupon code').fill('SAVE20');
  await site.getByTestId('checkout').click();
  await expect(site.locator('#result')).toHaveText('Checkout failed (500)');
  const events = await waitForEvents(panel, sessionId, list => list.some(event => event.kind === 'network') && list.some(event => event.kind === 'console'));
  const steps = interactions(events);
  expect(steps.map(step => step.type)).toEqual(['navigation', 'input', 'click']);
  expect(steps[1]).toMatchObject({ value: 'SAVE20', selector: { kind: 'role', role: 'textbox', value: 'Coupon code' } });
  expect(steps[2].selector).toEqual({ kind: 'testId', value: 'checkout', confidence: 'stable' });
  const network = events.find(event => event.kind === 'network').item;
  expect(network).toMatchObject({ kind: 'http', method: 'POST', status: 500 });
  expect(network.url).toBe(`${new URL(site.url()).origin}/api/fail`);
  const consoleEvent = events.find(event => event.kind === 'console').item;
  expect(consoleEvent.message).toContain('ORDER_SUBMISSION_FAILED');
  expect(consoleEvent.message).not.toContain('test@example.com');
  await sendToWorker(panel, { type: 'stop' });
});

test('continues through same-origin navigation without duplicate listeners and survives a worker restart', async ({ context, site, panel, server }) => {
  const tabId = await tabIdFor(panel, site.url());
  const { sessionId } = await sendToWorker<{ sessionId: string }>(panel, { type: 'start', tabId, recordValues: false });
  await site.getByRole('link', { name: 'Go to second page' }).click();
  await site.waitForURL(server.url('/second.html'));
  await site.getByRole('button', { name: 'Continue' }).click();
  await expect(site.locator('#result')).toHaveText('Continued');
  let events = await waitForEvents(panel, sessionId, list => interactions(list).filter(step => step.type === 'click').length >= 2);
  expect(interactions(events).map(step => step.type)).toEqual(['navigation', 'click', 'navigation', 'click']);
  expect(interactions(events)[2]).toMatchObject({ causedByAction: true, url: server.url('/second.html') });

  const [worker] = context.serviceWorkers();
  await worker.evaluate(() => { (globalThis as Record<string, unknown>).__bugreelTestMarker = true; });
  await stopServiceWorker(context, panel);
  await site.getByRole('link', { name: 'Back to shop' }).click();
  await site.waitForURL(server.url('/app.html'));
  await site.getByRole('button', { name: 'Open settings view' }).click();
  await expect(site.locator('#result')).toHaveText('Settings view');
  events = await waitForEvents(panel, sessionId, list => interactions(list).some(step => step.sameDocument));
  const steps = interactions(events);
  expect(steps.map(step => step.type)).toEqual(['navigation', 'click', 'navigation', 'click', 'click', 'navigation', 'click', 'navigation']);
  expect(steps.at(-1)).toMatchObject({ sameDocument: true, url: server.url('/app/settings'), causedByAction: true });
  expect((await activeState(panel))?.sessionId).toBe(sessionId);
  // The worker really restarted: its globals are gone, yet recording continued from persisted state.
  expect(await worker.evaluate(() => (globalThis as Record<string, unknown>).__bugreelTestMarker ?? null)).toBeNull();
  const session = (await readDb(panel)).sessions.find(item => item.id === sessionId);
  expect(session.notes.join(' ')).toContain('background worker restarted');
  await sendToWorker(panel, { type: 'stop' });
});

test('stop detaches the debugger, ends collection, and the stored data exports as a valid recording', async ({ site, panel }) => {
  const tabId = await tabIdFor(panel, site.url());
  const { sessionId } = await sendToWorker<{ sessionId: string }>(panel, { type: 'start', tabId, recordValues: false });
  await site.getByLabel('Full name').pressSequentially('Ada');
  await site.getByRole('button', { name: 'Load missing' }).click();
  await waitForEvents(panel, sessionId, list => list.some(event => event.kind === 'network'));
  await sendToWorker(panel, { type: 'stop' });
  expect(await activeState(panel)).toBeNull();
  const detached = await panel.evaluate(async id => chrome.debugger.sendCommand({ tabId: id }, 'Runtime.evaluate', { expression: '1' }).then(() => false, () => true), tabId);
  expect(detached).toBe(true);
  const before = (await readDb(panel)).events.length;
  await site.getByRole('button', { name: 'Log problem' }).click();
  await site.getByTestId('checkout').click();
  await site.waitForTimeout(500);
  const db = await readDb(panel);
  expect(db.events.length).toBe(before);
  const session = db.sessions.find(item => item.id === sessionId);
  expect(session.status).toBe('completed');
  await expect(site.locator('bugreel-recording-indicator')).toHaveCount(0);

  const events = db.events.filter(event => event.sessionId === sessionId);
  const typed = interactions(events).find(step => step.type === 'input');
  expect(typed.value).toBeUndefined();
  expect(typed.valueOmitted).toBe('not-recorded');
  const recording = buildRecording({
    generatorVersion: '0.1.0', exportedAt: new Date().toISOString(),
    session: { ...session, interruption: session.interruption, typedValuesRecorded: session.recordValues, stoppedAt: session.stoppedAt },
    events: interactions(events),
    console: events.filter(event => event.kind === 'console').map(event => event.item),
    network: events.filter(event => event.kind === 'network').map(event => event.item),
    unsupported: events.filter(event => event.kind === 'unsupported').map(event => event.item),
    gaps: session.gaps,
    review: { title: 'Missing resource', expected: 'Loads', actual: '404', notes: '', excludedActionIds: [], includedEvidenceIds: events.map(event => event.id), failureEvidenceId: null },
    screenshot: null,
  });
  const result = validateRecording(JSON.parse(JSON.stringify(recording)));
  expect(result.ok ? [] : result.errors).toEqual([]);
  expect(recording.requiredConfiguration.map(entry => entry.key)).toEqual(['BUGREEL_VALUE_1']);
});
