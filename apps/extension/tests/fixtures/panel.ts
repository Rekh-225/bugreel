import type { Download, Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect } from './extension';

/** Runs an exported draft with the real Playwright CLI. BugReel never does this; tests do it to prove the generator emits working code. */
export async function runDraft(directory: string, source: string, env: Record<string, string> = {}) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'draft.spec.ts'), source);
  await fs.writeFile(path.join(directory, 'playwright.config.mjs'), `export default { testDir: '.', timeout: 30000, reporter: 'line', use: { headless: true, browserName: 'chromium' }, outputDir: 'out' };\n`);
  const cli = createRequire(path.resolve('package.json')).resolve('@playwright/test/cli');
  const child = spawn(process.execPath, [cli, 'test', '--config', path.join(directory, 'playwright.config.mjs')], { cwd: directory, env: { ...process.env, ...env }, shell: false });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exit = await new Promise<number | null>((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
  return { exit, output };
}

export async function skipOnboarding(panel: Page) {
  await panel.evaluate(() => chrome.storage.local.set({ onboarded: true }));
  await panel.reload();
  await expect(panel.getByTestId('start').or(panel.getByTestId('recording-indicator'))).toBeVisible();
}

export async function startRecording(panel: Page, options: { recordValues?: boolean } = {}) {
  if (options.recordValues) await panel.getByTestId('record-values').check();
  await panel.getByTestId('start').click();
  await expect(panel.getByTestId('recording-status')).toHaveText('Recording');
}

export async function stopRecording(panel: Page) {
  await panel.getByTestId('stop').click();
  await expect(panel.getByRole('heading', { name: /Review recording/ })).toBeVisible();
}

export async function downloadText(panel: Page, testId: string) {
  const [download] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId(testId).click()]);
  return { name: download.suggestedFilename(), text: await fs.readFile((await download.path())!, 'utf8'), download };
}

export async function downloadBytes(download: Download) {
  return fs.readFile((await download.path())!);
}
