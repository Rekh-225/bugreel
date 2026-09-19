(() => {
  if (window !== window.top || window.__bugreelInstalled) return;
  window.__bugreelInstalled = true;
  let pending = Promise.resolve();
  let clickedSubmitter = null;
  let lastInput = null;
  const trim = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const sensitive = element => element.matches('input[type="password"], input[type="hidden"], input[type="file"], [autocomplete="cc-number"], [autocomplete="cc-csc"], [data-private]');
  function identify(element) {
    const info = { tag: element.tagName.toLowerCase(), testId: element.getAttribute('data-testid') || undefined, id: element.id || undefined, name: element.getAttribute('name') || undefined, ariaLabel: element.getAttribute('aria-label') || undefined, placeholder: element.getAttribute('placeholder') || undefined, text: trim(element.innerText), inputType: element.getAttribute('type') || undefined };
    const unique = css => document.querySelectorAll(css).length === 1;
    let selector;
    if (info.testId && unique(`[data-testid="${CSS.escape(info.testId)}"]`)) selector = { kind: 'testId', value: info.testId, confidence: 'stable' };
    else if (info.id && unique(`#${CSS.escape(info.id)}`)) selector = { kind: 'id', value: info.id, confidence: 'stable' };
    else if (info.ariaLabel && unique(`[aria-label="${CSS.escape(info.ariaLabel)}"]`)) selector = { kind: 'label', value: info.ariaLabel, confidence: 'stable' };
    else if (info.placeholder && unique(`[placeholder="${CSS.escape(info.placeholder)}"]`)) selector = { kind: 'placeholder', value: info.placeholder, confidence: 'stable' };
    else if (info.name && unique(`${info.tag}[name="${CSS.escape(info.name)}"]`)) selector = { kind: 'css', value: `${info.tag}[name="${CSS.escape(info.name)}"]`, confidence: 'stable' };
    else if (info.text && ['button', 'a'].includes(info.tag) && [...document.querySelectorAll(info.tag)].filter(node => trim(node.innerText) === info.text).length === 1) selector = { kind: 'text', value: info.text, confidence: 'fallback' };
    return { element: info, selector };
  }
  function send(payload) {
    const event = { ...payload, timestamp: new Date().toISOString(), url: location.href };
    pending = pending.then(() => window.__bugreelCapture(event)).catch(() => {});
  }
  document.addEventListener('click', event => {
    const element = event.target instanceof Element ? event.target.closest('button, a, input, textarea, select, [role="button"]') : null;
    if (!element || sensitive(element) || element.closest('[data-bugreel-control]')) return;
    if ((element.tagName === 'BUTTON' && element.type === 'submit') || (element.tagName === 'INPUT' && element.type === 'submit')) {
      clickedSubmitter = element;
      setTimeout(() => { clickedSubmitter = null; }, 0);
    }
    send({ type: 'click', ...identify(element) });
  }, true);
  for (const type of ['input', 'change']) document.addEventListener(type, event => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || sensitive(element)) return;
    if (element instanceof HTMLInputElement && !['text', 'search', 'email', 'url', 'tel', 'number'].includes(element.type)) return;
    lastInput = element;
    send({ type, value: element.value.slice(0, 2000), ...identify(element) });
  }, true);
  document.addEventListener('submit', event => {
    const target = lastInput && event.target.contains(lastInput) ? lastInput : event.target.querySelector('input:not([type="hidden"]):not([type="password"])');
    if (!target || sensitive(target)) return;
    send({ type: 'submit', viaClick: !!clickedSubmitter && event.submitter === clickedSubmitter, ...identify(target) });
  }, true);
  window.__bugreelFlush = () => pending;
})();
