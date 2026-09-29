import { sanitizeUrl, type RecordedEvent } from '../../../../packages/core/src/index';
import { appendEvent, countSessions, deleteSessionData, getSession, listSessions, putScreenshot, putSession, StorageError, updateSession } from '../shared/db';
import { ACTION_NAVIGATION_WINDOW_MS, MAX_CONSOLE, MAX_INTERACTIONS, MAX_NETWORK, MAX_PENDING_REQUESTS, MAX_SCREENSHOT_BYTES, MAX_SESSIONS, MAX_UNSUPPORTED, PREVIOUS_DOCUMENT_GRACE_MS } from '../shared/limits';
import type { ActiveRecording, ActiveSummary, EventRecord, SessionRecord, TabDescription } from '../shared/types';
import { recordability } from '../shared/urls';
import { checkCommand, detachReason, finishSession, interruption, orphanedSessions, type Command } from './lifecycle';
import { consoleItem, exceptionItem, httpItem, interactionEvent, normalizeMethod, originOf, parsePayload, pngSize, selectorLooksSensitive, transportItem, type PendingRequest } from './transform';

// ------------------------------------------------------------------------------------------------
// Coordination state. The in-memory copy is only a cache: chrome.storage.session is authoritative so the
// recording survives service-worker restarts, and it is cleared by Chrome on browser/extension restart.

let cache: ActiveRecording | null | undefined;
const pendingRequests = new Map<string, PendingRequest>();

async function loadActive() {
  if (cache === undefined) cache = ((await chrome.storage.session.get('active')).active as ActiveRecording | undefined) ?? null;
  return cache;
}
async function saveActive(next: ActiveRecording | null) {
  cache = next;
  if (next) await chrome.storage.session.set({ active: next });
  else await chrome.storage.session.remove('active');
}

let queue: Promise<unknown> = Promise.resolve();
/** All state transitions and CDP events run one at a time, in arrival order. */
export function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const send = <T = Record<string, unknown>>(tabId: number, method: string, params?: Record<string, unknown>) =>
  chrome.debugger.sendCommand({ tabId }, method, params) as unknown as Promise<T>;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

let contentSource: Promise<string> | undefined;
const captureScript = () => contentSource ??= fetch(chrome.runtime.getURL('content.js')).then(response => {
  if (!response.ok) throw new Error('The capture script is missing from the extension package.');
  return response.text();
});

async function scriptFor(active: ActiveRecording, paused: boolean) {
  const config = { sessionId: active.sessionId, token: active.token, bindingName: active.bindingName, recordValues: active.recordValues, paused };
  return `${await captureScript()}\n;globalThis.__bugreelCaptureMain(${JSON.stringify(config)});`;
}

function evaluateInWorld(active: ActiveRecording, expression: string) {
  if (active.contextId === undefined) return Promise.resolve();
  return withTimeout(send(active.tabId, 'Runtime.evaluate', { expression, contextId: active.contextId }), 3000, 'The page did not respond.');
}

/** Registers the capture script for documents loaded later in the tab, replacing any previous registration. */
async function registerScript(active: ActiveRecording, paused: boolean) {
  if (active.scriptId) await send(active.tabId, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: active.scriptId }).catch(() => undefined);
  const { identifier } = await send<{ identifier: string }>(active.tabId, 'Page.addScriptToEvaluateOnNewDocument', { source: await scriptFor(active, paused), worldName: active.worldName });
  active.scriptId = identifier;
}

async function setBadge(tabId: number, state: 'recording' | 'paused' | null) {
  await chrome.action.setBadgeText({ tabId, text: state === 'recording' ? 'REC' : state === 'paused' ? 'II' : '' }).catch(() => undefined);
  if (state) await chrome.action.setBadgeBackgroundColor({ tabId, color: state === 'recording' ? '#dc2626' : '#d97706' }).catch(() => undefined);
}

