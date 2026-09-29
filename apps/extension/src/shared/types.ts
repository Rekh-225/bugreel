import type { ConsoleItem, Gap, InterruptionReason, NetworkItem, RecordedEvent, UnsupportedStep } from '../../../../packages/core/src/index';

export type SessionStatus = 'recording' | 'paused' | 'completed' | 'interrupted';

export type SessionRecord = {
  id: string;
  status: SessionStatus;
  startedAt: string;
  stoppedAt?: string;
  updatedAt: string;
  tabId: number;
  startUrl: string;
  origin: string;
  recordValues: boolean;
  browser: string | null;
  viewport: { width: number; height: number } | null;
  interruption: { reason: InterruptionReason; message: string } | null;
  gaps: Gap[];
  /** `dropped` counts records lost to collection limits; `outOfScope` counts diagnostics and requests that did not
   *  belong to the selected main frame (embedded frames, unattributed contexts) and were deliberately not stored. */
  counts: { interactions: number; console: number; network: number; unsupported: number; dropped: number; outOfScope?: number };
  notes: string[];
  hasScreenshot: boolean;
};

type EventBase = { key?: number; sessionId: string; id: string };
export type EventRecord =
  | EventBase & { kind: 'interaction'; event: RecordedEvent }
  | EventBase & { kind: 'console'; item: ConsoleItem }
  | EventBase & { kind: 'network'; item: NetworkItem }
  | EventBase & { kind: 'unsupported'; item: UnsupportedStep };

export type ReviewRecord = {
  sessionId: string;
  title: string;
  expected: string;
  actual: string;
  notes: string;
  excludedActionIds: string[];
  excludedEvidenceIds: string[];
  failureEvidenceId: string | null;
  includeScreenshot: boolean;
  updatedAt: string;
};

export type ScreenshotRecord = { sessionId: string; blob: Blob; width: number; height: number; byteLength: number; capturedAt: string };

/** Coordination state for the single active recording. Stored in chrome.storage.session so it survives
 *  service-worker restarts but not browser or extension restarts. */
export type ActiveRecording = {
  sessionId: string;
  tabId: number;
  origin: string;
  token: string;
  bindingName: string;
  worldName: string;
  scriptId?: string;
  mainFrameId: string;
  contextId?: number;
  contextDoc?: string;
  previousContextId?: number;
  previousContextDoc?: string;
  contextSwitchedAt?: number;
  status: 'recording' | 'paused' | 'stopping';
  recordValues: boolean;
  startedAt: string;
  lastInteractionAt: number;
  /** Current main-frame URL, sanitized like every persisted URL. */
  lastUrl: string;
  /** Session-salted SHA-256 of the current raw main-frame URL: lets resume detect a change the sanitized form hides. */
  lastUrlDigest: string;
  /** Digest of the raw URL at the most recently recorded navigation. */
  lastRecordedUrlDigest: string;
  /** Execution context id -> frame id for the tab's page contexts (bounded), used to scope diagnostics to the main frame. */
  contexts: Record<string, string>;
};

export type PanelRequest =
  | { type: 'getActive' }
  | { type: 'start'; tabId: number; recordValues: boolean }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'captureScreenshot' }
  | { type: 'deleteScreenshot'; sessionId: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'describeTab'; tabId: number };

export type TabDescription = { tabId: number; url: string | null; title: string | null; supported: boolean; reason?: string };
export type ActiveSummary = { sessionId: string; tabId: number; origin: string; status: ActiveRecording['status']; startedAt: string } | null;
export type PanelResponse<T = unknown> = { ok: true; value: T } | { ok: false; error: string };
