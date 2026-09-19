import { FAILURE_CODE } from './demo';
import type { RunStatus } from './session';

export type TestResult = { status: string; errors?: { message?: string }[]; attachments?: { name: string; path?: string; body?: string }[] };
export type Suite = { suites?: Suite[]; specs?: { tests: { results: TestResult[] }[] }[] };
export type RunnerReport = { suites: Suite[]; errors?: unknown[] };
export type Proof = { completed: boolean; matches: boolean; observed?: { status: number; code: string | null }; visible: boolean; expectedCode: string };
export function reportResults(report: RunnerReport): TestResult[] {
  const visit = (suite: Suite): TestResult[] => [...(suite.specs || []).flatMap(spec => spec.tests.flatMap(test => test.results)), ...(suite.suites || []).flatMap(visit)];
  return report.suites.flatMap(visit);
}
export function classifyReplay(report: RunnerReport, exitCode: number | null, proof?: Proof): { status: Exclude<RunStatus, 'running'>; message: string } {
  const results = reportResults(report);
  const error = { status: 'error' as const, message: 'Replay could not be completed. A browser, selector, timeout, or test execution error is not a confirmed reproduction.' };
  if (report.errors?.length || results.length !== 1 || !proof?.completed || proof.expectedCode !== FAILURE_CODE) return error;
  const result = results[0];
  if (exitCode === 0 && result.status === 'passed' && !result.errors?.length && proof.matches && proof.visible && proof.observed?.status === 500 && proof.observed.code === FAILURE_CODE) {
    return { status: 'confirmed', message: 'The generated test passed and observed the same HTTP 500, error code, and visible checkout failure. The application bug remains.' };
  }
  if (exitCode === 1 && result.status === 'failed' && !proof.matches && result.errors?.length === 1 && result.errors[0].message?.includes('BUGREEL_SIGNATURE_MISMATCH')) {
    return { status: 'not_reproduced', message: `The recorded actions completed, but the expected failure signature was absent. Checkout returned HTTP ${proof.observed?.status ?? 'unknown'}.` };
  }
  return error;
}