function browserLabel() {
  const data = (navigator as Navigator & { userAgentData?: { brands?: { brand: string; version: string }[] } }).userAgentData;
  const brand = data?.brands?.find(item => /Chrome|Chromium/.test(item.brand) && !/Not/.test(item.brand));
  if (brand) return `${brand.brand} ${brand.version}`.slice(0, 60);
  const match = navigator.userAgent.match(/Chrom(?:e|ium)\/(\d+)/);
  return match ? `Chrome ${match[1]}` : null;
}

const hex = (bytes: ArrayLike<number>) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(16)));
/** Non-reversible, session-salted digest of a raw URL. Only digests are persisted for change detection. */
const urlDigest = async (active: Pick<ActiveRecording, 'token'>, url: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${active.token}\n${url}`))));

// ------------------------------------------------------------------------------------------------
// Commands

export async function getActiveSummary(): Promise<ActiveSummary> {
  const active = await loadActive();
  return active ? { sessionId: active.sessionId, tabId: active.tabId, origin: active.origin, status: active.status, startedAt: active.startedAt } : null;
}

export async function describeTab(tabId: number): Promise<TabDescription> {
  const target = (await chrome.debugger.getTargets()).find(item => item.tabId === tabId && item.type === 'page');
  const check = recordability(target?.url);
  return { tabId, url: target?.url ? sanitizeUrl(target.url).url : null, title: target?.title?.slice(0, 200) ?? null, supported: check.supported, ...(check.supported ? {} : { reason: check.reason }) };
}

function assertCommand(command: Command, active: ActiveRecording | null) {
  const error = checkCommand(command, active?.status ?? null);
  if (error) throw new Error(error);
}

function attachError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/already attached/i.test(message)) return 'Another debugger is already attached to this tab. Close DevTools-based tools that took control of it and try again.';
  if (/policy/i.test(message)) return `Your organization's Chrome policy prevents BugReel from recording this tab (${message}).`;
  if (/Cannot access|Cannot attach/i.test(message)) return 'Chrome does not allow extensions to record this page.';
  return `BugReel could not attach to the tab: ${message}`;
}

export function start(tabId: number, recordValues: boolean) {
  return serialize(async () => {
    assertCommand('start', await loadActive());
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Select a tab to record.');
    if (await countSessions() >= MAX_SESSIONS) throw new Error(`BugReel keeps at most ${MAX_SESSIONS} sessions. Delete old sessions before recording a new one.`);
    const described = await describeTab(tabId);
    if (!described.supported) throw new Error(described.reason);
    try { await chrome.debugger.attach({ tabId }, '1.3'); } catch (error) { throw new Error(attachError(error)); }
    const startedAt = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    let created = false;
    try {
      const { frameTree } = await send<{ frameTree: { frame: { id: string; url: string; urlFragment?: string } } }>(tabId, 'Page.getFrameTree');
      const url = frameTree.frame.url + (frameTree.frame.urlFragment ?? '');
      const check = recordability(url);
      if (!check.supported) throw new Error(check.reason);
      const origin = originOf(url)!;
      const metrics = await send<{ cssLayoutViewport?: { clientWidth: number; clientHeight: number } }>(tabId, 'Page.getLayoutMetrics').catch(() => undefined);
      const viewport = metrics?.cssLayoutViewport ? { width: Math.round(metrics.cssLayoutViewport.clientWidth), height: Math.round(metrics.cssLayoutViewport.clientHeight) } : null;
      const startUrl = sanitizeUrl(url).url;
      const token = randomToken();
      const digest = await urlDigest({ token }, url);
      const active: ActiveRecording = {
        sessionId, tabId, origin, token, bindingName: `__bugreel_${randomToken()}`, worldName: `bugreel-${sessionId}`,
        mainFrameId: frameTree.frame.id, status: 'recording', recordValues, startedAt, lastInteractionAt: 0,
        lastUrl: startUrl, lastUrlDigest: digest, lastRecordedUrlDigest: digest, contexts: {},
      };
      const session: SessionRecord = {
        id: sessionId, status: 'recording', startedAt, updatedAt: startedAt, tabId, startUrl, origin, recordValues,
        browser: browserLabel(), viewport: viewport && viewport.width > 0 && viewport.height > 0 ? viewport : null, interruption: null, gaps: [],
        counts: { interactions: 0, console: 0, network: 0, unsupported: 0, dropped: 0 }, notes: [], hasScreenshot: false,
      };
      await putSession(session);
      created = true;
      await saveActive(active);
      pendingRequests.clear();
      await send(tabId, 'Page.enable');
      await send(tabId, 'Runtime.enable');
      await send(tabId, 'Network.enable', { maxPostDataSize: 0, maxResourceBufferSize: 0, maxTotalBufferSize: 0 });
      await send(tabId, 'Runtime.addBinding', { name: active.bindingName, executionContextName: active.worldName });
      await registerScript(active, false);
      const world = await send<{ executionContextId: number }>(tabId, 'Page.createIsolatedWorld', { frameId: active.mainFrameId, worldName: active.worldName });
      active.contextId = world.executionContextId;
      await saveActive(active);
      await send(tabId, 'Runtime.evaluate', { expression: await scriptFor(active, false), contextId: world.executionContextId });
      await storeInteraction(active, { id: crypto.randomUUID(), sequence: 0, type: 'navigation', timestamp: startedAt, elapsedMs: 0, url: startUrl, causedByAction: false });
      await setBadge(tabId, 'recording');
      return { sessionId };
    } catch (error) {
      await saveActive(null);
      await chrome.debugger.detach({ tabId }).catch(() => undefined);
      if (created) await deleteSessionData(sessionId).catch(() => undefined);
      throw error instanceof StorageError ? error : new Error(error instanceof Error ? error.message : 'Recording could not start.');
    }
  });
}

