import { ARIA_ROLES, SELECTOR_KINDS, type Action, type RecordedEvent, type ValueOmission } from './model';
import { normalizeCapture } from './normalize';
import { plain } from './source';

export const RECORDING_FORMAT = 'bugreel-recording';
export const RECORDING_SCHEMA_VERSION = 1;

export const LIMITS = {
  actions: 1000, console: 300, network: 300, unsupported: 200, gaps: 100, notes: 50, configuration: 200,
  title: 200, text: 5000, label: 300, value: 2000, message: 1000, url: 2048, stackFrames: 5, stackFrame: 300,
} as const;

export const INTERRUPTION_REASONS = ['cross-origin-navigation', 'tab-closed', 'debugger-detached', 'browser-restart', 'access-lost', 'storage-error', 'limit-reached', 'tab-crashed'] as const;
export type InterruptionReason = typeof INTERRUPTION_REASONS[number];
export const UNSUPPORTED_REASONS = ['file-input', 'contenteditable', 'frame', 'no-selector', 'drag-drop', 'keyboard', 'shadow-dom'] as const;
export type UnsupportedReason = typeof UNSUPPORTED_REASONS[number];
const ACTION_TYPES = ['goto', 'click', 'fill', 'press', 'waitForURL', 'select', 'reload'] as const;
const OMISSIONS = ['password', 'sensitive', 'not-recorded'] as const;
const EVIDENCE_KINDS = ['console', 'exception', 'http', 'transport'] as const;
const CONFIG_REASONS = ['password', 'sensitive', 'not-recorded', 'redacted-url'] as const;

/** `consoleType` records which console API produced a `console` item. Recordings written before it existed omit
 *  it and are deliberately treated as `console.error`, which was the only type those versions recorded. */
export type ConsoleItem = { id: string; kind: 'console' | 'exception'; consoleType?: 'error' | 'assert'; message: string; timestamp: string; elapsedMs: number; url?: string; line?: number; column?: number; stack?: string[] };
export type NetworkItem = { id: string; kind: 'http' | 'transport'; method: string; url: string; status?: number; statusText?: string; error?: string; resourceType?: string; timestamp: string; elapsedMs: number };
export type UnsupportedStep = { id: string; reason: UnsupportedReason; description: string; timestamp: string; elapsedMs: number; url?: string };
export type Gap = { id: string; reason: 'paused'; startedAt: string; endedAt: string | null; startElapsedMs: number; endElapsedMs: number | null };
export type RequiredConfiguration = { key: string; reason: typeof CONFIG_REASONS[number]; description: string };
export type RecordingAction = Action & { configKey?: string };
export type ScreenshotMeta = { fileName: string; mimeType: 'image/png'; width: number; height: number; byteLength: number; capturedAt: string; pixelsRedacted: false };
export type FailureSignature = { evidenceId: string; kind: typeof EVIDENCE_KINDS[number] };

export type BugReelRecording = {
  format: typeof RECORDING_FORMAT;
  schemaVersion: typeof RECORDING_SCHEMA_VERSION;
  generator: { name: string; version: string };
  exportedAt: string;
  session: {
    id: string; status: 'completed' | 'interrupted'; startedAt: string; stoppedAt: string; durationMs: number;
    interruption: { reason: InterruptionReason; message: string } | null;
    typedValuesRecorded: boolean; browser: string | null;
  };
  target: { startUrl: string; origin: string; viewport: { width: number; height: number } | null };
  report: { title: string; expected: string; actual: string; notes: string };
  actions: RecordingAction[];
  evidence: { console: ConsoleItem[]; network: NetworkItem[]; failureSignature: FailureSignature | null };
  screenshot: ScreenshotMeta | null;
  unsupportedSteps: UnsupportedStep[];
  gaps: Gap[];
  requiredConfiguration: RequiredConfiguration[];
  playwright: { status: 'draft' | 'incomplete'; verified: false; assertion: 'failure-signature' | 'none'; notes: string[] };
};

// ---------------------------------------------------------------------------------------------
// Validation (mirrors packages/core/schema/bugreel-recording-v1.schema.json)

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CONFIG_KEY = /^BUGREEL_[A-Z0-9_]{1,40}$/;
type Errors = string[];
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

