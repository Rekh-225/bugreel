import { test, expect } from '@playwright/test';
import { normalizeCapture } from '../src/index';
import { checkout, coupon, event, password } from './sample';

test('repeated typing becomes one fill that keeps the first event id and the final value', () => {
  const first = event('input', 100, { selector: coupon, value: 'S' });
  const actions = normalizeCapture([first, event('input', 200, { selector: coupon, value: 'SAVE' }), event('change', 300, { selector: coupon, value: 'SAVE20' })]);
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ id: first.id, type: 'fill', value: 'SAVE20', label: 'Enter "SAVE20" in Coupon code' });
});

test('omitted values produce placeholders instead of values', () => {
  const actions = normalizeCapture([
    event('input', 100, { selector: password, element: { tag: 'input', inputType: 'password' }, valueOmitted: 'password' }),
    event('input', 200, { selector: coupon, valueOmitted: 'not-recorded' }),
  ]);
  expect(actions.map(action => [action.type, action.valueOmitted, action.value])).toEqual([['fill', 'password', undefined], ['fill', 'not-recorded', undefined]]);
  expect(actions[0].label).toContain('[password omitted]');
});

test('clicks on text fields are omitted, but checkbox and submit inputs are kept', () => {
  const actions = normalizeCapture([
    event('click', 100, { selector: coupon, element: { tag: 'input', inputType: 'text' } }),
    event('click', 200, { selector: { kind: 'label', value: 'Accept terms', confidence: 'stable' }, element: { tag: 'input', inputType: 'checkbox' } }),
    event('click', 300, { selector: { kind: 'role', role: 'button', value: 'Send', confidence: 'stable' }, element: { tag: 'input', inputType: 'submit' } }),
    event('click', 400, { selector: { kind: 'css', value: 'textarea', confidence: 'stable' }, element: { tag: 'textarea' } }),
  ]);
  expect(actions.map(action => action.selector?.value)).toEqual(['Accept terms', 'Send']);
});

test('submit-button clicks are not duplicated by the submit event, keyboard submission becomes Enter', () => {
  const clicked = normalizeCapture([event('click', 100, { selector: checkout, element: { tag: 'button' } }), event('submit', 110, { selector: coupon, viaClick: true })]);
  expect(clicked.map(action => action.type)).toEqual(['click']);
  const keyboard = normalizeCapture([event('submit', 100, { selector: coupon, viaClick: false }), event('submit', 150, { selector: coupon, viaClick: false })]);
  expect(keyboard.map(action => [action.type, action.value])).toEqual([['press', 'Enter']]);
});

test('navigation: duplicates collapse, redirect chains keep the destination, reloads and SPA routes are explicit', () => {
  const actions = normalizeCapture([
    event('navigation', 0, { url: 'https://shop.example/' }),
    event('navigation', 10, { url: 'https://shop.example/' }),
    event('click', 100, { selector: checkout, element: { tag: 'button' } }),
    event('navigation', 200, { url: 'https://shop.example/login', causedByAction: true }),
    event('navigation', 250, { url: 'https://shop.example/account', causedByAction: true }),
    event('navigation', 900, { url: 'https://shop.example/account', reload: true }),
    event('click', 1000, { selector: checkout, element: { tag: 'button' } }),
    event('navigation', 1100, { url: 'https://shop.example/account#/settings', causedByAction: true, sameDocument: true }),
  ]);
  expect(actions.map(action => `${action.type}:${action.url ?? action.selector?.value}`)).toEqual([
    'goto:https://shop.example/', 'click:checkout', 'waitForURL:https://shop.example/account', 'reload:https://shop.example/account', 'click:checkout', 'waitForURL:https://shop.example/account#/settings',
  ]);
});

test('separate edits of the same field are kept when another action happened between them', () => {
  const actions = normalizeCapture([event('input', 1, { selector: coupon, value: 'A' }), event('click', 2, { selector: checkout, element: { tag: 'button' } }), event('input', 3, { selector: coupon, value: 'B' })]);
  expect(actions.map(action => action.type)).toEqual(['fill', 'click', 'fill']);
});

test('events without selectors are not turned into actions and labels strip control characters', () => {
  const actions = normalizeCapture([
    event('click', 1, { element: { tag: 'div' } }),
    event('click', 2, { selector: checkout, element: { tag: 'button', text: 'Pay\u202e now\n\u0007' } }),
  ]);
  expect(actions).toHaveLength(1);
  expect(actions[0].label).toBe('Click Pay now');
});

test('select changes become selectOption actions', () => {
  const size = { kind: 'role' as const, role: 'combobox' as const, value: 'Size', confidence: 'stable' as const };
  const actions = normalizeCapture([event('select', 1, { selector: size, value: 's' }), event('select', 2, { selector: size, value: 'm' })]);
  expect(actions).toEqual([expect.objectContaining({ type: 'select', value: 'm', label: 'Select "m" in Size' })]);
});
