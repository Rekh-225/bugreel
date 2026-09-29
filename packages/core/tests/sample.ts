import type { RecordedEvent, RecordingInput } from '../src/index';

const start = Date.parse('2026-09-01T10:00:00.000Z');
export const at = (ms: number) => new Date(start + ms).toISOString();
let counter = 0;
export const uid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export function event(type: RecordedEvent['type'], ms: number, overrides: Partial<RecordedEvent> = {}): RecordedEvent {
  return { id: uid(), sequence: 0, type, timestamp: at(ms), elapsedMs: ms, url: 'https://shop.example/cart', ...overrides };
}

export const coupon = { kind: 'role' as const, role: 'textbox' as const, value: 'Coupon code', confidence: 'stable' as const };
export const checkout = { kind: 'testId' as const, value: 'checkout', confidence: 'stable' as const };
export const password = { kind: 'label' as const, value: 'Password', confidence: 'stable' as const };

export function sampleInput(overrides: Partial<RecordingInput> = {}): RecordingInput {
  const http = { id: 'net-1', kind: 'http' as const, method: 'POST', url: 'https://shop.example/api/checkout', status: 500, statusText: 'Internal Server Error', resourceType: 'Fetch', timestamp: at(4000), elapsedMs: 4000 };
  const error = { id: 'con-1', kind: 'console' as const, message: 'Checkout failed: ORDER_SUBMISSION_FAILED for [REDACTED:email]', timestamp: at(4100), elapsedMs: 4100, url: 'https://shop.example/app.js', line: 10, column: 5 };
  return {
    generatorVersion: '0.1.0',
    exportedAt: at(60_000),
    session: {
      id: '11111111-2222-4333-8444-555555555555', status: 'completed', startedAt: at(0), stoppedAt: at(30_000), interruption: null,
      typedValuesRecorded: true, browser: 'Chromium 150', startUrl: 'https://shop.example/cart', origin: 'https://shop.example', viewport: { width: 1280, height: 800 },
    },
    events: [
      event('navigation', 0, { causedByAction: false }),
      event('input', 1000, { selector: coupon, element: { tag: 'input', ariaLabel: 'Coupon code' }, value: 'SAVE' }),
      event('input', 1500, { selector: coupon, element: { tag: 'input', ariaLabel: 'Coupon code' }, value: 'SAVE20' }),
      event('input', 2000, { selector: password, element: { tag: 'input', inputType: 'password' }, valueOmitted: 'password' }),
      event('click', 3900, { selector: checkout, element: { tag: 'button', text: 'Checkout' } }),
    ],
    console: [error],
    network: [http],
    unsupported: [],
    gaps: [],
    review: { title: 'Checkout fails with a coupon', expected: 'The order is placed.', actual: 'An error banner appears.', notes: '', excludedActionIds: [], includedEvidenceIds: ['net-1', 'con-1'], failureEvidenceId: 'net-1' },
    screenshot: null,
    ...overrides,
  };
}
