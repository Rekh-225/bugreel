// Pure transformations from untrusted inputs (content-script payloads and CDP events) to stored evidence.
import {
  ARIA_ROLES, SELECTOR_KINDS, UNSUPPORTED_REASONS, plain, redactText, sanitizeUrl,
  type ConsoleItem, type ElementInfo, type NetworkItem, type RecordedEvent, type Selector, type UnsupportedReason, type ValueOmission,
} from '../../../../packages/core/src/index';
import { MAX_PAYLOAD_BYTES } from '../shared/limits';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const optionalString = (value: unknown, max: number) => value === undefined || (typeof value === 'string' && value.length <= max);
const INTERACTION_TYPES = ['click', 'input', 'change', 'submit', 'select'] as const;
const OMISSIONS: ValueOmission[] = ['password', 'sensitive', 'not-recorded'];
const ELEMENT_KEYS = ['tag', 'testId', 'id', 'name', 'ariaLabel', 'placeholder', 'text', 'inputType', 'role'] as const;

export function originOf(url: string) {
  try { const parsed = new URL(url); return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null; } catch { return null; }
}

export type PayloadIdentity = { sessionId: string; token: string; origin: string; recordValues: boolean };
export type ParsedPayload =
  | { kind: 'interaction'; doc: string; ts: number; url: string; type: typeof INTERACTION_TYPES[number]; selector: Selector; element: ElementInfo; value?: string; valueOmitted?: ValueOmission; viaClick?: boolean }
  | { kind: 'unsupported'; doc: string; ts: number; url: string; reason: UnsupportedReason; description: string };

function parseSelector(value: unknown): Selector | null {
  if (!isObject(value)) return null;
  const { kind, value: text, confidence, role } = value;
  if (!(SELECTOR_KINDS as readonly unknown[]).includes(kind) || typeof text !== 'string' || !text || text.length > 500) return null;
  if (confidence !== 'stable' && confidence !== 'fallback') return null;
  if (role !== undefined && !(ARIA_ROLES as readonly unknown[]).includes(role)) return null;
  if (kind === 'role' && role === undefined) return null;
  return { kind: kind as Selector['kind'], value: text, confidence, ...(role ? { role: role as Selector['role'] } : {}) };
}

function parseElement(value: unknown): ElementInfo | null {
  if (!isObject(value) || typeof value.tag !== 'string' || !value.tag || value.tag.length > 40) return null;
  const element: ElementInfo = { tag: value.tag };
  for (const key of ELEMENT_KEYS) {
    if (key === 'tag') continue;
    const field = value[key];
    if (field === undefined) continue;
    if (typeof field !== 'string' || field.length > 200) return null;
    element[key] = redactText(plain(field, 120), 120);
  }
  return element;
}

/**
 * Validates a payload sent by the capture script. Returns null for anything malformed, oversized, from a
 * different session or origin, or otherwise unexpected. Values are dropped if value recording is off.
 */
export function parsePayload(raw: unknown, identity: PayloadIdentity): ParsedPayload | null {
  if (typeof raw !== 'string' || raw.length > MAX_PAYLOAD_BYTES) return null;
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return null; }
  if (!isObject(payload) || payload.v !== 1 || payload.sessionId !== identity.sessionId || payload.token !== identity.token) return null;
  const { doc, seq, ts, url, kind } = payload;
  if (typeof doc !== 'string' || !doc || doc.length > 64 || typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return null;
  if (typeof ts !== 'number' || !Number.isFinite(ts) || typeof url !== 'string' || url.length > 8192 || originOf(url) !== identity.origin) return null;
  if (kind === 'unsupported') {
    if (!(UNSUPPORTED_REASONS as readonly unknown[]).includes(payload.reason) || typeof payload.description !== 'string' || !payload.description) return null;
    return { kind, doc, ts, url, reason: payload.reason as UnsupportedReason, description: redactText(plain(payload.description, 250), 250) };
  }
  if (kind !== 'interaction' || !(INTERACTION_TYPES as readonly unknown[]).includes(payload.type)) return null;
  const selector = parseSelector(payload.selector);
  const element = parseElement(payload.element);
  if (!selector || !element) return null;
  if (!optionalString(payload.value, 2000) || (payload.valueOmitted !== undefined && !OMISSIONS.includes(payload.valueOmitted as ValueOmission))) return null;
  if (payload.viaClick !== undefined && typeof payload.viaClick !== 'boolean') return null;
  if (payload.value !== undefined && payload.valueOmitted !== undefined) return null;
  let value = payload.value as string | undefined;
  let valueOmitted = payload.valueOmitted as ValueOmission | undefined;
  const type = payload.type as typeof INTERACTION_TYPES[number];
  if ((type === 'input' || type === 'change' || type === 'select') && value === undefined && valueOmitted === undefined) return null;
  if (value !== undefined && !identity.recordValues) { value = undefined; valueOmitted = 'not-recorded'; }
  return {
    kind, doc, ts, url, type, selector, element,
    ...(value !== undefined ? { value } : {}), ...(valueOmitted ? { valueOmitted } : {}),
    ...(payload.viaClick !== undefined ? { viaClick: payload.viaClick as boolean } : {}),
  };
}

/** A selector derived from page text that redaction would alter might contain personal data. */
export const selectorLooksSensitive = (selector: Selector) => redactText(selector.value, 600) !== selector.value;

