import { activeState, expect, extensionIdOf, readDb, tabIdFor, test } from './fixtures/extension';
import { skipOnboarding } from './fixtures/panel';

// The real side panel has no ?tab= parameter: it records the active tab of its own window. Automation cannot
// open Chrome's side panel or click the toolbar, so this drives the same selection logic from a panel page
// opened as a tab and switching the active tab with chrome.tabs.update. It is NOT proof that the toolbar or the
// side-panel surface work; see docs/extension/MANUAL_TEST_PLAN.md for the pending manual verification.

test('without a pinned tab, the panel follows the active tab of its window and ignores other windows', async ({ context, site, server }) => {
  const extensionId = await extensionIdOf(context);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await skipOnboarding(panel);
  // The panel tab itself is active: an extension page is not recordable and the panel says so.
  await expect(panel.getByTestId('unsupported-reason')).toContainText('chrome-extension://');
  await expect(panel.getByTestId('start')).toBeDisabled();

  const siteTabId = await tabIdFor(panel, site.url());
  await panel.evaluate(id => chrome.tabs.update(id, { active: true }), siteTabId);
  await expect(panel.getByTestId('target')).toContainText(server.url('/app.html'));
  await expect(panel.getByTestId('start')).toBeEnabled();

  // A page in a second window does not become the target of this window's panel.
  const other = await panel.evaluate(async url => {
    const created = await chrome.windows.create({ url, focused: false });
    return created?.tabs?.[0]?.id ?? null;
  }, server.url('/second.html'));
  expect(other).not.toBeNull();
  await panel.waitForTimeout(500);
  await expect(panel.getByTestId('target')).toContainText(server.url('/app.html'));

  await panel.getByTestId('start').click();
  await expect(panel.getByTestId('recording-status')).toHaveText('Recording');
  expect((await activeState(panel))!.sessionId).toBeTruthy();
  const active = (await activeState(panel)) as unknown as { tabId: number };
  expect(active.tabId).toBe(siteTabId);
  await site.getByTestId('checkout').click();
  await expect(panel.getByTestId('live-counts')).toContainText('1 network errors');
  await panel.getByTestId('stop').click();
  await expect(panel.getByRole('heading', { name: /Review recording/ })).toBeVisible();
  const db = await readDb(panel);
  expect(db.sessions[0].tabId).toBe(siteTabId);
  expect(db.sessions[0].startUrl).toBe(server.url('/app.html'));
  await panel.evaluate(id => chrome.tabs.remove(id!), other);
});
