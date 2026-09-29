import { activeState, expect, interactions, readDb, test, waitForEvents } from './fixtures/extension';
import { skipOnboarding, startRecording, stopRecording } from './fixtures/panel';

// The privacy fixture's password, email, "trapped" text, and SSN fields record every `value` access and throw.
// A single read by the capture script therefore shows up in window.__reads and breaks the event it belonged to.

const reads = (site: import('@playwright/test').Page) => site.evaluate(() => (window as unknown as { __reads: string[] }).__reads);
const fills = (events: any[]) => interactions(events).filter(step => step.type === 'input' || step.type === 'change'); // eslint-disable-line @typescript-eslint/no-explicit-any

test.beforeEach(async ({ site, server }) => { await site.goto(server.url('/privacy.html')); });

test('with value recording off, no field value is ever read: typing, blur, debounce, pause, and stop paths', async ({ panel, site }) => {
  await skipOnboarding(panel);
  await startRecording(panel);
  const sessionId = (await activeState(panel))!.sessionId;

  await site.getByLabel('Password').pressSequentially('hunter2-secret');
  await site.keyboard.press('Tab');                          // blur -> change before the debounce fires
  await site.getByLabel('Email').pressSequentially('alice@example.com');
  await site.waitForTimeout(800);                            // debounce flush
  await site.keyboard.press('Tab');                          // change after the flush must not duplicate or read
  await site.getByLabel('Trapped text').pressSequentially('ordinary text, recording off');
  await site.waitForTimeout(800);
  await site.getByLabel('Social security number').pressSequentially('123-45-6789');
  await site.getByRole('button', { name: 'Do nothing' }).click();   // click flushes the pending SSN edit

  await panel.getByTestId('pause').click();
  await expect(panel.getByTestId('recording-status')).toHaveText('Paused');
  await site.getByLabel('Notes').pressSequentially('typed while paused');
  await site.waitForTimeout(800);
  await site.keyboard.press('Tab');
  await panel.getByTestId('resume').click();
  await expect(panel.getByTestId('recording-status')).toHaveText('Recording');
  await site.getByLabel('Notes').click();
  await site.keyboard.press('Tab');                          // blur after resume: the paused edit is not reported

  await site.getByLabel('Trapped text').pressSequentially('!');   // still pending when Stop arrives
  await stopRecording(panel);

  expect(await reads(site)).toEqual([]);
  const events = (await readDb(panel)).events.filter(event => event.sessionId === sessionId);
  const typed = fills(events);
  expect(typed.map(step => [step.selector.value, step.valueOmitted])).toEqual([
    ['Password', 'password'], ['Email', 'sensitive'], ['Trapped text', 'not-recorded'], ['Social security number', 'sensitive'], ['Trapped text', 'not-recorded'],
  ]);
  expect(typed.every(step => step.value === undefined)).toBe(true);
  const stored = JSON.stringify(events);
  for (const secret of ['hunter2', 'alice@example.com', 'ordinary text', '123-45-6789', 'typed while paused']) expect(stored).not.toContain(secret);
  await expect(panel.getByTestId('step')).toHaveText([/Open \/privacy\.html/, /Enter \[password omitted\] in Password/, /Enter \[sensitive value omitted\] in Email/, /Enter \[value not recorded\] in Trapped text/, /Enter \[sensitive value omitted\] in Social security number/, /Click Do nothing/, /Enter \[value not recorded\] in Trapped text/]);
});

test('with value recording on, only fields that will be transmitted are read, and blur does not duplicate a flushed edit', async ({ panel, site }) => {
  await skipOnboarding(panel);
  await startRecording(panel, { recordValues: true });
  const sessionId = (await activeState(panel))!.sessionId;

  await site.getByLabel('Notes').pressSequentially('SAVE20');
  await site.waitForTimeout(800);                            // debounce flush reads and reports the value once
  await site.keyboard.press('Tab');                          // change after flush: no second report
  await site.getByLabel('Password').pressSequentially('hunter2-secret');
  await site.keyboard.press('Tab');
  await site.getByLabel('Email').pressSequentially('alice@example.com');
  await site.waitForTimeout(800);
  await site.getByLabel('Notes').focus();
  await site.keyboard.press('End');
  await site.keyboard.type(' plus');
  await stopRecording(panel);                                // Stop flushes the pending Notes edit

  expect(await reads(site)).toEqual([]);
  const events = await waitForEvents(panel, sessionId, list => fills(list).length >= 4);
  expect(fills(events).map(step => [step.selector.value, step.value ?? null, step.valueOmitted ?? null])).toEqual([
    ['Notes', 'SAVE20', null], ['Password', null, 'password'], ['Email', null, 'sensitive'], ['Notes', 'SAVE20 plus', null],
  ]);
  const stored = JSON.stringify(events);
  expect(stored).not.toContain('hunter2');
  expect(stored).not.toContain('alice@example.com');
});

test('a value getter that throws cannot break sensitive-field capture or leak through a different code path', async ({ panel, site }) => {
  await skipOnboarding(panel);
  await startRecording(panel, { recordValues: true });
  const sessionId = (await activeState(panel))!.sessionId;
  // Enter inside a form-less field takes the keydown path; paste takes the input path; both must stay read-free.
  await site.getByLabel('Password').pressSequentially('abc');
  await site.keyboard.press('Enter');
  await site.getByLabel('Social security number').focus();
  await site.evaluate(() => { document.execCommand('insertText', false, '999-99-9999'); });
  await site.waitForTimeout(800);
  const events = await waitForEvents(panel, sessionId, list => fills(list).length >= 2);
  expect(await reads(site)).toEqual([]);
  expect(fills(events).map(step => step.valueOmitted)).toEqual(['password', 'sensitive']);
  expect(interactions(events).some(step => step.type === 'submit')).toBe(true);
  await stopRecording(panel);
});