/** Ends the active recording. Callers must hold the queue. */
async function finish(active: ActiveRecording, status: 'completed' | 'interrupted', detail: SessionRecord['interruption'], attached = true) {
  // Mark the session stopped in memory first so nothing else is accepted, persist its final status, and only
  // then clear the coordination state that the side panel watches.
  cache = null;
  pendingRequests.clear();
  try {
    if (attached) {
      await evaluateInWorld(active, 'globalThis.__bugreelCapture?.shutdown()').catch(() => undefined);
      if (active.scriptId) await send(active.tabId, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: active.scriptId }).catch(() => undefined);
      await send(active.tabId, 'Runtime.removeBinding', { name: active.bindingName }).catch(() => undefined);
      await chrome.debugger.detach({ tabId: active.tabId }).catch(() => undefined);
    }
    await setBadge(active.tabId, null);
    await updateSession(active.sessionId, session => finishSession(session, status, new Date().toISOString(), detail)).catch(() => undefined);
  } finally {
    await saveActive(null);
  }
}

async function interrupt(active: ActiveRecording, reason: Parameters<typeof interruption>[0], attached: boolean, detail?: string) {
  await finish(active, 'interrupted', interruption(reason, detail), attached);
}

export async function stop() {
  const active = await serialize(async () => {
    const current = await loadActive();
    assertCommand('stop', current);
    current!.status = 'stopping';
    await saveActive(current);
    return current!;
  });
  // Flush typing that is still debounced in the page. Events emitted by the flush are delivered before this
  // command's response, so they are queued ahead of the final step below.
  await evaluateInWorld(active, 'globalThis.__bugreelCapture?.shutdown()').catch(() => undefined);
  await serialize(async () => {
    const current = await loadActive();
    if (current?.sessionId === active.sessionId) await finish(current, 'completed', null);
  });
  return { sessionId: active.sessionId };
}

