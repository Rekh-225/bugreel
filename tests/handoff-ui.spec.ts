import { test, expect } from '@playwright/test';
import { createAgentPacket } from '../src/lib/agent-packet';
import type { Session } from '../src/lib/session';

const id = '00000000-0000-0000-0000-000000000099';
const session: Session = {
  id, startedAt: '2026-09-19T10:00:00Z', stoppedAt: '2026-09-19T10:00:10Z', startUrl: 'http://127.0.0.1:3000/demo-store', status: 'captured',
  events: [], actions: [], networkErrors: [], consoleErrors: [], screenshots: [], warnings: [],
  failure: { code: 'DISCOUNT_CHECKOUT_FAILURE', message: 'Checkout failed', pathname: '/api/demo/checkout', method: 'POST', status: 500, networkId: '1', visible: true },
  generatedTest: { source: 'exact original test', hash: 'hash', version: 1 },
  latestRun: { id: 'run', status: 'confirmed', startedAt: '', message: 'Verified', sourceHash: 'hash' },
};
const repository = { branch: 'main', commit: 'test-commit', dirty: false };
const preview = { packet: createAgentPacket(session, repository), hash: 'a'.repeat(64), configured: false, maxAcuLimit: 10, repository };

test.beforeEach(async ({ page }) => {
  await page.route(`**/api/sessions/${id}`, route => route.fulfill({ json: session }));
});

test('copy/download work without credentials and sending remains disabled', async ({ page, context }) => {
  let posts = 0;
  await page.route(`**/api/sessions/${id}/handoff`, route => { if (route.request().method() === 'POST') posts++; return route.fulfill({ json: preview }); });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/sessions/${id}`);
  await expect(page.getByTestId('devin-configuration')).toHaveText('API not configured');
  await expect(page.getByTestId('send-to-devin')).toBeDisabled();
  await page.getByTestId('copy-agent-packet').click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(preview.packet);
  const download = page.waitForEvent('download');
  await page.getByTestId('download-agent-packet').click();
  expect((await download).suggestedFilename()).toBe(`bugreel-${id}.md`);
  expect(posts).toBe(0);
});

test('explicit consent sends the reviewed hash once and shows a mocked Devin link', async ({ page }) => {
  let posts = 0;
  await page.route(`**/api/sessions/${id}/handoff`, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ...preview, configured: true } });
    posts++;
    expect(route.request().postDataJSON()).toEqual({ confirm: true, packetHash: preview.hash, maxAcuLimit: 10 });
    return route.fulfill({ json: { status: 'sent', packetHash: preview.hash, maxAcuLimit: 10, message: 'Mocked session created, not a live API call.', createdAt: '', sessionId: 'devin-test', url: 'https://app.devin.ai/sessions/devin-test' } });
  });
  await page.goto(`/sessions/${id}`);
  await expect(page.getByTestId('send-to-devin')).toBeDisabled();
  await page.getByTestId('handoff-consent').check();
  await page.getByTestId('send-to-devin').click();
  await expect(page.getByTestId('handoff-status')).toHaveText('SENT TO DEVIN');
  await expect(page.getByTestId('open-devin')).toHaveAttribute('href', 'https://app.devin.ai/sessions/devin-test');
  await expect(page.getByTestId('send-to-devin')).toBeDisabled();
  expect(posts).toBe(1);
});

test('an uncertain submission cannot be clicked again', async ({ page }) => {
  await page.route(`**/api/sessions/${id}/handoff`, route => route.fulfill({ json: { ...preview, configured: true, handoff: { status: 'uncertain', packetHash: preview.hash, maxAcuLimit: 10, createdAt: '', message: 'Check Devin before retrying.' } } }));
  await page.goto(`/sessions/${id}`);
  await expect(page.getByTestId('handoff-status')).toHaveText('HANDOFF OUTCOME UNKNOWN');
  await expect(page.getByTestId('handoff-consent')).toBeDisabled();
  await expect(page.getByTestId('send-to-devin')).toBeDisabled();
});
