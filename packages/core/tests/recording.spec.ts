import { test, expect } from '@playwright/test';
import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildRecording, validateRecording, type BugReelRecording } from '../src/index';
import { sampleInput } from './sample';

const schema = JSON.parse(readFileSync(path.join(__dirname, '..', 'schema', 'bugreel-recording-v1.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
const schemaValid = ajv.compile(schema);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function bothAccept(recording: unknown) {
  const own = validateRecording(recording);
  expect(own.ok ? [] : own.errors).toEqual([]);
  expect(schemaValid(recording), JSON.stringify(schemaValid.errors)).toBe(true);
}
function bothReject(recording: unknown) {
  expect(validateRecording(recording).ok).toBe(false);
  expect(schemaValid(recording)).toBe(false);
}

test('a built recording is valid under the TypeScript validator and the published JSON Schema', () => {
  const recording = clone(buildRecording(sampleInput()));
  bothAccept(recording);
  expect(recording).toMatchObject({ format: 'bugreel-recording', schemaVersion: 1, playwright: { verified: false, assertion: 'failure-signature', status: 'draft' } });
  expect(recording.actions.map(action => action.type)).toEqual(['goto', 'fill', 'fill', 'click']);
  expect(recording.requiredConfiguration).toEqual([expect.objectContaining({ key: 'BUGREEL_VALUE_1', reason: 'password' })]);
  expect(recording.actions[2]).toMatchObject({ configKey: 'BUGREEL_VALUE_1', valueOmitted: 'password' });
  expect(recording.actions[2]).not.toHaveProperty('value');
});

test('recordings without evidence, steps, or a failure signature remain valid and explain why the draft is incomplete', () => {
  const recording = clone(buildRecording(sampleInput({
    events: [sampleInput().events[0]], console: [], network: [],
    review: { title: '', expected: '', actual: 'The logo overlaps the menu.', notes: '', excludedActionIds: [], includedEvidenceIds: [], failureEvidenceId: null },
  })));
  bothAccept(recording);
  expect(recording.report.title).toBe('Bug report for shop.example');
  expect(recording.playwright.status).toBe('incomplete');
  expect(recording.playwright.assertion).toBe('none');
  expect(recording.playwright.notes.join(' ')).toMatch(/No replayable interactions.*No failure evidence was selected/);
});

test('users can remove steps and evidence before export; the failure signature is always included', () => {
  const input = sampleInput();
  const clickId = input.events[4].id;
  const recording = buildRecording({ ...input, review: { ...input.review, excludedActionIds: [clickId], includedEvidenceIds: [], failureEvidenceId: 'net-1' } });
  expect(recording.actions.some(action => action.id === clickId)).toBe(false);
  expect(recording.evidence.network.map(item => item.id)).toEqual(['net-1']);
  expect(recording.evidence.console).toEqual([]);
  expect(recording.playwright.notes.join(' ')).toContain('removed by the reporter');
});

test('gaps and interruptions are explicit', () => {
  const recording = clone(buildRecording(sampleInput({
    session: { ...sampleInput().session, status: 'interrupted', interruption: { reason: 'cross-origin-navigation', message: 'Capture stopped.' } },
    gaps: [{ id: 'gap-1', reason: 'paused', startedAt: '2026-09-01T10:00:02.500Z', endedAt: '2026-09-01T10:00:03.000Z', startElapsedMs: 2500, endElapsedMs: 3000 }],
  })));
  bothAccept(recording);
  expect(recording.playwright.status).toBe('incomplete');
  expect(recording.playwright.notes.join(' ')).toMatch(/paused once.*interrupted \(cross-origin-navigation\)/);
});

test('invalid recordings are rejected by both validators', () => {
  const valid = clone(buildRecording(sampleInput()));
  const mutations: ((recording: BugReelRecording & Record<string, unknown>) => void)[] = [
    recording => { recording.schemaVersion = 2 as 1; },
    recording => { (recording.playwright as { verified: boolean }).verified = true; },
    recording => { recording.extra = true; },
    recording => { recording.actions[1].type = 'eval' as 'click'; },
    recording => { delete (recording.actions[3] as Partial<typeof recording.actions[3]>).selector; },
    recording => { recording.actions[1].selector = { kind: 'role', value: 'x', confidence: 'stable' }; },
    recording => { recording.target.startUrl = 'javascript:alert(1)'; },
    recording => { recording.session.startedAt = 'yesterday'; },
    recording => { recording.evidence.network[0].status = 700; },
    recording => { recording.report.title = ''; },
    recording => { recording.screenshot = { fileName: '../evil.png', mimeType: 'image/png', width: 1, height: 1, byteLength: 1, capturedAt: recording.exportedAt, pixelsRedacted: false }; },
    recording => { (recording.session as { status: string }).status = 'interrupted'; },
    recording => { (recording.evidence.console[0] as { consoleType: string }).consoleType = 'warn'; },
    recording => { recording.evidence.console[0] = { ...recording.evidence.console[0], kind: 'exception', consoleType: 'error' }; },
  ];
  for (const mutate of mutations) {
    const copy = clone(valid) as BugReelRecording & Record<string, unknown>;
    mutate(copy);
    bothReject(copy);
  }
  expect(validateRecording(null).ok).toBe(false);
  const dangling = clone(valid);
  dangling.evidence.failureSignature = { evidenceId: 'missing', kind: 'http' };
  expect(validateRecording(dangling).ok).toBe(false);
});

test('consoleType is optional for compatibility with earlier recordings and accepted for console items', () => {
  const recording = clone(buildRecording(sampleInput()));
  bothAccept(recording);
  recording.evidence.console[0].consoleType = 'assert';
  bothAccept(recording);
});

test('oversized collections are rejected', () => {
  const recording = clone(buildRecording(sampleInput()));
  recording.actions = Array.from({ length: 1001 }, () => recording.actions[3]);
  bothReject(recording);
});