export async function pause() {
  const active = await loadActive();
  assertCommand('pause', active);
  await evaluateInWorld(active!, 'globalThis.__bugreelCapture?.flush()').catch(() => undefined);
  await serialize(async () => {
    const current = await loadActive();
    assertCommand('pause', current);
    const now = new Date().toISOString();
    current!.status = 'paused';
    await registerScript(current!, true).catch(() => undefined);
    await saveActive(current);
    await updateSession(current!.sessionId, session => {
      session.status = 'paused';
      session.gaps.push({ id: crypto.randomUUID(), reason: 'paused', startedAt: now, endedAt: null, startElapsedMs: Math.max(0, Date.parse(now) - Date.parse(session.startedAt)), endElapsedMs: null });
    });
    await evaluateInWorld(current!, 'globalThis.__bugreelCapture?.setPaused(true)').catch(() => undefined);
    await setBadge(current!.tabId, 'paused');
  });
}

export function resume() {
  return serialize(async () => {
    const current = await loadActive();
    assertCommand('resume', current);
    const now = new Date().toISOString();
    current!.status = 'recording';
    await registerScript(current!, false).catch(() => undefined);
    await saveActive(current);
    await updateSession(current!.sessionId, session => {
      session.status = 'recording';
      for (const gap of session.gaps) if (gap.endedAt === null) { gap.endedAt = now; gap.endElapsedMs = Math.max(0, Date.parse(now) - Date.parse(session.startedAt)); }
    });
    await evaluateInWorld(current!, 'globalThis.__bugreelCapture?.setPaused(false)').catch(() => undefined);
    // If the page changed while paused, anchor the following steps at the page where recording resumed.
    if (current!.lastUrlDigest !== current!.lastRecordedUrlDigest) {
      await storeInteraction(current!, { id: crypto.randomUUID(), sequence: 0, type: 'navigation', timestamp: now, elapsedMs: Math.max(0, Date.parse(now) - Date.parse(current!.startedAt)), url: current!.lastUrl, causedByAction: false });
    }
    await setBadge(current!.tabId, 'recording');
  });
}

export function captureScreenshot() {
  return serialize(async () => {
    const active = await loadActive();
    assertCommand('screenshot', active);
    await evaluateInWorld(active!, 'globalThis.__bugreelCapture?.hideIndicator(true)').catch(() => undefined);
    try {
      const { data } = await withTimeout(send<{ data: string }>(active!.tabId, 'Page.captureScreenshot', { format: 'png' }), 15_000, 'The screenshot timed out. Make sure the recorded tab is visible and try again.');
      const binary = atob(data);
      if (binary.length > MAX_SCREENSHOT_BYTES) throw new Error('The screenshot is too large to store.');
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const size = pngSize(bytes);
      if (!size) throw new Error('Chrome returned an invalid screenshot.');
      await putScreenshot({ sessionId: active!.sessionId, blob: new Blob([bytes], { type: 'image/png' }), ...size, byteLength: bytes.length, capturedAt: new Date().toISOString() });
      return size;
    } finally {
      await evaluateInWorld(active!, 'globalThis.__bugreelCapture?.hideIndicator(false)').catch(() => undefined);
    }
  });
}

export function deleteSession(sessionId: string) {
  return serialize(async () => {
    if ((await loadActive())?.sessionId === sessionId) throw new Error('Stop the recording before deleting it.');
    await deleteSessionData(sessionId);
  });
}

// ------------------------------------------------------------------------------------------------
// Captured data

async function persist(active: ActiveRecording, record: EventRecord, accept: (session: SessionRecord) => boolean) {
  try {
    return await appendEvent(record, accept);
  } catch (error) {
    await interrupt(active, 'storage-error', true, error instanceof Error ? error.message : undefined);
    return undefined;
  }
}

async function storeInteraction(active: ActiveRecording, event: RecordedEvent) {
  const result = await persist(active, { sessionId: active.sessionId, id: event.id, kind: 'interaction', event }, session => {
    if (session.counts.interactions >= MAX_INTERACTIONS) { session.counts.dropped++; return false; }
    event.sequence = session.counts.interactions++;
    return true;
  });
  if (event.type === 'navigation') active.lastRecordedUrlDigest = active.lastUrlDigest;
  else active.lastInteractionAt = Date.now();
  if (result && result.session.counts.interactions >= MAX_INTERACTIONS) await interrupt(active, 'limit-reached', true);
  else if (result) await saveActive(active);
}

