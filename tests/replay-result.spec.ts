import { test, expect } from '@playwright/test';
import { classifyReplay, type Expectation, type Proof, type RunnerReport } from '../src/lib/replay-result';

const proof: Proof = { completed: true, matches: true, observed: { status: 500, code: 'DISCOUNT_CHECKOUT_FAILURE' }, visible: true, expectedCode: 'DISCOUNT_CHECKOUT_FAILURE' };
const report = (status: string, errors: { message: string }[] = []): RunnerReport => ({ suites: [{ specs: [{ tests: [{ results: [{ status, errors }] }] }] }] });

test('only a passing actual test with matching evidence confirms reproduction', () => {
  expect(classifyReplay(report('passed'), 0, proof).status).toBe('confirmed');
  expect(classifyReplay(report('passed'), 0).status).toBe('error');
  expect(classifyReplay(report('passed'), 1, proof).status).toBe('error');
  expect(classifyReplay({ suites: [] }, 0, proof).status).toBe('error');
});

test('a completed healthy scenario is NOT REPRODUCED', () => {
  const healthy = { ...proof, matches: false, visible: false, observed: { status: 200, code: null } };
  expect(classifyReplay(report('failed', [{ message: 'BUGREEL_SIGNATURE_MISMATCH' }]), 1, healthy).status).toBe('not_reproduced');
});

test('selector, timeout, infrastructure, and teardown errors remain REPLAY ERROR', () => {
  for (const status of ['timedOut', 'interrupted', 'skipped']) expect(classifyReplay(report(status), 1, proof).status).toBe('error');
  expect(classifyReplay(report('failed', [{ message: 'locator.click timeout' }]), 1, { ...proof, matches: false }).status).toBe('error');
  expect(classifyReplay(report('failed', [{ message: 'BUGREEL_SIGNATURE_MISMATCH' }, { message: 'screenshot failed' }]), 1, { ...proof, matches: false }).status).toBe('error');
  expect(classifyReplay({ ...report('passed'), errors: ['worker crashed'] }, 0, proof).status).toBe('error');
});

test('local expectations classify without visible-error evidence', () => {
  const expectation: Expectation = { code: 'PAYMENT_DOWN', status: 503, requireVisible: false, method: 'POST', pathname: '/api/pay' };
  const localProof: Proof = { completed: true, matches: true, observed: { status: 503, code: 'PAYMENT_DOWN' }, visible: false, expectedCode: 'PAYMENT_DOWN' };
  expect(classifyReplay(report('passed'), 0, localProof, expectation).status).toBe('confirmed');
  const healthy = { ...localProof, matches: false, observed: { status: 200, code: 'HTTP_200' } };
  expect(classifyReplay(report('failed', [{ message: 'BUGREEL_SIGNATURE_MISMATCH' }]), 1, healthy, expectation).status).toBe('not_reproduced');
  expect(classifyReplay(report('passed'), 0, { ...localProof, expectedCode: 'DISCOUNT_CHECKOUT_FAILURE' }, expectation).status).toBe('error');
});
