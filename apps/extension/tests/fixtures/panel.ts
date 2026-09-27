import type { Download, Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { expect } from './extension';

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
