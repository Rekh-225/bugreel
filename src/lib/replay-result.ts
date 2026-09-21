import { CHECKOUT_PATH, FAILURE_CODE } from './demo';
import type { RunStatus, Session } from './session';

export type TestResult = { status: string; errors?: { message?: string }[]; attachments?: { name: string; path?: string; body?: string }[] };
export type Suite = { suites?: Suite[]; specs?: { tests: { results: TestResult[] }[] }[] };
export type RunnerReport = { suites: Suite[]; errors?: unknown[] };
export type Proof = { completed: boolean; matches: boolean; observed?: { status: number; code: string | null }; visible: boolean; expectedCode: string };
export type Expectation = { code: string; status: number; requireVisible: boolean; method: string; pathname: string };
export const DEMO_EXPECTATION: Expectation = { code: FAILURE_CODE, status: 500, requireVisible: true, method: 'POST', pathname: CHECKOUT_PATH };
export function expectedSignature(session: Pick<Session, 'target' | 'failure'>): Expectation {
  if (session.target === 'local') {
    if (!session.failure) throw new Error('The recording has no captured failure signature.');
    return { code: session.failure.code, status: session.failure.status, requireVisible: false, method: session.failure.method, pathname: session.failure.pathname };
  }
  return DEMO_EXPECTATION;
}
export function reportResults(report: RunnerReport): TestResult[] {
  const visit = (suite: Suite): TestResult[] => [...(suite.specs || []).flatMap(spec => spec.tests.flatMap(test => test.results)), ...(suite.suites || []).flatMap(visit)];
  return report.suites.flatMap(visit);
}
export function classifyReplay(report: RunnerReport, exitCode: number | null, proof?: Proof, expectation: Expectation = DEMO_EXPECTATION): { status: Exclude<RunStatus, 'running'>; message: string } {
  const results = reportResults(report);
  const error = { status: 'error' as const, message: 'Replay could not be completed. A browser, selector, timeout, or test execution error is not a confirmed reproduction.' };
  if (report.errors?.length || results.length !== 1 || !proof?.completed || proof.expectedCode !== expectation.code) return error;
  const result = results[0];
  if (exitCode === 0 && result.status === 'passed' && !result.errors?.length && proof.matches && (!expectation.requireVisible || proof.visible) && proof.observed?.status === expectation.status && proof.observed.code === expectation.code) {
    return { status: 'confirmed', message: expectation.requireVisible ? 'The generated test passed and observed the same HTTP 500, error code, and visible checkout failure. The application bug remains.' : `The generated test passed and observed the same HTTP ${expectation.status} (${expectation.code}) from ${expectation.method} ${expectation.pathname}. The application bug remains.` };
  }
  if (exitCode === 1 && result.status === 'failed' && !proof.matches && result.errors?.length === 1 && result.errors[0].message?.includes('BUGREEL_SIGNATURE_MISMATCH')) {
    return { status: 'not_reproduced', message: expectation.requireVisible ? `The recorded actions completed, but the expected failure signature was absent. Checkout returned HTTP ${proof.observed?.status ?? 'unknown'}.` : `The recorded actions completed, but ${expectation.method} ${expectation.pathname} did not return the expected failure signature. Observed HTTP ${proof.observed?.status ?? 'unknown'}.` };
  }
  return error;
}
