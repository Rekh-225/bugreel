import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFixtureServer, type FixtureServer } from './server';

export const EXTENSION_PATH = path.resolve(__dirname, '..', '..', 'dist');

export async function launchExtension(userDataDir: string) {
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: process.env.BUGREEL_EXTENSION_HEADED !== '1',
    viewport: { width: 1200, height: 900 },
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
}

export async function extensionIdOf(context: BrowserContext) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  return worker.url().split('/')[2];
}

type Fixtures = { userDataDir: string; context: BrowserContext; extensionId: string; site: Page; panel: Page };

export const test = base.extend<Fixtures, { server: FixtureServer }>({
  server: [async ({}, use) => { const server = await startFixtureServer(); await use(server); await server.close(); }, { scope: 'worker' }],
  userDataDir: async ({}, use) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bugreel-ext-'));
    await use(directory);
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  },
  context: async ({ userDataDir }, use) => {
    const context = await launchExtension(userDataDir);
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => { await use(await extensionIdOf(context)); },
  site: async ({ context, server }, use) => {
    const site = context.pages()[0] ?? await context.newPage();
    await site.goto(server.url('/app.html'));
    await use(site);
  },
  panel: async ({ context, extensionId, site }, use) => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const tabId = await tabIdFor(panel, site.url());
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
    await use(panel);
  },
});
export { expect };

/** Finds a tab ID by URL using chrome.debugger.getTargets (available without the tabs permission). */
export async function tabIdFor(panel: Page, url: string) {
  return panel.evaluate(async target => {
    const targets = await chrome.debugger.getTargets();
    const match = targets.find(item => item.type === 'page' && item.url === target && item.tabId !== undefined);
    if (!match) throw new Error(`No tab for ${target}`);
    return match.tabId!;
  }, url);
}

export async function sendToWorker<T = unknown>(panel: Page, message: Record<string, unknown>): Promise<T> {
  const response = await panel.evaluate(value => chrome.runtime.sendMessage(value), message) as { ok: boolean; value?: T; error?: string };
  if (!response.ok) throw new Error(response.error);
  return response.value as T;
}

/** Reads the extension's IndexedDB directly from an extension page. */
export async function readDb(panel: Page) {
  return panel.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('bugreel'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const all = (store: string) => new Promise<any[]>((resolve, reject) => { const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const result = { sessions: await all('sessions'), events: await all('events'), reviews: await all('reviews'), screenshots: (await all('screenshots')).map(shot => ({ sessionId: shot.sessionId, byteLength: shot.byteLength, width: shot.width, height: shot.height, blobSize: shot.blob.size })) };
    db.close();
    return result;
  });
}

export async function activeState(panel: Page): Promise<{ sessionId: string; status: string } | null> {
  return panel.evaluate(async () => ((await chrome.storage.session.get('active')).active ?? null) as { sessionId: string; status: string } | null);
}

/** Waits until the stored events for a session satisfy a predicate. */
export async function waitForEvents(panel: Page, sessionId: string, predicate: (events: any[]) => boolean, timeout = 10_000) { // eslint-disable-line @typescript-eslint/no-explicit-any
  let events: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  await expect.poll(async () => { events = (await readDb(panel)).events.filter(event => event.sessionId === sessionId); return predicate(events); }, { timeout }).toBe(true);
  return events;
}

export const interactions = (events: any[]) => events.filter(event => event.kind === 'interaction').map(event => event.event); // eslint-disable-line @typescript-eslint/no-explicit-any

/** Stops the extension service worker through the DevTools protocol to simulate an MV3 idle shutdown. */
export async function stopServiceWorker(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
}
