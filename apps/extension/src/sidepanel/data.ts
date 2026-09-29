import {
  buildRecording, generateMarkdown, generatePlaywright, normalizeCapture, validateRecording,
  type Action, type BugReelRecording, type ConsoleItem, type NetworkItem, type RecordedEvent, type UnsupportedStep,
} from '../../../../packages/core/src/index';
import { getEvents, getReview, getScreenshot, getSession, putReview } from '../shared/db';
import type { ActiveSummary, PanelRequest, PanelResponse, ReviewRecord, ScreenshotRecord, SessionRecord } from '../shared/types';

export async function request<T>(message: PanelRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as PanelResponse<T> | undefined;
  if (!response) throw new Error('The BugReel background worker did not respond. Try again.');
  if (!response.ok) throw new Error(response.error);
  return response.value;
}

export async function readActive(): Promise<ActiveSummary> {
  const { active } = await chrome.storage.session.get('active');
  if (!active) return null;
  const value = active as NonNullable<ActiveSummary>;
  return { sessionId: value.sessionId, tabId: value.tabId, origin: value.origin, status: value.status, startedAt: value.startedAt };
}

export type SessionData = {
  session: SessionRecord;
  events: RecordedEvent[];
  actions: Action[];
  console: ConsoleItem[];
  network: NetworkItem[];
  unsupported: UnsupportedStep[];
  review: ReviewRecord;
  screenshot: ScreenshotRecord | undefined;
};

export const defaultReview = (sessionId: string): ReviewRecord => ({
  sessionId, title: '', expected: '', actual: '', notes: '', excludedActionIds: [], excludedEvidenceIds: [], failureEvidenceId: null, includeScreenshot: false, updatedAt: new Date().toISOString(),
});

export async function loadSessionData(sessionId: string): Promise<SessionData | undefined> {
  const [session, records, review, screenshot] = await Promise.all([getSession(sessionId), getEvents(sessionId), getReview(sessionId), getScreenshot(sessionId)]);
  if (!session) return undefined;
  const events = records.flatMap(record => record.kind === 'interaction' ? [record.event] : []);
  return {
    session, events, actions: normalizeCapture(events),
    console: records.flatMap(record => record.kind === 'console' ? [record.item] : []),
    network: records.flatMap(record => record.kind === 'network' ? [record.item] : []),
    unsupported: records.flatMap(record => record.kind === 'unsupported' ? [record.item] : []),
    review: review ?? defaultReview(sessionId),
    screenshot,
  };
}

export const saveReview = (review: ReviewRecord) => putReview({ ...review, updatedAt: new Date().toISOString() });

export function baseName(session: SessionRecord) {
  const stamp = session.startedAt.slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return `bugreel-${stamp}-${session.id.slice(0, 8)}`;
}

export type ExportBundle = { recording: BugReelRecording; json: string; markdown: string; playwright: string; screenshotName: string | null };

export function buildExport(data: SessionData): ExportBundle {
  const { session, review } = data;
  if (session.status !== 'completed' && session.status !== 'interrupted') throw new Error('Stop the recording before exporting.');
  const name = baseName(session);
  const screenshotName = data.screenshot && review.includeScreenshot ? `${name}-screenshot.png` : null;
  const excludedEvidence = new Set(review.excludedEvidenceIds);
  const recording = buildRecording({
    generatorVersion: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    session: {
      id: session.id, status: session.status, startedAt: session.startedAt, stoppedAt: session.stoppedAt ?? session.updatedAt,
      interruption: session.interruption, typedValuesRecorded: session.recordValues, browser: session.browser,
      startUrl: session.startUrl, origin: session.origin, viewport: session.viewport,
    },
    events: data.events,
    console: data.console,
    network: data.network,
    unsupported: data.unsupported,
    gaps: session.gaps,
    review: {
      title: review.title, expected: review.expected, actual: review.actual, notes: review.notes,
      excludedActionIds: review.excludedActionIds,
      includedEvidenceIds: [...data.console, ...data.network].map(item => item.id).filter(id => !excludedEvidence.has(id)),
      failureEvidenceId: review.failureEvidenceId,
    },
    screenshot: screenshotName && data.screenshot ? { fileName: screenshotName, mimeType: 'image/png', width: data.screenshot.width, height: data.screenshot.height, byteLength: data.screenshot.byteLength, capturedAt: data.screenshot.capturedAt, pixelsRedacted: false } : null,
  });
  const validation = validateRecording(JSON.parse(JSON.stringify(recording)));
  if (!validation.ok) throw new Error(`The export failed validation: ${validation.errors.slice(0, 3).join('; ')}`);
  return { recording, json: `${JSON.stringify(recording, null, 2)}\n`, markdown: generateMarkdown(recording), playwright: generatePlaywright(recording), screenshotName };
}

export function download(fileName: string, content: string | Blob, type = 'text/plain') {
  const blob = typeof content === 'string' ? new Blob([content], { type: `${type};charset=utf-8` }) : content;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const formatTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const formatElapsed = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
