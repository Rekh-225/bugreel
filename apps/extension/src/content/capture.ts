// BugReel interaction capture. This bundled content script is injected by the service worker into a
// dedicated isolated world of the selected tab's main frame (never into the page's own JavaScript world).
// It reports interactions through a per-session CDP binding. It never reads password fields, and it
// only reads other typed values when the user enabled value recording for this session.
import { ARIA_ROLES, cssEscape, cssString, plain, redactText, type AriaRole, type ElementInfo, type Selector, type ValueOmission } from '../../../../packages/core/src/index';

type Config = { sessionId: string; token: string; bindingName: string; recordValues: boolean; paused: boolean };
type Controller = { sessionId: string; setPaused(paused: boolean): void; flush(): void; shutdown(): void; hideIndicator(hidden: boolean): void };
type Scope = typeof globalThis & { __bugreelCapture?: Controller; __bugreelCaptureMain?: (config: Config) => void } & Record<string, unknown>;
const scope = globalThis as Scope;

const TEXT_TYPES = ['', 'text', 'search', 'url', 'number', 'email', 'tel', 'password', 'date', 'datetime-local', 'month', 'time', 'week'];
const TEST_ATTRIBUTES = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];
const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [onclick], [tabindex]:not([tabindex="-1"])';
const ROLE_QUERY: Record<AriaRole, string> = {
  button: 'button, input[type="submit" i], input[type="button" i], input[type="reset" i], input[type="image" i], [role="button"]',
  link: 'a[href], [role="link"]', checkbox: 'input[type="checkbox" i], [role="checkbox"]', radio: 'input[type="radio" i], [role="radio"]',
  tab: '[role="tab"]', menuitem: '[role="menuitem"]', option: 'option, [role="option"]', switch: '[role="switch"]',
  textbox: 'input, textarea, [role="textbox"]', combobox: 'select, input[list], [role="combobox"]', searchbox: 'input[type="search" i], [role="searchbox"]', spinbutton: 'input[type="number" i], [role="spinbutton"]',
};
const SENSITIVE_HINT = /pass(word|code|phrase)?|pwd|secret|token|otp|one.?time|2fa|mfa|totp|\bpin\b|ssn|social.?security|tax.?id|cvv|cvc|csc|card.?(number|no)|cc.?num|credit|iban|account.?(number|no)|routing|sort.?code|api.?key|private.?key|security.?(code|answer|question)|birth|dob\b|salary|passport|licen[cs]e.?(number|no)/i;
const SENSITIVE_AUTOCOMPLETE = /^(cc-|one-time-code|username|email|tel|bday|street-address|address-line|address-level|postal-code|name|given-name|family-name|additional-name|honorific|nickname|organization|webauthn|transaction|sex)/;

const count = (selector: string) => { try { return document.querySelectorAll(selector).length; } catch { return 0; } };
const textOf = (node: Element) => plain((node as HTMLElement).innerText ?? node.textContent ?? '', 200);
const redacted = (value: string) => redactText(value, 400) !== value;
const autoId = (id: string) => id.length > 60 || /^\d|[0-9a-f]{8,}|\d{4,}|^:r|^(ember|react|mui|radix|headlessui|rc_|jsx-|__)/i.test(id);
const isFormControl = (el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
const inputType = (el: Element) => el instanceof HTMLInputElement ? (el.getAttribute('type') || '').toLowerCase() : '';
const isTextField = (el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.includes(inputType(el)));

function roleOf(el: Element): AriaRole | undefined {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return (ARIA_ROLES as readonly string[]).includes(explicit) ? explicit as AriaRole : undefined;
  const tag = el.localName;
  if (tag === 'button') return 'button';
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : undefined;
  if (tag === 'option') return 'option';
  if (tag === 'textarea') return 'textbox';
  if (el instanceof HTMLSelectElement) return el.multiple || el.size > 1 ? undefined : 'combobox';
  if (el instanceof HTMLInputElement) {
    const type = inputType(el);
    if (type === 'checkbox' || type === 'radio') return type;
    if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
    if (el.hasAttribute('list')) return 'combobox';
    if (type === 'search') return 'searchbox';
    if (type === 'number') return 'spinbutton';
    if (['', 'text', 'email', 'tel', 'url'].includes(type)) return 'textbox';
  }
  return undefined;
}

function labelOf(el: Element) {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)).filter((node): node is HTMLElement => !!node).map(textOf).join(' ');
    if (text.trim()) return plain(text, 200);
  }
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return plain(aria, 200);
  if (isFormControl(el) && el.labels?.length) return plain([...el.labels].map(textOf).join(' '), 200);
  return '';
}

