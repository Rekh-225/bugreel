import { test, expect } from '@playwright/test';
import { checkCommand, detachReason, finishSession, interruption, orphanedSessions } from '../src/background/lifecycle';
import { consoleItem, exceptionItem, httpItem, parsePayload, pngSize, selectorLooksSensitive, transportItem } from '../src/background/transform';
import { recordability } from '../src/shared/urls';
import type { SessionRecord } from '../src/shared/types';

const identity = { sessionId: 's-1', token: 't-1', origin: 'https://shop.example', recordValues: false };
const base = { v: 1, sessionId: 's-1', token: 't-1', doc: 'd-1', seq: 0, ts: 1_700_000_000_000, url: 'https://shop.example/cart' };
const click = { ...base, kind: 'interaction', type: 'click', selector: { kind: 'testId', value: 'checkout', confidence: 'stable' }, element: { tag: 'button', text: 'Checkout' } };
const json = (value: unknown) => JSON.stringify(value);

test('payloads are validated: session identity, origin, structure, and size', () => {
  expect(parsePayload(json(click), identity)).toMatchObject({ kind: 'interaction', type: 'click', selector: { kind: 'testId', value: 'checkout' } });
  for (const bad of [
    { ...click, sessionId: 'other' }, { ...click, token: 'wrong' }, { ...click, v: 2 }, { ...click, url: 'https://evil.example/' }, { ...click, url: 'javascript:alert(1)' },
    { ...click, type: 'eval' }, { ...click, selector: { kind: 'xpath', value: '//a', confidence: 'stable' } }, { ...click, selector: { kind: 'role', value: 'x', confidence: 'stable' } },
    { ...click, element: { tag: 'x'.repeat(41) } }, { ...click, element: 'button' }, { ...click, doc: '' }, { ...click, seq: -1 }, { ...click, kind: 'unsupported', reason: 'magic', description: 'x' },
    { ...click, value: 'x', valueOmitted: 'password' }, { ...base, kind: 'interaction', type: 'input', selector: click.selector, element: click.element },
  ]) expect(parsePayload(json(bad), identity), json(bad)).toBeNull();
  expect(parsePayload('not json', identity)).toBeNull();
  expect(parsePayload(json({ ...click, element: { tag: 'button', text: 'x'.repeat(20_000) } }), identity)).toBeNull();
  expect(parsePayload(42, identity)).toBeNull();
});

test('typed values are dropped by the worker unless the session records values; sensitive omissions are preserved', () => {
  const typed = { ...base, kind: 'interaction', type: 'input', selector: click.selector, element: { tag: 'input' }, value: 'SAVE20' };
  expect(parsePayload(json(typed), identity)).toMatchObject({ valueOmitted: 'not-recorded' });
  expect(parsePayload(json(typed), identity)).not.toHaveProperty('value');
  expect(parsePayload(json(typed), { ...identity, recordValues: true })).toMatchObject({ value: 'SAVE20' });
  expect(parsePayload(json({ ...typed, value: undefined, valueOmitted: 'password' }), { ...identity, recordValues: true })).toMatchObject({ valueOmitted: 'password' });
  const element = parsePayload(json({ ...click, element: { tag: 'button', text: 'Signed in as alice@example.com' } }), identity);
  expect(element?.kind === 'interaction' && element.element.text).toBe('Signed in as [REDACTED:email]');
  expect(selectorLooksSensitive({ kind: 'text', value: 'alice@example.com', confidence: 'fallback' })).toBe(true);
  expect(selectorLooksSensitive({ kind: 'testId', value: 'checkout', confidence: 'stable' })).toBe(false);
});

