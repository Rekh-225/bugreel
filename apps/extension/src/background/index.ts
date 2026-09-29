import type { PanelRequest, PanelResponse } from '../shared/types';
import { captureScreenshot, deleteSession, describeTab, getActiveSummary, pause, recover, registerListeners, resume, start, stop } from './recorder';
import { deleteScreenshot } from '../shared/db';

// Listeners must be registered synchronously at the top level so Chrome can wake the worker for them.
registerListeners();
const ready = recover().catch(() => undefined);

chrome.runtime.onInstalled.addListener(() => { void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined); });
chrome.runtime.onStartup.addListener(() => { void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined); });

const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);

function handle(message: PanelRequest): Promise<unknown> {
  switch (message?.type) {
    case 'getActive': return getActiveSummary();
    case 'describeTab': if (!isInteger(message.tabId)) break; return describeTab(message.tabId);
    case 'start': if (!isInteger(message.tabId) || typeof message.recordValues !== 'boolean') break; return start(message.tabId, message.recordValues);
    case 'pause': return pause();
    case 'resume': return resume();
    case 'stop': return stop();
    case 'captureScreenshot': return captureScreenshot();
    case 'deleteScreenshot': if (!isId(message.sessionId)) break; return deleteScreenshot(message.sessionId);
    case 'deleteSession': if (!isId(message.sessionId)) break; return deleteSession(message.sessionId);
  }
  return Promise.reject(new Error('Unsupported request.'));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only BugReel's own extension pages may control recording. Web pages have no messaging channel
  // (no externally_connectable, no chrome content scripts), and the capture script uses a CDP binding instead.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  // Startup recovery must finish before the panel reads or changes anything.
  ready.then(() => handle(message as PanelRequest)).then(
    value => sendResponse({ ok: true, value } satisfies PanelResponse),
    error => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' } satisfies PanelResponse),
  );
  return true;
});