async function storeEvidence(active: ActiveRecording, record: EventRecord) {
  await persist(active, record, session => {
    const key = record.kind === 'console' ? 'console' : record.kind === 'network' ? 'network' : 'unsupported';
    const limit = key === 'console' ? MAX_CONSOLE : key === 'network' ? MAX_NETWORK : MAX_UNSUPPORTED;
    if (session.counts[key] >= limit) { session.counts.dropped++; return false; }
    session.counts[key]++;
    return true;
  });
}

const capturing = (active: ActiveRecording) => active.status === 'recording' || active.status === 'stopping';
const MAX_CONTEXTS = 200;

/** Remembers which frame owns an execution context. The map is persisted so it survives worker restarts. */
function rememberContext(active: ActiveRecording, contextId: unknown, frameId: unknown) {
  if (typeof contextId !== 'number' || typeof frameId !== 'string') return;
  const keys = Object.keys(active.contexts);
  if (keys.length >= MAX_CONTEXTS) delete active.contexts[keys[0]];
  active.contexts[String(contextId)] = frameId;
}

/**
 * Documented scope policy: console, exception, and network evidence is kept only when it can be attributed to the
 * selected tab's main frame. Same-process child frames share the tab's debugger target, so anything from another
 * frame, or from a context or request whose frame is unknown, is counted as out of scope and not stored.
 */
const inMainFrame = (active: ActiveRecording, frameId: unknown) => typeof frameId === 'string' && frameId === active.mainFrameId;
const contextInMainFrame = (active: ActiveRecording, contextId: unknown) => contextId !== undefined && inMainFrame(active, active.contexts[String(contextId)]);

async function countOutOfScope(active: ActiveRecording) {
  await updateSession(active.sessionId, session => { session.counts.outOfScope = (session.counts.outOfScope ?? 0) + 1; }).catch(() => undefined);
}
/** CDP Runtime timestamps are milliseconds since the epoch. */
const beforeStart = (active: ActiveRecording, timestamp: unknown) => typeof timestamp === 'number' && timestamp < Date.parse(active.startedAt);
const ownContext = (active: ActiveRecording, contextId: unknown) => contextId !== undefined && (contextId === active.contextId || contextId === active.previousContextId);

type Params = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function onBinding(active: ActiveRecording, params: Params) {
  if (params.name !== active.bindingName) return;
  const now = Date.now();
  const current = params.executionContextId === active.contextId;
  const previous = !current && params.executionContextId === active.previousContextId && now - (active.contextSwitchedAt ?? 0) < PREVIOUS_DOCUMENT_GRACE_MS;
  if (!current && !previous) return;
  const parsed = parsePayload(params.payload, active);
  if (!parsed) return;
  if (current) {
    if (!active.contextDoc) active.contextDoc = parsed.doc;
    else if (active.contextDoc !== parsed.doc) return;
  } else if (active.previousContextDoc && active.previousContextDoc !== parsed.doc) return;
  if (!capturing(active)) return;
  if (parsed.kind === 'unsupported') {
    const elapsed = Math.max(0, parsed.ts - Date.parse(active.startedAt));
    await storeEvidence(active, { sessionId: active.sessionId, id: crypto.randomUUID(), kind: 'unsupported', item: { id: crypto.randomUUID(), reason: parsed.reason, description: parsed.description, timestamp: new Date(Date.parse(active.startedAt) + elapsed).toISOString(), elapsedMs: elapsed, url: sanitizeUrl(parsed.url).url } });
    active.lastInteractionAt = now;
    await saveActive(active);
    return;
  }
  if (selectorLooksSensitive(parsed.selector)) {
    await storeEvidence(active, { sessionId: active.sessionId, id: crypto.randomUUID(), kind: 'unsupported', item: { id: crypto.randomUUID(), reason: 'no-selector', description: 'An element identifier looked like personal or secret data and was not recorded', ...clockFor(active, parsed.ts) } });
    return;
  }
  await storeInteraction(active, interactionEvent(parsed, crypto.randomUUID(), 0, active.startedAt));
}