class Validator {
  errors: Errors = [];
  fail(path: string, message: string) { if (this.errors.length < 50) this.errors.push(`${path}: ${message}`); return false; }
  object(value: unknown, path: string, required: string[], optional: string[] = []): value is Record<string, unknown> {
    if (!isObject(value)) return this.fail(path, 'must be an object');
    for (const key of required) if (!(key in value)) this.fail(path, `missing ${key}`);
    for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) this.fail(path, `unexpected property ${key}`);
    return true;
  }
  string(value: unknown, path: string, max: number, min = 0, pattern?: RegExp) {
    if (typeof value !== 'string') return this.fail(path, 'must be a string');
    if (value.length < min || value.length > max) return this.fail(path, `length must be ${min}-${max}`);
    if (pattern && !pattern.test(value)) return this.fail(path, 'has an invalid format');
    return true;
  }
  url(value: unknown, path: string) {
    if (!this.string(value, path, LIMITS.url, 1, /^https?:\/\//)) return false;
    try { new URL(value as string); return true; } catch { return this.fail(path, 'must be a valid http(s) URL'); }
  }
  integer(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return this.fail(path, `must be an integer ${min}-${max}`);
    return true;
  }
  oneOf<T>(value: unknown, path: string, options: readonly T[]) {
    if (!options.includes(value as T)) return this.fail(path, `must be one of ${options.join(', ')}`);
    return true;
  }
  array(value: unknown, path: string, max: number, item: (entry: unknown, path: string) => void) {
    if (!Array.isArray(value)) return this.fail(path, 'must be an array');
    if (value.length > max) return this.fail(path, `must contain at most ${max} items`);
    value.forEach((entry, index) => item(entry, `${path}[${index}]`));
    return true;
  }
}

function validateAction(v: Validator, value: unknown, path: string) {
  if (!v.object(value, path, ['id', 'type', 'label', 'timestamp', 'elapsedMs'], ['url', 'selector', 'value', 'valueOmitted', 'configKey'])) return;
  v.string(value.id, `${path}.id`, 64, 1, ID);
  v.oneOf(value.type, `${path}.type`, ACTION_TYPES);
  v.string(value.label, `${path}.label`, LIMITS.label, 1);
  v.string(value.timestamp, `${path}.timestamp`, 40, 1, ISO);
  v.integer(value.elapsedMs, `${path}.elapsedMs`, 0);
  if ('url' in value) v.url(value.url, `${path}.url`);
  if ('value' in value) v.string(value.value, `${path}.value`, LIMITS.value);
  if ('valueOmitted' in value) v.oneOf(value.valueOmitted, `${path}.valueOmitted`, OMISSIONS);
  if ('configKey' in value) v.string(value.configKey, `${path}.configKey`, 48, 1, CONFIG_KEY);
  if ('selector' in value && v.object(value.selector, `${path}.selector`, ['kind', 'value', 'confidence'], ['role'])) {
    const selector = value.selector as Record<string, unknown>;
    v.oneOf(selector.kind, `${path}.selector.kind`, SELECTOR_KINDS);
    v.string(selector.value, `${path}.selector.value`, 500, 1);
    v.oneOf(selector.confidence, `${path}.selector.confidence`, ['stable', 'fallback']);
    if ('role' in selector) v.oneOf(selector.role, `${path}.selector.role`, ARIA_ROLES);
    if (selector.kind === 'role' && !('role' in selector)) v.fail(`${path}.selector`, 'role selectors need a role');
  }
  if ((value.type === 'goto' || value.type === 'waitForURL' || value.type === 'reload') && !('url' in value)) v.fail(path, 'navigation actions need a url');
  if (['click', 'fill', 'press', 'select'].includes(value.type as string) && !('selector' in value)) v.fail(path, 'element actions need a selector');
  if ((value.type === 'fill' || value.type === 'select') && !('value' in value) && !('configKey' in value)) v.fail(path, 'fill and select actions need a value or a configKey');
}

export function validateRecording(input: unknown): { ok: true; recording: BugReelRecording } | { ok: false; errors: string[] } {
  const v = new Validator();
  const top = ['format', 'schemaVersion', 'generator', 'exportedAt', 'session', 'target', 'report', 'actions', 'evidence', 'screenshot', 'unsupportedSteps', 'gaps', 'requiredConfiguration', 'playwright'];
  if (!v.object(input, '$', top)) return { ok: false, errors: v.errors };
  if (input.format !== RECORDING_FORMAT) v.fail('$.format', `must be ${RECORDING_FORMAT}`);
  if (input.schemaVersion !== RECORDING_SCHEMA_VERSION) v.fail('$.schemaVersion', `must be ${RECORDING_SCHEMA_VERSION}`);
  if (v.object(input.generator, '$.generator', ['name', 'version'])) {
    v.string(input.generator.name, '$.generator.name', 100, 1);
    v.string(input.generator.version, '$.generator.version', 40, 1);
  }
  v.string(input.exportedAt, '$.exportedAt', 40, 1, ISO);
  if (v.object(input.session, '$.session', ['id', 'status', 'startedAt', 'stoppedAt', 'durationMs', 'interruption', 'typedValuesRecorded', 'browser'])) {
    const s = input.session;
    v.string(s.id, '$.session.id', 64, 1, ID);
    v.oneOf(s.status, '$.session.status', ['completed', 'interrupted']);
    v.string(s.startedAt, '$.session.startedAt', 40, 1, ISO);
    v.string(s.stoppedAt, '$.session.stoppedAt', 40, 1, ISO);
    v.integer(s.durationMs, '$.session.durationMs', 0);
    if (s.interruption !== null && v.object(s.interruption, '$.session.interruption', ['reason', 'message'])) {
      v.oneOf(s.interruption.reason, '$.session.interruption.reason', INTERRUPTION_REASONS);
      v.string(s.interruption.message, '$.session.interruption.message', 500, 1);
    }
    if (s.status === 'interrupted' && s.interruption === null) v.fail('$.session.interruption', 'is required for interrupted sessions');
    if (typeof s.typedValuesRecorded !== 'boolean') v.fail('$.session.typedValuesRecorded', 'must be a boolean');
    if (s.browser !== null) v.string(s.browser, '$.session.browser', 60, 1);
  }
  if (v.object(input.target, '$.target', ['startUrl', 'origin', 'viewport'])) {
    v.url(input.target.startUrl, '$.target.startUrl');
    v.url(input.target.origin, '$.target.origin');
    if (input.target.viewport !== null && v.object(input.target.viewport, '$.target.viewport', ['width', 'height'])) {
      v.integer(input.target.viewport.width, '$.target.viewport.width', 1, 20_000);
      v.integer(input.target.viewport.height, '$.target.viewport.height', 1, 20_000);
    }
  }
  if (v.object(input.report, '$.report', ['title', 'expected', 'actual', 'notes'])) {
    v.string(input.report.title, '$.report.title', LIMITS.title, 1);
    for (const key of ['expected', 'actual', 'notes']) v.string(input.report[key], `$.report.${key}`, LIMITS.text);
  }
  v.array(input.actions, '$.actions', LIMITS.actions, (entry, path) => validateAction(v, entry, path));
  const evidenceIds = new Map<string, string>();
  if (v.object(input.evidence, '$.evidence', ['console', 'network', 'failureSignature'])) {
    v.array(input.evidence.console, '$.evidence.console', LIMITS.console, (entry, path) => {
      if (!v.object(entry, path, ['id', 'kind', 'message', 'timestamp', 'elapsedMs'], ['consoleType', 'url', 'line', 'column', 'stack'])) return;
      if (v.string(entry.id, `${path}.id`, 64, 1, ID)) evidenceIds.set(entry.id as string, entry.kind as string);
      v.oneOf(entry.kind, `${path}.kind`, ['console', 'exception']);
      if ('consoleType' in entry) {
        v.oneOf(entry.consoleType, `${path}.consoleType`, ['error', 'assert']);
        if (entry.kind !== 'console') v.fail(`${path}.consoleType`, 'is only valid for console items');
      }
      v.string(entry.message, `${path}.message`, LIMITS.message);
      v.string(entry.timestamp, `${path}.timestamp`, 40, 1, ISO);
      v.integer(entry.elapsedMs, `${path}.elapsedMs`, 0);
      if ('url' in entry) v.string(entry.url, `${path}.url`, LIMITS.url);
      if ('line' in entry) v.integer(entry.line, `${path}.line`, 0);
      if ('column' in entry) v.integer(entry.column, `${path}.column`, 0);
      if ('stack' in entry) v.array(entry.stack, `${path}.stack`, LIMITS.stackFrames, (frame, framePath) => v.string(frame, framePath, LIMITS.stackFrame));
    });
    v.array(input.evidence.network, '$.evidence.network', LIMITS.network, (entry, path) => {
      if (!v.object(entry, path, ['id', 'kind', 'method', 'url', 'timestamp', 'elapsedMs'], ['status', 'statusText', 'error', 'resourceType'])) return;
      if (v.string(entry.id, `${path}.id`, 64, 1, ID)) evidenceIds.set(entry.id as string, entry.kind as string);
      v.oneOf(entry.kind, `${path}.kind`, ['http', 'transport']);
      v.string(entry.method, `${path}.method`, 16, 1, /^[A-Z]+$/);
      v.string(entry.url, `${path}.url`, LIMITS.url, 1);
      v.string(entry.timestamp, `${path}.timestamp`, 40, 1, ISO);
      v.integer(entry.elapsedMs, `${path}.elapsedMs`, 0);
      if ('status' in entry) v.integer(entry.status, `${path}.status`, 100, 599);
      if ('statusText' in entry) v.string(entry.statusText, `${path}.statusText`, 100);
      if ('error' in entry) v.string(entry.error, `${path}.error`, 200);
      if ('resourceType' in entry) v.string(entry.resourceType, `${path}.resourceType`, 40);
      if (entry.kind === 'http' && !('status' in entry)) v.fail(path, 'http evidence needs a status');
    });
    const signature = input.evidence.failureSignature;
    if (signature !== null && v.object(signature, '$.evidence.failureSignature', ['evidenceId', 'kind'])) {
      v.oneOf(signature.kind, '$.evidence.failureSignature.kind', EVIDENCE_KINDS);
      if (evidenceIds.get(signature.evidenceId as string) !== signature.kind) v.fail('$.evidence.failureSignature', 'must reference included evidence of the same kind');
    }
  }
  if (input.screenshot !== null && v.object(input.screenshot, '$.screenshot', ['fileName', 'mimeType', 'width', 'height', 'byteLength', 'capturedAt', 'pixelsRedacted'])) {
    const shot = input.screenshot;
    v.string(shot.fileName, '$.screenshot.fileName', 100, 1, /^[A-Za-z0-9._-]+\.png$/);
    if (shot.mimeType !== 'image/png') v.fail('$.screenshot.mimeType', 'must be image/png');
    v.integer(shot.width, '$.screenshot.width', 1, 50_000);
    v.integer(shot.height, '$.screenshot.height', 1, 50_000);
    v.integer(shot.byteLength, '$.screenshot.byteLength', 1);
    v.string(shot.capturedAt, '$.screenshot.capturedAt', 40, 1, ISO);
    if (shot.pixelsRedacted !== false) v.fail('$.screenshot.pixelsRedacted', 'must be false');
  }
  v.array(input.unsupportedSteps, '$.unsupportedSteps', LIMITS.unsupported, (entry, path) => {
    if (!v.object(entry, path, ['id', 'reason', 'description', 'timestamp', 'elapsedMs'], ['url'])) return;
    v.string(entry.id, `${path}.id`, 64, 1, ID);
    v.oneOf(entry.reason, `${path}.reason`, UNSUPPORTED_REASONS);
    v.string(entry.description, `${path}.description`, LIMITS.label, 1);
    v.string(entry.timestamp, `${path}.timestamp`, 40, 1, ISO);
    v.integer(entry.elapsedMs, `${path}.elapsedMs`, 0);
    if ('url' in entry) v.string(entry.url, `${path}.url`, LIMITS.url);
  });
  v.array(input.gaps, '$.gaps', LIMITS.gaps, (entry, path) => {
    if (!v.object(entry, path, ['id', 'reason', 'startedAt', 'endedAt', 'startElapsedMs', 'endElapsedMs'])) return;
    v.string(entry.id, `${path}.id`, 64, 1, ID);
    v.oneOf(entry.reason, `${path}.reason`, ['paused']);
    v.string(entry.startedAt, `${path}.startedAt`, 40, 1, ISO);
    if (entry.endedAt !== null) v.string(entry.endedAt, `${path}.endedAt`, 40, 1, ISO);
    v.integer(entry.startElapsedMs, `${path}.startElapsedMs`, 0);
    if (entry.endElapsedMs !== null) v.integer(entry.endElapsedMs, `${path}.endElapsedMs`, 0);
  });
  v.array(input.requiredConfiguration, '$.requiredConfiguration', LIMITS.configuration, (entry, path) => {
    if (!v.object(entry, path, ['key', 'reason', 'description'])) return;
    v.string(entry.key, `${path}.key`, 60, 1);
    v.oneOf(entry.reason, `${path}.reason`, CONFIG_REASONS);
    v.string(entry.description, `${path}.description`, LIMITS.label, 1);
  });
  if (v.object(input.playwright, '$.playwright', ['status', 'verified', 'assertion', 'notes'])) {
    v.oneOf(input.playwright.status, '$.playwright.status', ['draft', 'incomplete']);
    if (input.playwright.verified !== false) v.fail('$.playwright.verified', 'must be false: BugReel never runs exported drafts');
    v.oneOf(input.playwright.assertion, '$.playwright.assertion', ['failure-signature', 'none']);
    v.array(input.playwright.notes, '$.playwright.notes', LIMITS.notes, (note, path) => v.string(note, path, 500, 1));
  }
  return v.errors.length ? { ok: false, errors: v.errors } : { ok: true, recording: input as unknown as BugReelRecording };
}

// ---------------------------------------------------------------------------------------------
// Building an export from stored capture data

export type RecordingInput = {
  generatorVersion: string;
  exportedAt: string;
  session: {
    id: string; status: 'completed' | 'interrupted'; startedAt: string; stoppedAt: string;
    interruption: { reason: InterruptionReason; message: string } | null;
    typedValuesRecorded: boolean; browser: string | null; startUrl: string; origin: string;
    viewport: { width: number; height: number } | null;
  };
  events: RecordedEvent[];
  console: ConsoleItem[];
  network: NetworkItem[];
  unsupported: UnsupportedStep[];
  gaps: Gap[];
  review: { title: string; expected: string; actual: string; notes: string; excludedActionIds: string[]; includedEvidenceIds: string[]; failureEvidenceId: string | null };
  screenshot: ScreenshotMeta | null;
};

const omissionText: Record<ValueOmission, string> = {
  password: 'password field; the value is never recorded',
  sensitive: 'field identified as potentially sensitive; the value was not recorded',
  'not-recorded': 'typed-value recording was off for this session',
};

/** Minimum length for a console or exception substring assertion to be meaningful. */
export const MIN_SIGNATURE_TEXT = 8;

/** The longest contiguous part of a redacted message that contains no redaction marker. */
export function signatureText(message: string) {
  const parts = message.split(/\[REDACTED[^\]]*\]|REDACTED|…/).map(part => part.trim()).sort((a, b) => b.length - a.length);
  const best = (parts[0] || '').slice(0, 120).trim();
  return best.length >= MIN_SIGNATURE_TEXT ? best : null;
}

