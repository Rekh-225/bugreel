import { activeState, expect, extensionIdOf, interactions, launchExtension, readDb, stopServiceWorker, tabIdFor, test, waitForEvents } from './fixtures/extension';
import { downloadText, skipOnboarding, startRecording, stopRecording } from './fixtures/panel';

test('pause excludes actions, records an explicit gap, and makes the draft incomplete', async ({ panel, site }) => {
  await skipOnboarding(panel);
  await startRecording(panel);
  await site.getByRole('button', { name: 'Load missing' }).click();
  await expect(panel.getByTestId('live-counts')).toContainText('2 steps');
  await panel.getByTestId('pause').click();
  await expect(panel.getByTestId('recording-status')).toHaveText('Paused');
  await expect(site.locator('bugreel-recording-indicator')).toHaveCount(1);
  await site.getByRole('button', { name: 'Log problem' }).click();
  await site.getByLabel('Coupon code').fill('typed while paused');
  await site.getByRole('link', { name: 'Go to second page' }).click();
  await site.waitForURL(/second\.html/);
  await site.waitForTimeout(800);
  await panel.getByTestId('resume').click();
  await expect(panel.getByTestId('recording-status')).toHaveText('Recording');
  await site.getByRole('button', { name: 'Continue' }).click();
  await expect(panel.getByTestId('live-counts')).toContainText('4 steps');
  await stopRecording(panel);

  await expect(panel.getByTestId('gap')).toHaveCount(1);
  await expect(panel.getByTestId('step')).toHaveText([/Open \/app\.html/, /Click Load missing/, /Open \/second\.html/, /Click Continue/]);
  await expect(panel.getByTestId('evidence-item')).toHaveCount(1);
  await expect(panel.getByTestId('draft-status')).toContainText('incomplete');
  const draft = await downloadText(panel, 'export-playwright');
  expect(draft.text).toContain('test.fixme(true, "BugReel: this recording has gaps.');
  expect(draft.text).toContain('RECORDING GAP 1');
  expect(draft.text.indexOf('RECORDING GAP 1')).toBeLessThan(draft.text.indexOf('Open /second.html'));
  const json = JSON.parse((await downloadText(panel, 'export-json')).text);
  expect(json.gaps).toHaveLength(1);
  expect(json.gaps[0].endedAt).not.toBeNull();
  expect(JSON.stringify(json)).not.toContain('typed while paused');
});

test('repeated start and stop cycles keep sessions isolated and never duplicate capture', async ({ panel, site }) => {
  await skipOnboarding(panel);
  const ids: string[] = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    await startRecording(panel);
    ids.push((await activeState(panel))!.sessionId);
    await site.getByRole('button', { name: 'Log problem' }).click();
    await site.getByTestId('checkout').click();
    await expect(panel.getByTestId('live-counts')).toContainText('3 steps · 2 console errors · 1 network errors');
    await stopRecording(panel);
    await panel.getByTestId('back').click();
    // An exception between sessions must not leak into the next one (Runtime.enable replays old messages).
    await Promise.all([site.waitForEvent('pageerror'), site.getByRole('button', { name: 'Throw error' }).click()]);
  }
  await site.waitForTimeout(500);
  const db = await readDb(panel);
  expect(new Set(ids).size).toBe(3);
  for (const id of ids) {
    const events = db.events.filter(event => event.sessionId === id);
    expect(interactions(events).map(step => step.type)).toEqual(['navigation', 'click', 'click']);
    expect(events.filter(event => event.kind === 'console')).toHaveLength(2);
    expect(events.filter(event => event.kind === 'network')).toHaveLength(1);
    expect(events.some(event => event.kind === 'console' && event.item.kind === 'exception')).toBe(false);
  }
  expect(db.events.every(event => ids.includes(event.sessionId))).toBe(true);
  await expect(panel.getByTestId('history-item')).toHaveCount(3);
});

