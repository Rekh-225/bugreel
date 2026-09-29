// Best-effort, conservative redaction for URLs and diagnostic text. This reduces accidental
// disclosure; it cannot guarantee that every secret is detected.

export const REDACTED = 'REDACTED';
export const MAX_URL_LENGTH = 2048;
export const MAX_MESSAGE_LENGTH = 1000;

const SENSITIVE_KEY = /pass|pwd|secret|token|auth|session|sessid|^sid$|key|sig|signature|code|otp|jwt|bearer|credential|email|e-mail|mail|phone|mobile|ssn|card|cvv|cvc|iban|account|nonce|ticket|hash|state|saml|assertion|user(name)?$|login|name$/i;
const JWT = /^eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decode(value: string) {
  try { return decodeURIComponent(value.replace(/\+/g, ' ')); } catch { return value; }
}

/** Values that look like credentials, tokens, emails, or long numbers are treated as secrets regardless of their key. */
export function looksSecret(raw: string) {
  const value = decode(raw);
  if (!value) return false;
  if (JWT.test(value) || EMAIL.test(value)) return true;
  if (UUID.test(value)) return false;
  if (/\d[\d\s-]{11,}\d/.test(value) && value.replace(/\D/g, '').length >= 12) return true;
  return value.length >= 24 && /^[A-Za-z0-9_\-+/=.~%]+$/.test(value) && /\d/.test(value) && /[A-Za-z]/.test(value);
}

function sanitizeSegment(segment: string) {
  const value = decode(segment);
  if (JWT.test(value) || EMAIL.test(value)) return REDACTED;
  if (!UUID.test(value) && !/\.[A-Za-z0-9]{1,6}$/.test(value) && value.length >= 32 && /^[A-Za-z0-9_\-+/=.~%]+$/.test(value) && /\d/.test(value) && /[A-Za-z]/.test(value)) return REDACTED;
  return segment;
}

function sanitizeParams(params: string) {
  let changed = false;
  const result = params.split('&').map(pair => {
    if (!pair) return pair;
    const index = pair.indexOf('=');
    const key = index === -1 ? pair : pair.slice(0, index);
    const value = index === -1 ? '' : pair.slice(index + 1);
    if (index === -1) {
      if (looksSecret(key)) { changed = true; return REDACTED; }
      return pair;
    }
    if (value && (SENSITIVE_KEY.test(decode(key)) || looksSecret(value))) { changed = true; return `${key}=${REDACTED}`; }
    return pair;
  }).join('&');
  return { value: result, changed };
}

function sanitizePath(path: string) {
  let changed = false;
  const value = path.split('/').map(segment => {
    const next = sanitizeSegment(segment);
    if (next !== segment) changed = true;
    return next;
  }).join('/');
  return { value, changed };
}

export type SanitizedUrl = { url: string; redacted: boolean };

/** Removes credentials and conservatively redacts sensitive path segments, query values, and fragments. */
export function sanitizeUrl(input: string): SanitizedUrl {
  let url: URL;
  try { url = new URL(input); } catch { return { url: '[invalid URL omitted]', redacted: true }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { url: `${url.protocol}[omitted]`, redacted: true };
  let redacted = !!(url.username || url.password);
  const path = sanitizePath(url.pathname);
  redacted ||= path.changed;
  let search = '';
  if (url.search.length > 1) {
    const query = sanitizeParams(url.search.slice(1));
    redacted ||= query.changed;
    search = `?${query.value}`;
  }
  let hash = '';
  const fragment = url.hash.slice(1);
  if (fragment) {
    if (/^!?\//.test(fragment)) {
      const [routePath, routeQuery] = [fragment.split('?')[0], fragment.includes('?') ? fragment.slice(fragment.indexOf('?') + 1) : undefined];
      const route = sanitizePath(routePath);
      const query = routeQuery === undefined ? undefined : sanitizeParams(routeQuery);
      redacted ||= route.changed || !!query?.changed;
      hash = `#${route.value}${query ? `?${query.value}` : ''}`;
    } else if (fragment.includes('=')) {
      const params = sanitizeParams(fragment);
      redacted ||= params.changed;
      hash = `#${params.value}`;
    } else if (looksSecret(fragment) || fragment.length > 64) {
      redacted = true;
      hash = `#${REDACTED}`;
    } else hash = `#${fragment}`;
  }
  let result = `${url.protocol}//${url.host}${path.value}${search}${hash}`;
  if (result.length > MAX_URL_LENGTH) { result = `${result.slice(0, MAX_URL_LENGTH - 13)}[truncated]`; redacted = true; }
  return { url: result, redacted };
}

const TEXT_RULES: [RegExp, string | ((...match: string[]) => string)][] = [
  [/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g, '[REDACTED:jwt]'],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, (_match, scheme) => `${scheme} [REDACTED]`],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|authorization|auth|session[_-]?id|sessionid|cookie|set-cookie|otp)\b(\s*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&"'}]+)/gi, (_match, key, separator) => `${key}${separator}[REDACTED]`],
  [/[^\s@"'<>()[\]{},;:]+@[^\s@"'<>()[\]{},;:]+\.[A-Za-z]{2,}/g, '[REDACTED:email]'],
  [/\b\d(?:[ -]?\d){11,18}\b/g, '[REDACTED:number]'],
  [/\b(?=[A-Za-z0-9_\-+]*\d)(?=[A-Za-z0-9_\-+]*[A-Za-z])[A-Za-z0-9_\-+]{32,}={0,2}/g, '[REDACTED:token]'],
];
const URL_IN_TEXT = /(\bhttps?:\/\/[^\s"'<>`)\]]+)/g;

/** Bounded, conservatively redacted text for console messages, exceptions, and labels. */
export function redactText(input: unknown, max = MAX_MESSAGE_LENGTH) {
  let text = String(input ?? '').slice(0, max * 4).split(URL_IN_TEXT).map((part, index) => {
    if (index % 2 === 1) return sanitizeUrl(part).url;
    for (const [pattern, replacement] of TEXT_RULES) part = part.replace(pattern, replacement as never);
    return part;
  }).join('');
  text = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