function accessibleName(el: Element) {
  const label = labelOf(el);
  if (label) return label;
  if (el instanceof HTMLInputElement) {
    const type = inputType(el);
    if (type === 'submit' || type === 'reset' || type === 'button') return plain(el.value || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : ''), 200);
    if (type === 'image') return plain(el.alt || '', 200);
  }
  if (isFormControl(el)) return plain(el.getAttribute('title') || el.getAttribute('placeholder') || '', 200);
  const content = textOf(el);
  if (content) return content;
  return plain(el.querySelector('img[alt]')?.getAttribute('alt') || el.getAttribute('title') || '', 200);
}

function countRole(role: AriaRole, name: string) {
  const candidates = document.querySelectorAll(ROLE_QUERY[role]);
  if (candidates.length > 2000) return Infinity;
  let matches = 0;
  for (const candidate of candidates) if (roleOf(candidate) === role && accessibleName(candidate) === name) matches++;
  return matches;
}

function countLabel(label: string) {
  let matches = 0;
  for (const candidate of document.querySelectorAll('input, textarea, select, [aria-label], [aria-labelledby]')) if (labelOf(candidate) === label) matches++;
  return matches;
}

function cssPath(el: Element) {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && parts.length < 12) {
    const tag = cssEscape(node.localName);
    if (node !== el && node.id && !autoId(node.id) && count(`#${cssEscape(node.id)}`) === 1) { parts.unshift(`#${cssEscape(node.id)}`); break; }
    const parent: Element | null = node.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const siblings = [...parent.children].filter(child => child.localName === node!.localName);
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
    node = parent;
  }
  return parts.join(' > ');
}

/** Picks the most stable unique selector: test IDs, then role + accessible name, labels, placeholders, IDs, names, and finally a positional CSS path. */
function selectorFor(el: Element): Selector | undefined {
  for (const attribute of TEST_ATTRIBUTES) {
    const value = el.getAttribute(attribute);
    if (!value || value.length > 200) continue;
    const css = `[${attribute}=${cssString(value)}]`;
    if (count(css) === 1) return attribute === 'data-testid' ? { kind: 'testId', value, confidence: 'stable' } : { kind: 'css', value: css, confidence: 'stable' };
  }
  const role = roleOf(el);
  if (role) {
    const name = accessibleName(el);
    if (name && name.length <= 80 && !redacted(name) && countRole(role, name) === 1) return { kind: 'role', role, value: name, confidence: 'stable' };
  }
  if (isFormControl(el)) {
    const label = labelOf(el);
    if (label && label.length <= 80 && !redacted(label) && countLabel(label) === 1) return { kind: 'label', value: label, confidence: 'stable' };
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.length <= 80 && !redacted(placeholder) && count(`[placeholder=${cssString(placeholder)}]`) === 1) return { kind: 'placeholder', value: placeholder, confidence: 'stable' };
  }
  if (el.id && !autoId(el.id) && count(`#${cssEscape(el.id)}`) === 1) return { kind: 'css', value: `#${cssEscape(el.id)}`, confidence: 'stable' };
  const name = el.getAttribute('name');
  if (name && name.length <= 100) {
    const css = `${cssEscape(el.localName)}[name=${cssString(name)}]`;
    if (count(css) === 1) return { kind: 'css', value: css, confidence: 'stable' };
  }
  const path = cssPath(el);
  if (path && count(path) === 1) return { kind: 'css', value: path, confidence: 'fallback' };
  return undefined;
}

function describe(el: Element): { selector?: Selector; element: ElementInfo } {
  const clean = (value: string | null | undefined, max = 80) => value ? redactText(plain(value, max), max) || undefined : undefined;
  const element: ElementInfo = {
    tag: el.localName.slice(0, 40),
    testId: clean(el.getAttribute('data-testid')),
    id: clean(el.id),
    name: clean(el.getAttribute('name')),
    ariaLabel: clean(labelOf(el)),
    placeholder: clean(el.getAttribute('placeholder')),
    text: isFormControl(el) && !(el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(inputType(el))) ? undefined : clean(accessibleName(el)),
    inputType: el instanceof HTMLInputElement ? inputType(el) || 'text' : undefined,
    role: roleOf(el),
  };
  return { selector: selectorFor(el), element };
}

function shortName(el: Element) {
  const name = accessibleName(el);
  return `${el.localName}${name && !redacted(name) ? ` "${plain(name, 40)}"` : ''}`;
}