const clockFor = (active: ActiveRecording, ts: number) => {
  const at = Math.max(ts, Date.parse(active.startedAt));
  return { timestamp: new Date(at).toISOString(), elapsedMs: at - Date.parse(active.startedAt) };
};

const TYPED = ['typed', 'address_bar', 'auto_bookmark', 'generated', 'keyword', 'keyword_generated', 'auto_toplevel'];

async function onNavigation(active: ActiveRecording, url: string, sameDocument: boolean) {
  if (active.status === 'stopping') return;
  if (originOf(url) !== active.origin) {
    const destination = originOf(url);
    await interrupt(active, 'cross-origin-navigation', true, destination ? `Destination: ${destination}.` : undefined);
    return;
  }
  // The raw URL from the CDP event is transient; only its sanitized form and a salted digest are retained.
  const sanitized = sanitizeUrl(url).url;
  active.lastUrl = sanitized;
  active.lastUrlDigest = await urlDigest(active, url);
  if (active.status === 'paused') { await saveActive(active); return; }
  let reload = false;
  let typed = false;
  if (!sameDocument) {
    const history = await send<{ currentIndex: number; entries: { url: string; transitionType: string }[] }>(active.tabId, 'Page.getNavigationHistory').catch(() => undefined);
    const transition = history?.entries[history.currentIndex]?.transitionType;
    reload = transition === 'reload';
    typed = !!transition && TYPED.includes(transition);
  }
  const now = Date.now();
  await storeInteraction(active, {
    id: crypto.randomUUID(), sequence: 0, type: 'navigation', ...clockFor(active, now), url: sanitized,
    causedByAction: !reload && !typed && now - active.lastInteractionAt < ACTION_NAVIGATION_WINDOW_MS,
    ...(reload ? { reload: true } : {}), ...(sameDocument ? { sameDocument: true } : {}),
  });
}