/**
 * Origin and pathname a network failure assertion must match. Redacted placeholders are never treated as
 * executable values, so a URL whose origin or path was redacted yields no target.
 */
export function networkSignatureTarget(url: string): { origin: string; pathname: string } | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (/REDACTED|\[truncated\]/.test(`${parsed.origin}${parsed.pathname}`)) return null;
  return { origin: parsed.origin, pathname: parsed.pathname };
}

/** The recorded action most likely to have triggered a piece of evidence: the last one that started before it. */
export function triggerActionIndex(actions: { elapsedMs: number }[], elapsedMs: number) {
  let index = -1;
  actions.forEach((action, position) => { if (action.elapsedMs <= elapsedMs) index = position; });
  return index;
}

export function buildRecording(input: RecordingInput): BugReelRecording {
  const { session, review } = input;
  const excluded = new Set(review.excludedActionIds);
  const configuration: RequiredConfiguration[] = [];
  let valueIndex = 0;
  let urlIndex = 0;
  const normalized = normalizeCapture(input.events);
  const removed = normalized.filter(action => excluded.has(action.id)).length;
  const actions: RecordingAction[] = normalized.filter(action => !excluded.has(action.id)).slice(0, LIMITS.actions).map(action => {
    const next: RecordingAction = { ...action, label: plain(action.label, LIMITS.label) };
    if (next.valueOmitted && (next.type === 'fill' || next.type === 'select')) {
      next.configKey = `BUGREEL_VALUE_${++valueIndex}`;
      configuration.push({ key: next.configKey, reason: next.valueOmitted, description: plain(`${next.label} (${omissionText[next.valueOmitted]})`, LIMITS.label) });
    }
    if (next.url?.includes('REDACTED')) configuration.push({ key: `URL_${++urlIndex}`, reason: 'redacted-url', description: plain(`${next.label}: the URL contains redacted values. Replace REDACTED with a real value if the page requires it.`, LIMITS.label) });
    return next;
  });

  const included = new Set(review.includedEvidenceIds);
  if (review.failureEvidenceId) included.add(review.failureEvidenceId);
  const consoleItems = input.console.filter(item => included.has(item.id)).slice(0, LIMITS.console);
  const networkItems = input.network.filter(item => included.has(item.id)).slice(0, LIMITS.network);
  const failureItem = [...consoleItems, ...networkItems].find(item => item.id === review.failureEvidenceId);
  const failureSignature: FailureSignature | null = failureItem ? { evidenceId: failureItem.id, kind: failureItem.kind } : null;

  const notes: string[] = [];
  const gaps = input.gaps.slice(0, LIMITS.gaps);
  const unsupported = input.unsupported.slice(0, LIMITS.unsupported);
  const interactions = actions.filter(action => !['goto', 'waitForURL', 'reload'].includes(action.type));
  let incomplete = false;
  if (gaps.length) { incomplete = true; notes.push(`Recording was paused ${gaps.length === 1 ? 'once' : `${gaps.length} times`}. Actions performed while paused were not captured, so the scenario is incomplete. The draft is marked test.fixme until the missing steps are added.`); }
  if (!interactions.length) { incomplete = true; notes.push('No replayable interactions were recorded. The draft only opens the start page.'); }
  if (session.status === 'interrupted') notes.push(`Recording was interrupted (${session.interruption?.reason ?? 'unknown'}). Steps after the interruption were not captured.`);
  if (unsupported.length) notes.push(`${unsupported.length} interaction${unsupported.length === 1 ? ' was' : 's were'} not replayable (see unsupported steps). They appear as comments in the draft.`);
  if (actions.some(action => action.selector?.confidence === 'fallback')) notes.push('Some steps use positional CSS selectors that may break when the page changes. Review them before running.');
  if (removed) notes.push(`${removed} recorded step${removed === 1 ? ' was' : 's were'} removed by the reporter before export.`);
  if (configuration.some(entry => entry.reason !== 'redacted-url')) notes.push('Typed values were omitted. Set the listed BUGREEL_VALUE_* environment variables before running the draft.');
  notes.push('The draft starts from a fresh browser context. Sign-in state, cookies, and storage that existed before recording are not captured; configure authentication (for example storageState) if the page needs it.');

  let assertion: 'failure-signature' | 'none' = 'none';
  if (failureItem) {
    if ((failureItem.kind === 'console' || failureItem.kind === 'exception') && !signatureText(failureItem.message)) notes.push('The selected console evidence is too redacted to assert on. Add an assertion manually.');
    else if ((failureItem.kind === 'http' || failureItem.kind === 'transport') && !networkSignatureTarget(failureItem.url)) notes.push('The selected network evidence has no usable http(s) URL to assert on (its path may contain redacted values, which are not executable). Add an assertion manually.');
    else assertion = 'failure-signature';
  } else notes.push('No failure evidence was selected, so the draft contains no assertion. Add one that checks the reported actual behaviour.');
  if (assertion === 'failure-signature') notes.push('The generated assertion checks that the selected failure still occurs. It passes while the bug is present; it is not a fix verification.');

  const stoppedAt = session.stoppedAt;
  return {
    format: RECORDING_FORMAT,
    schemaVersion: RECORDING_SCHEMA_VERSION,
    generator: { name: 'BugReel Chrome extension', version: input.generatorVersion },
    exportedAt: input.exportedAt,
    session: {
      id: session.id, status: session.status, startedAt: session.startedAt, stoppedAt,
      durationMs: Math.max(0, Date.parse(stoppedAt) - Date.parse(session.startedAt)) || 0,
      interruption: session.interruption, typedValuesRecorded: session.typedValuesRecorded, browser: session.browser,
    },
    target: { startUrl: session.startUrl, origin: session.origin, viewport: session.viewport },
    report: {
      title: plain(review.title, LIMITS.title) || plain(`Bug report for ${new URL(session.startUrl).host}`, LIMITS.title),
      expected: review.expected.slice(0, LIMITS.text), actual: review.actual.slice(0, LIMITS.text), notes: review.notes.slice(0, LIMITS.text),
    },
    actions,
    evidence: { console: consoleItems, network: networkItems, failureSignature },
    screenshot: input.screenshot,
    unsupportedSteps: unsupported,
    gaps,
    requiredConfiguration: configuration.slice(0, LIMITS.configuration),
    playwright: { status: incomplete ? 'incomplete' : 'draft', verified: false, assertion, notes: notes.slice(0, LIMITS.notes).map(note => note.slice(0, 500)) },
  };
}
