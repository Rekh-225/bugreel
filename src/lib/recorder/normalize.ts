import type { Action, RecordedEvent, Selector } from '../session';

const sameSelector = (a?: Selector, b?: Selector) => !!a && !!b && a.kind === b.kind && a.value === b.value;

export function normalizeEvents(events: RecordedEvent[]): Action[] {
  const actions: Action[] = [];
  for (const event of events) {
    const base = { id: event.id, timestamp: event.timestamp, elapsedMs: event.elapsedMs };
    const name = event.element?.text || event.element?.ariaLabel || event.element?.placeholder || event.element?.name || event.selector?.value || 'element';
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