test('a later session cannot receive events from an earlier one, and page scripts cannot reach the capture channel', async ({ panel, site }) => {
  await skipOnboarding(panel);
  await startRecording(panel);
  const first = (await activeState(panel)) as unknown as { sessionId: string; bindingName: string; worldName: string };
  await site.getByRole('button', { name: 'Log problem' }).click();
  await waitForEvents(panel, first.sessionId, list => list.some(event => event.kind === 'console'));
  await stopRecording(panel);
  const firstCount = (await readDb(panel)).events.filter(event => event.sessionId === first.sessionId).length;
  await panel.getByTestId('back').click();
  await startRecording(panel);
  const second = (await activeState(panel)) as unknown as typeof first;
  // Each session gets its own isolated world and a random binding name.
  expect(second.bindingName).not.toBe(first.bindingName);
  expect(second.worldName).not.toBe(first.worldName);
  // The page's own JavaScript world cannot reach either session's binding or the capture script.
  expect(await site.evaluate(names => names.map(name => typeof (window as unknown as Record<string, unknown>)[name]), [first.bindingName, second.bindingName, '__bugreelCapture', '__bugreelCaptureMain'])).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
  await site.getByRole('button', { name: 'Log problem' }).click();
  await site.getByRole('button', { name: 'Open settings view' }).click();
  const events = await waitForEvents(panel, second.sessionId, list => interactions(list).length >= 4);
  expect(interactions(events).map(step => step.type)).toEqual(['navigation', 'click', 'click', 'navigation']);
  expect(events.filter(event => event.kind === 'console')).toHaveLength(1);
  await stopRecording(panel);
  const after = await readDb(panel);
  expect(after.events.filter(event => event.sessionId === first.sessionId)).toHaveLength(firstCount);
});

test('unsupported interactions are reported as not replayable instead of being guessed', async ({ panel, site }) => {
  await skipOnboarding(panel);
  await startRecording(panel);
  await site.getByLabel('Notes').click();
  await site.keyboard.type('rich text');
  await site.keyboard.press('Escape');
  const [chooser] = await Promise.all([site.waitForEvent('filechooser'), site.getByLabel('Attachment').click()]);
  await chooser.setFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await site.frameLocator('iframe').getByRole('button', { name: 'Inside frame' }).click();
  await expect.poll(async () => (await readDb(panel)).sessions[0].counts.unsupported).toBe(4);
  await stopRecording(panel);
  const unsupported = panel.getByTestId('unsupported');
  await expect(unsupported.filter({ hasText: 'rich-text editor' })).toHaveCount(1);
  await expect(unsupported.filter({ hasText: 'File selection' })).toHaveCount(1);
  await expect(unsupported.filter({ hasText: 'embedded frame' })).toHaveCount(1);
  await expect(unsupported.filter({ hasText: 'Escape' })).toHaveCount(1);
  await expect(panel.getByTestId('step').filter({ hasText: /Attachment|Inside frame|Notes/ })).toHaveCount(0);
  const draft = await downloadText(panel, 'export-playwright');
  expect(draft.text).toContain('UNSUPPORTED STEP (not replayed, contenteditable)');
  expect(draft.text).not.toContain('rich text');
});

test('restricted and non-web pages cannot be recorded and the panel explains why', async ({ panel, site }) => {
  await site.goto('chrome://version');
  await skipOnboarding(panel);
  await panel.goto(panel.url().replace(/tab=\d+/, `tab=${await tabIdFor(panel, 'chrome://version/')}`));
  await expect(panel.getByTestId('unsupported-reason')).toContainText('does not allow extensions to record chrome://');
  await expect(panel.getByTestId('start')).toBeDisabled();
  const response = await panel.evaluate(tabId => chrome.runtime.sendMessage({ type: 'start', tabId, recordValues: false }), await tabIdFor(panel, 'chrome://version/'));
  expect(response).toMatchObject({ ok: false });
  expect(await activeState(panel)).toBeNull();
});

test('cross-origin navigation stops capture and marks the session interrupted', async ({ panel, site, server }) => {
  await skipOnboarding(panel);
  await startRecording(panel);
  await site.getByRole('button', { name: 'Load missing' }).click();
  await site.getByRole('link', { name: 'Leave site' }).click();
  await site.waitForURL(`${server.otherOrigin}/second.html`);
  await expect(panel.getByTestId('interruption')).toContainText('navigated to a different site');
  await expect(panel.getByTestId('interruption')).toContainText(server.otherOrigin);
  await site.getByRole('button', { name: 'Continue' }).click();
  await site.waitForTimeout(500);
  const db = await readDb(panel);
  expect(db.sessions[0]).toMatchObject({ status: 'interrupted', interruption: { reason: 'cross-origin-navigation' } });
  expect(interactions(db.events).map(step => step.url)).not.toContain(`${server.otherOrigin}/second.html`);
  expect(await activeState(panel)).toBeNull();
  const detached = await panel.evaluate(async url => {
    const target = (await chrome.debugger.getTargets()).find(item => item.url === url);
    return chrome.debugger.sendCommand({ tabId: target!.tabId }, 'Runtime.evaluate', { expression: '1' }).then(() => false, () => true);
  }, site.url());
  expect(detached).toBe(true);
  const json = JSON.parse((await downloadText(panel, 'export-json')).text);
  expect(json.session.status).toBe('interrupted');
});