function sensitivity(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): ValueOmission | null {
  if (el instanceof HTMLInputElement && inputType(el) === 'password') return 'password';
  const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
  if (autocomplete.includes('current-password') || autocomplete.includes('new-password')) return 'password';
  const security = getComputedStyle(el).getPropertyValue('-webkit-text-security');
  if (security && security !== 'none') return 'password';
  if (el.closest('[data-private], [data-sensitive], [data-bugreel-private]')) return 'sensitive';
  if (el instanceof HTMLInputElement && ['email', 'tel', 'hidden'].includes(inputType(el))) return 'sensitive';
  if (autocomplete.some(token => SENSITIVE_AUTOCOMPLETE.test(token))) return 'sensitive';
  if (SENSITIVE_HINT.test([el.getAttribute('name'), el.id, el.getAttribute('aria-label'), el.getAttribute('placeholder'), labelOf(el)].join(' '))) return 'sensitive';
  return null;
}

function createIndicator() {
  const host = document.createElement('bugreel-recording-indicator');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; right: 12px; bottom: 12px; pointer-events: none;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = '.pill{display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:#111827;color:#fff;font:600 12px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);opacity:.92}.dot{width:8px;height:8px;border-radius:50%;background:#ef4444}.paused .dot{background:#f59e0b}';
  const pill = document.createElement('div');
  pill.className = 'pill';
  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  pill.append(dot, label);
  root.append(style, pill);
  const attach = () => { if (!host.isConnected && document.documentElement) document.documentElement.appendChild(host); };
  if (document.documentElement) attach(); else document.addEventListener('DOMContentLoaded', attach, { once: true });
  return {
    update(paused: boolean) { pill.classList.toggle('paused', paused); label.textContent = paused ? 'BugReel paused' : 'BugReel recording'; attach(); },
    hide(hidden: boolean) { host.style.display = hidden ? 'none' : ''; },
    remove() { host.remove(); },
  };
}