async function onCdpEvent(source: chrome.debugger.Debuggee, method: string, params: Params) {
  const active = await loadActive();
  if (!active || source.tabId !== active.tabId) return;
  const now = Date.now();
  switch (method) {
    case 'Runtime.executionContextCreated': {
      const context = params.context;
      rememberContext(active, context?.id, context?.auxData?.frameId);
      if (context?.name === active.worldName && context?.auxData?.frameId === active.mainFrameId && context.id !== active.contextId) {
        Object.assign(active, { previousContextId: active.contextId, previousContextDoc: active.contextDoc, contextId: context.id, contextDoc: undefined, contextSwitchedAt: now });
      }
      await saveActive(active);
      return;
    }
    case 'Runtime.executionContextDestroyed':
      delete active.contexts[String(params.executionContextId)];
      await saveActive(active);
      return;
    case 'Runtime.executionContextsCleared':
      active.contexts = {};
      await saveActive(active);
      return;
    case 'Runtime.bindingCalled': return onBinding(active, params);
    case 'Page.frameNavigated': {
      const frame = params.frame;
      if (!frame || frame.parentId) return;
      active.mainFrameId = frame.id;
      const url = frame.unreachableUrl && originOf(frame.unreachableUrl) === active.origin ? frame.unreachableUrl : `${frame.url}${frame.urlFragment ?? ''}`;
      return onNavigation(active, url, false);
    }
    case 'Page.navigatedWithinDocument':
      if (params.frameId === active.mainFrameId) return onNavigation(active, params.url, true);
      return;
    case 'Runtime.consoleAPICalled': {
      // Runtime.enable replays messages logged earlier in the page's lifetime; only keep those from this session.
      if (!capturing(active) || ownContext(active, params.executionContextId) || beforeStart(active, params.timestamp)) return;
      if (params.type !== 'error' && params.type !== 'assert') return;
      if (!contextInMainFrame(active, params.executionContextId)) return countOutOfScope(active);
      const item = consoleItem(params, crypto.randomUUID(), active.startedAt, now);
      if (item) await storeEvidence(active, { sessionId: active.sessionId, id: item.id, kind: 'console', item });
      return;
    }
    case 'Runtime.exceptionThrown': {
      const details = params.exceptionDetails;
      if (!capturing(active) || !details || ownContext(active, details.executionContextId) || beforeStart(active, params.timestamp)) return;
      if (!contextInMainFrame(active, details.executionContextId)) return countOutOfScope(active);
      const item = exceptionItem(details, crypto.randomUUID(), active.startedAt, now);
      await storeEvidence(active, { sessionId: active.sessionId, id: item.id, kind: 'console', item });
      return;
    }
    case 'Network.requestWillBeSent': {
      if (!capturing(active) || typeof params.requestId !== 'string' || typeof params.request?.url !== 'string' || !/^https?:/.test(params.request.url)) return;
      // Scope is the initiating frame, not the destination: main-frame requests to other origins are kept,
      // requests from embedded frames or without a frame id are not.
      if (!inMainFrame(active, params.frameId)) return countOutOfScope(active);
      if (pendingRequests.size >= MAX_PENDING_REQUESTS) pendingRequests.delete(pendingRequests.keys().next().value!);
      pendingRequests.set(params.requestId, { method: normalizeMethod(params.request.method), url: params.request.url });
      return;
    }
    case 'Network.responseReceived': {
      const request = pendingRequests.get(params.requestId);
      if (!request || !capturing(active)) return;
      const item = httpItem({ ...request, url: params.response?.url || request.url }, params.response ?? {}, params.type, crypto.randomUUID(), active.startedAt, now);
      if (item) await storeEvidence(active, { sessionId: active.sessionId, id: item.id, kind: 'network', item });
      return;
    }
    case 'Network.loadingFailed': {
      const request = pendingRequests.get(params.requestId);
      pendingRequests.delete(params.requestId);
      if (!request || !capturing(active)) return;
      const item = transportItem(request, params, params.type, crypto.randomUUID(), active.startedAt, now);
      if (item) await storeEvidence(active, { sessionId: active.sessionId, id: item.id, kind: 'network', item });
      return;
    }
    case 'Network.loadingFinished':
      pendingRequests.delete(params.requestId);
      return;
    case 'Inspector.targetCrashed':
      return interrupt(active, 'tab-crashed', true);
  }
}

// ------------------------------------------------------------------------------------------------
// Chrome event wiring and recovery

export function registerListeners() {
  chrome.debugger.onEvent.addListener((source, method, params) => { void serialize(() => onCdpEvent(source, method, (params ?? {}) as Params)).catch(() => undefined); });
  chrome.debugger.onDetach.addListener((source, reason) => {
    void serialize(async () => {
      const active = await loadActive();
      if (active && source.tabId === active.tabId) await interrupt(active, detachReason(reason), false);
    }).catch(() => undefined);
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    void serialize(async () => {
      const active = await loadActive();
      if (active?.tabId === tabId) await interrupt(active, 'tab-closed', false);
    }).catch(() => undefined);
  });
}

const RESTART_NOTE = 'The extension background worker restarted during this recording. Requests that were in flight at that moment may be missing from the network evidence.';

/** Runs once per service-worker start, before any queued event. Never resumes a recording after a browser restart. */
export function recover() {
  return serialize(async () => {
    const active = await loadActive();
    if (active) {
      const attached = await send(active.tabId, 'Runtime.evaluate', { expression: '0' }).then(() => true, () => false);
      if (!attached) await interrupt(active, 'access-lost', false);
      else await updateSession(active.sessionId, session => { if (!session.notes.includes(RESTART_NOTE)) session.notes.push(RESTART_NOTE); }).catch(() => undefined);
    }
    const survivor = (await loadActive())?.sessionId;
    for (const session of orphanedSessions(await listSessions(), survivor)) {
      await updateSession(session.id, record => finishSession(record, 'interrupted', record.updatedAt, interruption('browser-restart')));
    }
  });
}

export { getSession };