test('closing the recorded tab interrupts the session and opens its review', async ({ context, panel, server }) => {
  await skipOnboarding(panel);
  const extra = await context.newPage();
  await extra.goto(server.url('/second.html'));
  await panel.goto(panel.url().replace(/tab=\d+/, `tab=${await tabIdFor(panel, server.url('/second.html'))}`));
  await startRecording(panel);
  await extra.getByRole('button', { name: 'Continue' }).click();
  await expect(panel.getByTestId('live-counts')).toContainText('2 steps');
  await extra.close();
  await expect(panel.getByTestId('interruption')).toContainText('tab was closed');
  expect((await readDb(panel)).sessions[0].interruption.reason).toBe('tab-closed');
});

test('an active recording is not resumed after a browser restart and is marked interrupted', async ({ userDataDir, server }) => {
  const first = await launchExtension(userDataDir);
  const id = await extensionIdOf(first);
  const site = first.pages()[0] ?? await first.newPage();
  await site.goto(server.url('/app.html'));
  const panel = await first.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.goto(`chrome-extension://${id}/sidepanel.html?tab=${await tabIdFor(panel, site.url())}`);
  await skipOnboarding(panel);
  await startRecording(panel);
  await site.getByRole('button', { name: 'Load missing' }).click();
  await expect(panel.getByTestId('live-counts')).toContainText('1 network errors');
  await first.close();

  const second = await launchExtension(userDataDir);
  try {
    const reopened = await second.newPage();
    await reopened.goto(`chrome-extension://${await extensionIdOf(second)}/sidepanel.html`);
    await expect(reopened.getByTestId('history-item')).toHaveCount(1);
    await expect(reopened.getByTestId('status-badge')).toHaveText('Interrupted');
    expect(await activeState(reopened)).toBeNull();
    const db = await readDb(reopened);
    // A graceful shutdown detaches the debugger first (tab-closed); an abrupt one is repaired on startup (browser-restart).
    expect(db.sessions[0].status).toBe('interrupted');
    expect(['tab-closed', 'browser-restart']).toContain(db.sessions[0].interruption.reason);
    expect(db.events.filter(event => event.kind === 'network')).toHaveLength(1);
    await reopened.getByTestId('open-session').click();
    await expect(reopened.getByTestId('interruption')).toBeVisible();
    await expect(reopened.getByTestId('export-json')).toBeEnabled();
  } finally {
    await second.close();
  }
});

test('a session cut off without a detach event is repaired on startup and not resumed', async ({ context, panel, site }) => {
  await skipOnboarding(panel);
  await startRecording(panel);
  await site.getByRole('button', { name: 'Load missing' }).click();
  await expect(panel.getByTestId('live-counts')).toContainText('1 network errors');
  // Reproduce the state a crash or restart leaves behind: chrome.storage.session is empty, the worker is gone,
  // and the stored session still says 'recording'. The worker's startup recovery must repair it.
  await panel.evaluate(() => chrome.storage.session.clear());
  await stopServiceWorker(context, panel);
  await panel.reload();
  await expect(panel.getByTestId('status-badge')).toHaveText('Interrupted');
  expect(await activeState(panel)).toBeNull();
  const db = await readDb(panel);
  expect(db.sessions[0]).toMatchObject({ status: 'interrupted', interruption: { reason: 'browser-restart' } });
  expect(db.events.filter(event => event.kind === 'network')).toHaveLength(1);
  await panel.getByTestId('open-session').click();
  await expect(panel.getByTestId('interruption')).toContainText('does not resume recordings automatically');
});

test('deleting a session removes its steps, evidence, review, and screenshot', async ({ panel, site }) => {
  await skipOnboarding(panel);
  await startRecording(panel);
  await site.getByTestId('checkout').click();
  await panel.getByTestId('capture-screenshot').click();
  await expect(panel.getByTestId('screenshot-preview')).toBeVisible();
  await stopRecording(panel);
  await panel.getByTestId('title').fill('To be deleted');
  await panel.getByTestId('back').click();
  await startRecording(panel);
  await stopRecording(panel);
  await panel.getByTestId('back').click();
  let db = await readDb(panel);
  expect(db.sessions).toHaveLength(2);
  expect(db.screenshots).toHaveLength(1);
  expect(db.reviews.length).toBeGreaterThanOrEqual(1);
  const doomed = db.screenshots[0].sessionId;
  const doomedItem = panel.getByTestId('history-item').nth(1);
  await doomedItem.getByTestId('delete-session').click();
  await doomedItem.getByTestId('delete-session-confirm').click();
  await expect(panel.getByTestId('history-item')).toHaveCount(1);
  db = await readDb(panel);
  expect(db.sessions.map(session => session.id)).not.toContain(doomed);
  expect(db.events.filter(event => event.sessionId === doomed)).toEqual([]);
  expect(db.reviews.filter(review => review.sessionId === doomed)).toEqual([]);
  expect(db.screenshots).toEqual([]);
});
