import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { validateRecording } from '../../../packages/core/src/index';
import { expect, readDb, test } from './fixtures/extension';
import { downloadBytes, downloadText, skipOnboarding, startRecording, stopRecording } from './fixtures/panel';

test('first run explains the debugger permission and data handling before recording', async ({ panel }) => {
  const onboarding = panel.getByTestId('onboarding');
  await expect(onboarding).toBeVisible();
  await expect(onboarding).toContainText('Read and change all your data on all websites');
  await expect(onboarding).toContainText('Access the page debugger backend');
  await expect(onboarding).toContainText('cannot be made optional');
  await expect(onboarding).toContainText('Password fields are never recorded');
  await panel.getByTestId('onboarding-done').click();
  await expect(panel.getByTestId('start')).toBeEnabled();
  await panel.reload();
  await expect(panel.getByTestId('onboarding')).toHaveCount(0);
});

test('records a scenario, reviews evidence, and exports a valid report, recording, draft, and screenshot', async ({ panel, site, server }) => {
  await skipOnboarding(panel);
  await expect(panel.getByTestId('target')).toContainText(server.url('/app.html'));
  await startRecording(panel);
  await expect(site.locator('bugreel-recording-indicator')).toHaveCount(1);

  await site.getByLabel('Coupon code').fill('SAVE20');
  await site.getByLabel('Password').fill('hunter2-secret');
  await site.getByLabel('Size').selectOption('m');
  await site.getByLabel('Accept terms').check();
  await site.getByTestId('checkout').click();
  await expect(site.locator('#result')).toHaveText('Checkout failed (500)');
  await expect(panel.getByTestId('live-counts')).toContainText('1 network errors');
  await panel.getByTestId('capture-screenshot').click();
  await expect(panel.getByTestId('screenshot-preview')).toBeVisible();
  await stopRecording(panel);
  await expect(site.locator('bugreel-recording-indicator')).toHaveCount(0);

  const steps = panel.getByTestId('step');
  await expect(steps).toHaveText([
    /Open \/app\.html/, /Enter \[value not recorded\] in Coupon code/, /Enter \[password omitted\] in Password/,
    /Select \[value not recorded\] in Size/, /Click Accept terms/, /Click Checkout/,
  ]);
  const evidence = panel.getByTestId('evidence-item');
  await expect(evidence.filter({ hasText: 'POST → HTTP 500' })).toHaveCount(1);
  await expect(evidence.filter({ hasText: 'ORDER_SUBMISSION_FAILED' })).toContainText('[REDACTED:email]');

  await panel.getByTestId('title').fill('Checkout fails with <b>coupon</b>');
  await panel.getByTestId('expected').fill('The order is placed.');
  await panel.getByTestId('actual').fill('An error banner appears and POST /api/fail returns 500.');
  await evidence.filter({ hasText: 'POST → HTTP 500' }).getByTestId('signature').check();
  await panel.getByTestId('include-screenshot').check();
  await expect(panel.getByTestId('draft-status')).toContainText('unverified draft');

  const json = await downloadText(panel, 'export-json');
  expect(json.name).toMatch(/^bugreel-\d{8}-\d{4}-[0-9a-f]{8}\.recording\.json$/);
  const recording = JSON.parse(json.text);
  const validation = validateRecording(recording);
  expect(validation.ok ? [] : validation.errors).toEqual([]);
  expect(recording.report.title).toBe('Checkout fails with <b>coupon</b>');
  expect(recording.evidence.failureSignature.kind).toBe('http');
  expect(recording.playwright).toMatchObject({ verified: false, assertion: 'failure-signature' });
  expect(recording.requiredConfiguration.map((entry: { key: string }) => entry.key)).toEqual(['BUGREEL_VALUE_1', 'BUGREEL_VALUE_2', 'BUGREEL_VALUE_3']);
  expect(json.text).not.toContain('hunter2');
  expect(json.text).not.toContain('SAVE20');

  const markdown = await downloadText(panel, 'export-markdown');
  expect(markdown.text).toContain('# Checkout fails with &lt;b&gt;coupon&lt;/b&gt;');
  expect(markdown.text).toContain('**Unverified BugReel recording.**');
  expect(markdown.text).toContain('Screenshot pixels are not redacted.');

  const draft = await downloadText(panel, 'export-playwright');
  expect(draft.name).toMatch(/\.spec\.ts$/);
  expect(draft.text).toContain('STATUS: UNVERIFIED DRAFT');
  expect(draft.text).toContain('page.getByTestId("checkout").click()');
  expect(draft.text).toContain('page.getByRole("checkbox", { name: "Accept terms", exact: true }).click()');
  expect(draft.text).toContain('selectOption(requiredValue("BUGREEL_VALUE_3"))');

  const shot = await downloadText(panel, 'export-screenshot');
  expect(shot.name).toBe(recording.screenshot.fileName);
  const bytes = await downloadBytes(shot.download);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(bytes.length).toBe(recording.screenshot.byteLength);
});