test('CDP diagnostics become bounded, redacted evidence', () => {
  const startedAt = '2026-09-01T10:00:00.000Z';
  const now = Date.parse(startedAt) + 1500;
  const item = consoleItem({ type: 'error', args: [{ type: 'string', value: 'Failed for bob@example.com' }, { type: 'object', subtype: 'error', description: 'TypeError: boom\n    at x' }], stackTrace: { callFrames: [{ functionName: 'submit', url: 'https://shop.example/app.js?token=abc123', lineNumber: 9, columnNumber: 4 }] } }, 'c1', startedAt, now);
  expect(item).toMatchObject({ kind: 'console', message: 'Failed for [REDACTED:email] TypeError: boom', elapsedMs: 1500, url: 'https://shop.example/app.js?token=REDACTED', line: 10, column: 5 });
  expect(consoleItem({ type: 'log', args: [] }, 'c2', startedAt, now)).toBeNull();
  const exception = exceptionItem({ text: 'Uncaught', exception: { type: 'object', subtype: 'error', description: 'Error: Fixture exception\n    at click (https://shop.example/app.js:3:1)' }, stackTrace: { callFrames: Array.from({ length: 9 }, (_, index) => ({ functionName: `f${index}`, url: 'https://shop.example/app.js', lineNumber: index, columnNumber: 0 })) } }, 'e1', startedAt, now);
  expect(exception).toMatchObject({ kind: 'exception', message: 'Error: Fixture exception' });
  expect(exception.stack).toHaveLength(5);
  expect(httpItem({ method: 'POST', url: 'https://shop.example/api/checkout?session=abc' }, { status: 500, statusText: 'Internal Server Error' }, 'Fetch', 'n1', startedAt, now)).toMatchObject({ kind: 'http', status: 500, url: 'https://shop.example/api/checkout?session=REDACTED', resourceType: 'Fetch' });
  expect(httpItem({ method: 'GET', url: 'https://shop.example/' }, { status: 200 }, 'Document', 'n2', startedAt, now)).toBeNull();
  expect(transportItem({ method: 'GET', url: 'https://shop.example/x' }, { errorText: 'net::ERR_ABORTED', canceled: true }, 'Fetch', 'n3', startedAt, now)).toBeNull();
  expect(transportItem({ method: 'GET', url: 'https://shop.example/x' }, { errorText: 'net::ERR_EMPTY_RESPONSE' }, 'Fetch', 'n4', startedAt, now)).toMatchObject({ kind: 'transport', error: 'net::ERR_EMPTY_RESPONSE' });
  expect(pngSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 0, 0, 0, 0, 200]))).toEqual({ width: 256, height: 200 });
  expect(pngSize(new Uint8Array(10))).toBeNull();
});

test('lifecycle rules: valid commands per state, interruption messages, gap closing, and orphan detection', () => {
  expect(checkCommand('start', null)).toBeNull();
  expect(checkCommand('start', 'recording')).toMatch(/already in progress/);
  expect(checkCommand('pause', 'paused')).toMatch(/already paused/);
  expect(checkCommand('resume', 'recording')).toMatch(/not paused/);
  expect(checkCommand('stop', 'stopping')).toMatch(/already stopping/);
  expect(checkCommand('screenshot', null)).toMatch(/only be captured/);
  expect(checkCommand('screenshot', 'paused')).toBeNull();
  expect(detachReason('canceled_by_user')).toBe('debugger-detached');
  expect(detachReason('target_closed')).toBe('tab-closed');
  expect(interruption('cross-origin-navigation', 'Destination: https://other.example.').message).toContain('Destination: https://other.example.');

  const session: SessionRecord = {
    id: 'a', status: 'paused', startedAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:05.000Z', tabId: 1, startUrl: 'https://shop.example/', origin: 'https://shop.example',
    recordValues: false, browser: null, viewport: null, interruption: null, notes: [], hasScreenshot: false,
    gaps: [{ id: 'g', reason: 'paused', startedAt: '2026-09-01T10:00:03.000Z', endedAt: null, startElapsedMs: 3000, endElapsedMs: null }],
    counts: { interactions: 0, console: 0, network: 0, unsupported: 0, dropped: 0 },
  };
  const finished = finishSession({ ...session, gaps: session.gaps.map(gap => ({ ...gap })) }, 'interrupted', '2026-09-01T10:00:10.000Z', interruption('browser-restart'));
  expect(finished).toMatchObject({ status: 'interrupted', stoppedAt: '2026-09-01T10:00:10.000Z', interruption: { reason: 'browser-restart' } });
  expect(finished.gaps[0]).toMatchObject({ endedAt: '2026-09-01T10:00:10.000Z', endElapsedMs: 10_000 });
  expect(finishSession({ ...session }, 'completed', '2026-09-01T10:00:10.000Z', interruption('tab-closed')).interruption).toBeNull();
  expect(orphanedSessions([session, { ...session, id: 'b', status: 'completed' }, { ...session, id: 'c', status: 'recording' }], 'c').map(item => item.id)).toEqual(['a']);
});

test('recordability explains restricted, local, and non-web pages', () => {
  expect(recordability('https://shop.example/cart')).toEqual({ supported: true });
  expect(recordability('http://localhost:3000/')).toEqual({ supported: true });
  expect(recordability('chrome://extensions')).toMatchObject({ supported: false, reason: expect.stringContaining('chrome://') });
  expect(recordability('file:///C:/report.html')).toMatchObject({ supported: false, reason: expect.stringContaining('file://') });
  expect(recordability('https://chromewebstore.google.com/detail/x')).toMatchObject({ supported: false, reason: expect.stringContaining('Chrome Web Store') });
  expect(recordability(undefined)).toMatchObject({ supported: false });
  expect(recordability('about:blank')).toMatchObject({ supported: false });
});