export function interactionEvent(parsed: ParsedPayload & { kind: 'interaction' }, id: string, sequence: number, startedAt: string): RecordedEvent {
  const ts = Math.max(parsed.ts, Date.parse(startedAt));
  return {
    id, sequence, type: parsed.type, timestamp: new Date(ts).toISOString(), elapsedMs: ts - Date.parse(startedAt),
    url: sanitizeUrl(parsed.url).url, selector: parsed.selector, element: parsed.element,
    ...(parsed.value !== undefined ? { value: parsed.value } : {}), ...(parsed.valueOmitted ? { valueOmitted: parsed.valueOmitted } : {}),
    ...(parsed.viaClick !== undefined ? { viaClick: parsed.viaClick } : {}),
  };
}

type RemoteObject = { type?: string; subtype?: string; value?: unknown; unserializableValue?: string; description?: string };
type CallFrame = { functionName?: string; url?: string; lineNumber?: number; columnNumber?: number };

export function formatRemoteObject(object: RemoteObject) {
  if (object.unserializableValue) return object.unserializableValue;
  if (object.type === 'string') return String(object.value ?? '');
  if (object.value !== undefined && object.type !== 'object') return String(object.value);
  if (object.subtype === 'error' && object.description) return object.description.split('\n')[0];
  return object.description || object.type || '';
}

function frames(callFrames: CallFrame[] | undefined) {
  return (callFrames ?? []).slice(0, 5).map(frame => plain(`${frame.functionName || '<anonymous>'} (${frame.url ? sanitizeUrl(frame.url).url : 'unknown'}:${(frame.lineNumber ?? 0) + 1}:${(frame.columnNumber ?? 0) + 1})`, 300));
}

function location(frame: CallFrame | undefined) {
  if (!frame?.url || !/^https?:/.test(frame.url)) return {};
  return { url: sanitizeUrl(frame.url).url, line: (frame.lineNumber ?? 0) + 1, column: (frame.columnNumber ?? 0) + 1 };
}

const clock = (startedAt: string, now: number) => ({ timestamp: new Date(now).toISOString(), elapsedMs: Math.max(0, now - Date.parse(startedAt)) });

export function consoleItem(params: { type?: string; args?: RemoteObject[]; stackTrace?: { callFrames?: CallFrame[] } }, id: string, startedAt: string, now: number): ConsoleItem | null {
  if (params.type !== 'error' && params.type !== 'assert') return null;
  // console.assert(false, ...) reports only the message arguments; Playwright's ConsoleMessage.text() does the same.
  const message = redactText((params.args ?? []).slice(0, 20).map(formatRemoteObject).join(' ') || (params.type === 'assert' ? 'Assertion failed' : '(empty console error)'));
  const stack = frames(params.stackTrace?.callFrames);
  return { id, kind: 'console', consoleType: params.type, message, ...clock(startedAt, now), ...location(params.stackTrace?.callFrames?.[0]), ...(stack.length ? { stack } : {}) };
}

export function exceptionItem(details: { text?: string; exception?: RemoteObject; url?: string; lineNumber?: number; columnNumber?: number; stackTrace?: { callFrames?: CallFrame[] } }, id: string, startedAt: string, now: number): ConsoleItem {
  const description = details.exception?.description?.split('\n')[0] || (details.exception ? formatRemoteObject(details.exception) : '') || details.text || 'Uncaught exception';
  const stack = frames(details.stackTrace?.callFrames);
  const top = details.stackTrace?.callFrames?.[0] ?? (details.url ? { url: details.url, lineNumber: details.lineNumber, columnNumber: details.columnNumber } : undefined);
  return { id, kind: 'exception', message: redactText(description), ...clock(startedAt, now), ...location(top), ...(stack.length ? { stack } : {}) };
}

export type PendingRequest = { method: string; url: string };

export function httpItem(request: PendingRequest, response: { status?: number; statusText?: string }, resourceType: string | undefined, id: string, startedAt: string, now: number): NetworkItem | null {
  const status = response.status;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 599) return null;
  return {
    id, kind: 'http', method: request.method, url: sanitizeUrl(request.url).url, status,
    ...(response.statusText ? { statusText: redactText(plain(response.statusText, 100), 100) } : {}),
    ...(resourceType ? { resourceType: plain(resourceType, 40) } : {}), ...clock(startedAt, now),
  };
}

export function transportItem(request: PendingRequest, failure: { errorText?: string; canceled?: boolean; blockedReason?: string }, resourceType: string | undefined, id: string, startedAt: string, now: number): NetworkItem | null {
  if (failure.canceled) return null;
  const error = plain([failure.errorText, failure.blockedReason && `blocked: ${failure.blockedReason}`].filter(Boolean).join(' ') || 'network error', 200);
  return { id, kind: 'transport', method: request.method, url: sanitizeUrl(request.url).url, error, ...(resourceType ? { resourceType: plain(resourceType, 40) } : {}), ...clock(startedAt, now) };
}

export const normalizeMethod = (method: unknown) => typeof method === 'string' && /^[A-Za-z]{1,16}$/.test(method) ? method.toUpperCase() : 'GET';

/** Reads width and height from a PNG IHDR chunk. */
export function pngSize(bytes: Uint8Array) {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