test('an exported draft is executable by the Playwright CLI once required values are configured', async ({ panel, site, server }, testInfo) => {
  test.setTimeout(120_000);
  await skipOnboarding(panel);
  await startRecording(panel, { recordValues: true });
  await site.getByLabel('Coupon code').fill('SAVE20');
  await site.getByLabel('Password').fill('never-recorded');
  await site.getByLabel('Email').fill('person@example.com');
  await site.getByRole('link', { name: 'Go to second page' }).click();
  await site.getByRole('button', { name: 'Continue' }).click();
  await site.getByRole('link', { name: 'Back to shop' }).click();
  await site.getByRole('button', { name: 'Open settings view' }).click();
  await site.getByTestId('checkout').click();
  await expect(site.locator('#result')).toHaveText('Checkout failed (500)');
  await expect(panel.getByTestId('live-counts')).toContainText('1 network errors');
  await stopRecording(panel);
  await panel.getByTestId('evidence-item').filter({ hasText: 'POST → HTTP 500' }).getByTestId('signature').check();
  const draft = await downloadText(panel, 'export-playwright');
  expect(draft.text).toContain('.fill("SAVE20")');
  expect(draft.text).not.toContain('never-recorded');
  expect(draft.text).not.toContain('person@example.com');
  expect(draft.text).toContain(`await page.waitForURL("${server.url('/second.html')}");`);
  expect(draft.text).toContain(`await page.waitForURL("${server.url('/app/settings')}");`);

  // BugReel never runs drafts itself. This test runs one only to prove the generator emits working code.
  const directory = testInfo.outputPath('draft');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'draft.spec.ts'), draft.text);
  await fs.writeFile(path.join(directory, 'playwright.config.mjs'), `export default { testDir: '.', timeout: 30000, reporter: 'line', use: { headless: true, browserName: 'chromium' }, outputDir: 'out' };\n`);
  const cli = createRequire(path.resolve('package.json')).resolve('@playwright/test/cli');
  const child = spawn(process.execPath, [cli, 'test', '--config', path.join(directory, 'playwright.config.mjs')], {
    cwd: directory, env: { ...process.env, BUGREEL_VALUE_1: 'any-password', BUGREEL_VALUE_2: 'qa@example.test' }, shell: false,
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exit = await new Promise<number | null>((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
  expect(exit, output).toBe(0);
  expect(output).toContain('1 passed');
});

test('reviewing a visual bug without errors still exports, with an action-only draft', async ({ panel, site }) => {
  await skipOnboarding(panel);
  await startRecording(panel);
  await site.getByRole('button', { name: 'Open settings view' }).click();
  // Start page, the click, and the resulting SPA route change.
  await expect(panel.getByTestId('live-counts')).toContainText('3 steps');
  await stopRecording(panel);
  await expect(panel.getByTestId('no-evidence')).toBeVisible();
  await panel.getByTestId('actual').fill('The settings heading overlaps the menu.');
  const draft = await downloadText(panel, 'export-playwright');
  expect(draft.text).toContain('// TODO: no assertion was generated.');
  expect(draft.text).toContain('// Actual behaviour reported: The settings heading overlaps the menu.');
  const json = JSON.parse((await downloadText(panel, 'export-json')).text);
  expect(json.playwright.assertion).toBe('none');
  expect(json.evidence).toEqual({ console: [], network: [], failureSignature: null });
});

test('users can remove steps and evidence and discard the screenshot before export', async ({ panel, site }) => {
  await skipOnboarding(panel);
  await startRecording(panel);
  await site.getByRole('button', { name: 'Log problem' }).click();
  await site.getByRole('button', { name: 'Load missing' }).click();
  await expect(panel.getByTestId('live-counts')).toContainText('1 console errors · 1 network errors');
  await panel.getByTestId('capture-screenshot').click();
  await expect(panel.getByTestId('screenshot-preview')).toBeVisible();
  await stopRecording(panel);
  const logged = panel.getByTestId('evidence-item').filter({ hasText: 'Problem logged' });
  await expect(logged).toContainText('token=[REDACTED]');
  await logged.getByTestId('include-evidence').uncheck();
  await panel.getByTestId('step').filter({ hasText: 'Click Log problem' }).getByRole('checkbox').uncheck();
  await panel.getByTestId('discard-screenshot').click();
  await panel.getByTestId('discard-screenshot-confirm').click();
  await expect(panel.getByTestId('no-screenshot')).toBeVisible();
  await expect(panel.getByTestId('export-screenshot')).toBeDisabled();
  const json = JSON.parse((await downloadText(panel, 'export-json')).text);
  expect(json.evidence.console).toEqual([]);
  expect(json.evidence.network).toHaveLength(1);
  expect(json.actions.map((action: { label: string }) => action.label)).not.toContain('Click Log problem');
  expect(json.screenshot).toBeNull();
  expect((await readDb(panel)).screenshots).toEqual([]);
});
