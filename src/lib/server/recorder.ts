import { chromium, type Browser } from 'playwright';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { CHECKOUT_PATH, FAILURE_CODE, FAILURE_MESSAGE } from '../demo';
import type { RecordedEvent, Session } from '../session';
import { normalizeEvents } from '../recorder/normalize';
import { saveSession, sessionDirectory } from './artifacts';
import { APP_ORIGIN, state } from './session-manager';
import { ApiError } from './http';

export async function startRecording() {
  if (state.busy) throw new ApiError('A browser task is already running. Stop the current recording or wait for replay.', 409);
  const session: Session = {
    id: randomUUID(), startedAt: new Date().toISOString(), startUrl: `${APP_ORIGIN}/demo-store`, status: 'starting',
    events: [], actions: [], consoleErrors: [], networkErrors: [], screenshots: [], warnings: [],
  };
  state.busy = session.id;
  state.sessions.set(session.id, session);
  let browser: Browser | undefined;
  try {
    await saveSession(session);
    const port = Number(process.env.BUGREEL_TEST_CDP_PORT);
    browser = await chromium.launch({ headless: false, args: port > 1024 && port < 65536 ? [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'] : [] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const clock = () => ({ timestamp: new Date().toISOString(), elapsedMs: Date.now() - Date.parse(session.startedAt) });
    const accepting = () => ['starting', 'recording', 'stopping'].includes(session.status);
    const pending = new Set<Promise<unknown>>();
    let stopPromise: Promise<Session> | undefined;
    let failureScreenshot: Promise<void> | undefined;
    let lastActionAt = 0;
    const track = (task: Promise<unknown>) => {
      const handled = task.catch(error => { session.warnings.push(`Evidence capture: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`); });
      pending.add(handled);
      void handled.finally(() => pending.delete(handled));
    };
    function record(event: Omit<RecordedEvent, 'id' | 'sequence' | 'elapsedMs'>) {
      if (!accepting() || session.events.length >= 2000) return;
      session.events.push({ ...event, id: randomUUID(), sequence: session.events.length, elapsedMs: Math.max(0, Date.parse(event.timestamp) - Date.parse(session.startedAt)) });
      session.actions = normalizeEvents(session.events);
    }
    await context.route('**/*', route => new URL(route.request().url()).origin === APP_ORIGIN ? route.continue() : route.abort('blockedbyclient'));
    await context.exposeBinding('__bugreelCapture', ({ frame }, payload) => {
      if (frame !== page.mainFrame() || !payload || JSON.stringify(payload).length > 16000 || !['click', 'input', 'change', 'submit'].includes(payload.type)) return;
      if (typeof payload.url !== 'string' || new URL(payload.url).origin !== APP_ORIGIN || !Number.isFinite(Date.parse(payload.timestamp))) return;
      if (payload.selector && (!['testId', 'id', 'label', 'placeholder', 'text', 'css'].includes(payload.selector.kind) || typeof payload.selector.value !== 'string')) return;
      if (!payload.selector && !session.warnings.includes('Some interactions have no reliable selector and cannot be replayed.')) session.warnings.push('Some interactions have no reliable selector and cannot be replayed.');
      lastActionAt = Date.now();
      record(payload);
    });
    await context.addInitScript({ path: path.join(process.cwd(), 'src', 'lib', 'recorder', 'injected.js') });
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame() || !frame.url().startsWith(APP_ORIGIN)) return;
      record({ type: 'navigation', url: frame.url(), timestamp: new Date().toISOString(), causedByAction: session.events.length > 0 && Date.now() - lastActionAt < 3000 });
    });
    page.on('console', message => {
      if (!accepting() || message.type() !== 'error' || session.consoleErrors.length >= 200) return;
      const location = message.location();
      session.consoleErrors.push({ id: randomUUID(), type: 'console', message: message.text().slice(0, 4000), url: location.url, line: location.lineNumber, ...clock() });
    });
    page.on('pageerror', error => {
      if (accepting() && session.consoleErrors.length < 200) session.consoleErrors.push({ id: randomUUID(), type: 'pageerror', message: error.message.slice(0, 4000), url: page.url(), ...clock() });
    });
    page.on('requestfailed', request => {
      if (accepting() && session.networkErrors.length < 200) session.networkErrors.push({ id: randomUUID(), kind: 'transport', url: request.url(), method: request.method(), error: request.failure()?.errorText, resourceType: request.resourceType(), ...clock() });
    });
    page.on('response', response => {
      if (!accepting() || response.status() < 400 || session.networkErrors.length >= 200) return;
      const request = response.request();
      const evidence = { id: randomUUID(), kind: 'http' as const, url: response.url(), method: request.method(), status: response.status(), resourceType: request.resourceType(), ...clock(), code: undefined as string | undefined };
      session.networkErrors.push(evidence);
      if (new URL(response.url()).pathname !== CHECKOUT_PATH || request.method() !== 'POST') return;
      track((async () => {
        const body = await response.json().catch(() => null);
        if (response.status() !== 500 || body?.code !== FAILURE_CODE) return;
        evidence.code = body.code;
        session.failure = { code: FAILURE_CODE, message: FAILURE_MESSAGE, method: 'POST', pathname: CHECKOUT_PATH, status: 500, networkId: evidence.id, visible: false };
        if (!failureScreenshot) {
          failureScreenshot = (async () => {
            await page.getByTestId('checkout-error').waitFor({ state: 'visible', timeout: 8000 });
            session.failure!.visible = true;
            await page.screenshot({ path: path.join(sessionDirectory(session.id), 'recorded-failure.png'), fullPage: true, animations: 'disabled' });
            session.screenshots.push({ id: randomUUID(), name: 'recorded-failure.png', reason: 'failure', timestamp: new Date().toISOString() });
          })();
          await failureScreenshot;
        }
      })());
    });
    const release = () => {
      if (state.busy === session.id) state.busy = undefined;
      if (state.activeRecording?.id === session.id) state.activeRecording = undefined;
    };
    function stop() {
      return stopPromise ??= (async () => {
        session.status = 'stopping';
        try {
          if (!page.isClosed()) {
            await page.evaluate(async () => { await (window as unknown as { __bugreelFlush?: () => Promise<void> }).__bugreelFlush?.(); });
            await page.locator('[data-checkout-state="pending"]').waitFor({ state: 'hidden', timeout: 10_000 });
          }
          await Promise.all([...pending]);
          if (!session.screenshots.length && !page.isClosed()) {
            await page.screenshot({ path: path.join(sessionDirectory(session.id), 'recorded-stop.png'), fullPage: true, animations: 'disabled' });
            session.screenshots.push({ id: randomUUID(), name: 'recorded-stop.png', reason: 'stopped', timestamp: new Date().toISOString() });
          }
          session.status = 'captured';
        } catch (error) {
          session.status = 'interrupted';
          session.warnings.push(error instanceof Error ? error.message.split('\n')[0] : 'Recording was interrupted.');
        } finally {
          session.stoppedAt = new Date().toISOString();
          session.actions = normalizeEvents(session.events);
          await browser?.close().catch(() => {});
          release();
          await saveSession(session);
        }
        return session;
      })();
    }
    state.activeRecording = { id: session.id, stop };
    browser.on('disconnected', () => {
      if (!['starting', 'recording'].includes(session.status)) return;
      session.status = 'interrupted';
      session.stoppedAt = new Date().toISOString();
      session.warnings.push('The recording browser was closed before Stop was pressed.');
      release();
      void saveSession(session).catch(() => {});
    });
    await page.goto(session.startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByTestId('add-to-cart').waitFor({ state: 'visible', timeout: 15_000 });
    session.status = 'recording';
    await saveSession(session);
    return session;
  } catch (error) {
    session.status = 'error';
    session.warnings.push(error instanceof Error ? error.message.split('\n')[0] : 'Browser could not launch.');
    await browser?.close().catch(() => {});
    if (state.busy === session.id) state.busy = undefined;
    if (state.activeRecording?.id === session.id) state.activeRecording = undefined;
    await saveSession(session);
    throw error;
  }
}
