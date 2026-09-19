import { test, expect } from '@playwright/test';
import { normalizeEvents } from '../src/lib/recorder/normalize';
import type { RecordedEvent } from '../src/lib/session';

const selector = { kind: 'testId' as const, value: 'discount-code', confidence: 'stable' as const };
const event = (type: RecordedEvent['type'], overrides: Partial<RecordedEvent> = {}): RecordedEvent => ({ id: crypto.randomUUID(), sequence: 0, type, timestamp: new Date().toISOString(), elapsedMs: 0, url: 'http://127.0.0.1:3000/demo-store', selector, element: { tag: 'input', name: 'discount' }, ...overrides });

test('typing and change become one fill and submission is not doubled', () => {
  const actions = normalizeEvents([
    event('navigation', { selector: undefined }), event('click'), event('input', { value: 'S' }), event('input', { value: 'SAVE' }), event('input', { value: 'SAVE20' }), event('change', { value: 'SAVE20' }),
    event('click', { selector: { ...selector, value: 'apply-discount' }, element: { tag: 'button', text: 'Apply Discount' } }), event('submit', { viaClick: true }),
  ]);
  expect(actions.map(action => action.type)).toEqual(['goto', 'fill', 'click']);
  expect(actions[1].value).toBe('SAVE20');
});

test('keyboard submission and action-induced navigation are preserved', () => {
  const actions = normalizeEvents([event('submit', { viaClick: false }), event('navigation', { causedByAction: true })]);
  expect(actions.map(action => action.type)).toEqual(['press', 'waitForURL']);
});

test('separate edits are not collapsed across another action', () => {
  const actions = normalizeEvents([event('input', { value: 'A' }), event('click', { element: { tag: 'button' } }), event('input', { value: 'B' })]);
  expect(actions.map(action => action.type)).toEqual(['fill', 'click', 'fill']);
});
