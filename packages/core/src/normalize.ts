import type { Action, RecordedEvent, Selector } from './model';
import { plain } from './source';

export const sameSelector = (a?: Selector, b?: Selector) => !!a && !!b && a.kind === b.kind && a.value === b.value && a.role === b.role;
const elementName = (event: RecordedEvent) => event.element?.text || event.element?.ariaLabel || event.element?.placeholder || event.element?.name || event.selector?.value || 'element';

/** Normalization used by the local application's Playwright recorder. Behaviour is intentionally frozen. */
export function normalizeEvents(events: RecordedEvent[]): Action[] {
  const actions: Action[] = [];
  for (const event of events) {
    const base = { id: event.id, timestamp: event.timestamp, elapsedMs: event.elapsedMs };
    const name = elementName(event);
    if (event.type === 'navigation') {
      if (actions.at(-1)?.url === event.url) continue;
      actions.push({ ...base, type: event.causedByAction ? 'waitForURL' : 'goto', url: event.url, label: `${event.causedByAction ? 'Navigate to' : 'Open'} ${new URL(event.url).pathname}` });
    } else if (event.type === 'input' || event.type === 'change') {
      if (!event.selector || event.value === undefined) continue;
      const previous = actions.at(-1);
      const action: Action = { ...base, type: 'fill', selector: event.selector, value: event.value, label: `Enter ${JSON.stringify(event.value)} in ${name}` };
      if (previous?.type === 'fill' && sameSelector(previous.selector, event.selector)) actions[actions.length - 1] = action;
      else actions.push(action);
    } else if (event.type === 'click') {
      if (!event.selector || ['input', 'textarea', 'select'].includes(event.element?.tag || '')) continue;
      actions.push({ ...base, type: 'click', selector: event.selector, label: `Click ${name}` });
    } else if (event.type === 'submit' && !event.viaClick && event.selector) {
      actions.push({ ...base, type: 'press', selector: event.selector, value: 'Enter', label: `Submit ${name}` });
    }
  }
  return actions;
}

const CLICKABLE_INPUTS = ['checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'color', 'range'];
const omittedLabel = { password: '[password omitted]', sensitive: '[sensitive value omitted]', 'not-recorded': '[value not recorded]' } as const;

/**
 * Normalization for extension captures. Compared with `normalizeEvents` it also supports omitted values,
 * select elements, checkbox/radio/submit inputs, reloads, and client-side redirect chains, and it always
 * produces human-readable labels without control characters.
 * Events without a reliable selector are skipped here; callers report them as unsupported steps.
 */
export function normalizeCapture(events: RecordedEvent[]): Action[] {
  const actions: Action[] = [];
  let interactionSinceNavigation = true;
  for (const event of events) {
    const base = { id: event.id, timestamp: event.timestamp, elapsedMs: event.elapsedMs };
    const name = plain(elementName(event), 80);
    const previous = actions.at(-1);
    if (event.type === 'navigation') {
      let path: string;
      try { const url = new URL(event.url); path = `${url.pathname}${url.search}${url.hash}`; } catch { continue; }
      if (event.reload) {
        actions.push({ ...base, type: 'reload', url: event.url, label: `Reload ${plain(path, 120)}` });
        interactionSinceNavigation = false;
        continue;
      }
      if (previous?.url === event.url && (previous.type === 'goto' || previous.type === 'waitForURL')) continue;
      const type = event.causedByAction ? 'waitForURL' : 'goto';
      const action: Action = { ...base, type, url: event.url, label: `${type === 'goto' ? 'Open' : 'Wait for navigation to'} ${plain(path, 120)}` };
      // A client-side redirect chain without user interaction only needs its final destination.
      if (type === 'waitForURL' && previous?.type === 'waitForURL' && !interactionSinceNavigation) actions[actions.length - 1] = action;
      else actions.push(action);
      interactionSinceNavigation = false;
      continue;
    }
    if (!event.selector) continue;
    interactionSinceNavigation = true;
    if (event.type === 'input' || event.type === 'change') {
      if (event.value === undefined && !event.valueOmitted) continue;
      const shown = event.valueOmitted ? omittedLabel[event.valueOmitted] : JSON.stringify(plain(event.value ?? '', 60));
      const action: Action = { ...base, type: 'fill', selector: event.selector, label: `Enter ${shown} in ${name}`, ...(event.valueOmitted ? { valueOmitted: event.valueOmitted } : { value: event.value }) };
      if (previous?.type === 'fill' && sameSelector(previous.selector, event.selector)) actions[actions.length - 1] = { ...action, id: previous.id };
      else actions.push(action);
    } else if (event.type === 'select') {
      if (event.value === undefined && !event.valueOmitted) continue;
      const shown = event.valueOmitted ? omittedLabel[event.valueOmitted] : JSON.stringify(plain(event.value ?? '', 60));
      const action: Action = { ...base, type: 'select', selector: event.selector, label: `Select ${shown} in ${name}`, ...(event.valueOmitted ? { valueOmitted: event.valueOmitted } : { value: event.value }) };
      if (previous?.type === 'select' && sameSelector(previous.selector, event.selector)) actions[actions.length - 1] = { ...action, id: previous.id };
      else actions.push(action);
    } else if (event.type === 'click') {
      const tag = event.element?.tag || '';
      if (tag === 'textarea' || tag === 'select' || (tag === 'input' && !CLICKABLE_INPUTS.includes((event.element?.inputType || 'text').toLowerCase()))) continue;
      actions.push({ ...base, type: 'click', selector: event.selector, label: `Click ${name}` });
    } else if (event.type === 'submit' && !event.viaClick) {
      if (previous?.type === 'press' && sameSelector(previous.selector, event.selector) && event.elapsedMs - previous.elapsedMs < 250) continue;
      actions.push({ ...base, type: 'press', selector: event.selector, value: 'Enter', label: `Submit form from ${name}` });
    }
  }
  return actions;
}