function main(config: Config) {
  if (window !== window.top) return;
  const existing = scope.__bugreelCapture;
  if (existing?.sessionId === config.sessionId) return;
  existing?.shutdown();
  const binding = scope[config.bindingName];
  if (typeof binding !== 'function') return;
  const emit = binding as (payload: string) => void;
  const doc = crypto.randomUUID();
  const listeners = new AbortController();
  const options = { capture: true, signal: listeners.signal };
  const indicator = createIndicator();
  let sequence = 0;
  let paused = config.paused;
  let active = true;
  let pending: { element: HTMLInputElement | HTMLTextAreaElement; timer: number } | null = null;
  let clickedSubmitter: Element | null = null;
  let lastInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  const reported = new WeakMap<Element, number>();
  // Last value reported per field, kept only inside the page, so a blur-time change event does not duplicate a flushed edit.
  const reportedValue = new WeakMap<Element, string>();

  function send(payload: Record<string, unknown>) {
    if (!active || paused) return;
    try { emit(JSON.stringify({ v: 1, sessionId: config.sessionId, token: config.token, doc, seq: sequence++, ts: Date.now(), url: location.href, ...payload })); } catch { /* binding removed after stop */ }
  }
  function unsupported(reason: string, description: string, element?: Element) {
    if (element) {
      const last = reported.get(element) ?? 0;
      if (Date.now() - last < 5000) return;
      reported.set(element, Date.now());
    }
    send({ kind: 'unsupported', reason, description: plain(description, 200) });
  }
  function valuePayload(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
    const omitted = sensitivity(element) ?? (config.recordValues ? null : 'not-recorded');
    return omitted ? { valueOmitted: omitted } : { value: element.value.slice(0, 2000) };
  }
  function flushPending() {
    if (!pending) return;
    const { element, timer } = pending;
    clearTimeout(timer);
    pending = null;
    const described = describe(element);
    if (!described.selector) return unsupported('no-selector', `Typing in ${shortName(element)} could not be given a reliable selector`, element);
    reportedValue.set(element, element.value);
    send({ kind: 'interaction', type: 'input', ...described, ...valuePayload(element) });
  }

  document.addEventListener('click', event => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    flushPending();
    const origin = event.composedPath()[0];
    if (origin instanceof Element && origin !== event.target && origin.getRootNode() instanceof ShadowRoot) return unsupported('shadow-dom', `Click inside the web component ${shortName(event.target)} was not recorded`, event.target);
    const target = event.target;
    const label = target.closest('label');
    if (label?.control && !label.control.contains(target) && !target.closest('a, button, input, select, textarea')) return;
    const element = target.closest(INTERACTIVE) ?? target;
    if (element === document.body || element === document.documentElement) return;
    if (element instanceof HTMLElement && element.isContentEditable) return;
    if (element instanceof HTMLInputElement && inputType(element) === 'file') return unsupported('file-input', `File selection in ${shortName(element)} cannot be recorded`, element);
    if ((element instanceof HTMLButtonElement && element.type === 'submit') || (element instanceof HTMLInputElement && ['submit', 'image'].includes(inputType(element)))) {
      clickedSubmitter = element;
      setTimeout(() => { if (clickedSubmitter === element) clickedSubmitter = null; }, 0);
    }
    const described = describe(element);
    if (!described.selector) return unsupported('no-selector', `Click on ${shortName(element)} could not be given a reliable selector`, element);
    send({ kind: 'interaction', type: 'click', ...described });
  }, options);

  document.addEventListener('input', event => {
    if (!event.isTrusted) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.isContentEditable) return unsupported('contenteditable', `Typing in the rich-text editor ${shortName(target)} cannot be replayed`, target);
    if (!isTextField(target)) return;
    lastInput = target;
    if (pending && pending.element !== target) flushPending();
    if (pending) clearTimeout(pending.timer);
    pending = { element: target, timer: setTimeout(flushPending, 600) as unknown as number };
  }, options);

  document.addEventListener('change', event => {
    const target = event.target;
    if (target instanceof HTMLInputElement && inputType(target) === 'file') return unsupported('file-input', `File selection in ${shortName(target)} cannot be recorded`, target);
    // Select changes are accepted even when synthetic: automation tools set the value and dispatch the event
    // themselves, and pages rarely fire change on a select without a real selection.
    if (!event.isTrusted && !(target instanceof HTMLSelectElement)) return;
    if (target instanceof HTMLSelectElement) {
      flushPending();
      const described = describe(target);
      if (!described.selector) return unsupported('no-selector', `Selection in ${shortName(target)} could not be given a reliable selector`, target);
      return send({ kind: 'interaction', type: 'select', ...described, ...(target.multiple ? { valueOmitted: 'sensitive' } : valuePayload(target)) });
    }
    if (!isTextField(target)) return;
    if (pending?.element === target) return flushPending();
    if (reportedValue.get(target) === target.value) return;
    const described = describe(target);
    if (!described.selector) return;
    reportedValue.set(target, target.value);
    send({ kind: 'interaction', type: 'change', ...described, ...valuePayload(target) });
  }, options);

  document.addEventListener('keydown', event => {
    if (!event.isTrusted || event.isComposing) return;
    const target = event.target;
    if (event.key === 'Enter' && isTextField(target) && !(target instanceof HTMLTextAreaElement)) {
      flushPending();
      if (!target.form) {
        const described = describe(target);
        if (described.selector) send({ kind: 'interaction', type: 'submit', viaClick: false, ...described });
      }
    } else if (event.key === 'Escape') {
      flushPending();
      unsupported('keyboard', 'Pressed Escape; keyboard shortcuts are not replayed');
    }
  }, options);

  document.addEventListener('submit', event => {
    flushPending();
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    const input = lastInput && form.contains(lastInput) ? lastInput : form.querySelector<HTMLInputElement>('input:not([type="hidden" i]):not([type="password" i]):not([type="submit" i]):not([type="button" i])');
    const viaClick = !!clickedSubmitter && event.submitter === clickedSubmitter;
    if (viaClick) return;
    if (!input) return unsupported('no-selector', 'A form was submitted without a recordable input');
    const described = describe(input);
    if (!described.selector) return unsupported('no-selector', `Form submission from ${shortName(input)} could not be given a reliable selector`, input);
    send({ kind: 'interaction', type: 'submit', viaClick: false, ...described });
  }, options);

  document.addEventListener('drop', event => {
    if (event.isTrusted) unsupported('drag-drop', 'Drag and drop cannot be recorded');
  }, options);

  let lastFrameNotice = 0;
  window.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement instanceof HTMLIFrameElement && Date.now() - lastFrameNotice > 2000) {
        lastFrameNotice = Date.now();
        flushPending();
        unsupported('frame', 'Interaction inside an embedded frame was not recorded');
      }
    }, 0);
  }, { signal: listeners.signal });
  window.addEventListener('pagehide', flushPending, { capture: true, signal: listeners.signal });

  indicator.update(paused);
  scope.__bugreelCapture = {
    sessionId: config.sessionId,
    setPaused(next) { if (!next) pending = null; else flushPending(); paused = next; indicator.update(paused); },
    flush: flushPending,
    shutdown() { flushPending(); active = false; listeners.abort(); indicator.remove(); if (scope.__bugreelCapture?.sessionId === config.sessionId) delete scope.__bugreelCapture; },
    hideIndicator: hidden => indicator.hide(hidden),
  };
}

scope.__bugreelCaptureMain = main;
