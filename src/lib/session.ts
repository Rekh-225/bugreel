export type Selector = { kind: 'testId' | 'id' | 'label' | 'placeholder' | 'text' | 'css'; value: string; confidence: 'stable' | 'fallback' };
export type ElementInfo = { tag: string; testId?: string; id?: string; name?: string; ariaLabel?: string; placeholder?: string; text?: string; inputType?: string };
export type RecordedEvent = {
  id: string; sequence: number; type: 'click' | 'input' | 'change' | 'submit' | 'navigation';
  timestamp: string; elapsedMs: number; url: string; selector?: Selector; element?: ElementInfo;
  value?: string; viaClick?: boolean; causedByAction?: boolean;
};
export type Action = {
  id: string; type: 'goto' | 'click' | 'fill' | 'press' | 'waitForURL'; label: string;
  timestamp: string; elapsedMs: number; selector?: Selector; value?: string; url?: string;
};
export type ConsoleEvidence = { id: string; type: 'console' | 'pageerror'; message: string; timestamp: string; elapsedMs: number; url?: string; line?: number };
export type NetworkEvidence = { id: string; kind: 'http' | 'transport'; method: string; url: string; status?: number; error?: string; code?: string; timestamp: string; elapsedMs: number; resourceType: string };
export type Screenshot = { id: string; name: string; reason: 'failure' | 'stopped'; timestamp: string };
export type Failure = { code: string; message: string; method: string; pathname: string; status: number; networkId: string; visible: boolean; triggerActionId?: string };
export type RunStatus = 'running' | 'confirmed' | 'not_reproduced' | 'error';
export type ReplayRun = { id: string; status: RunStatus; startedAt: string; finishedAt?: string; message: string; sourceHash: string; screenshot?: string; durationMs?: number; output?: string };
export type AgentHandoff = { status: 'sending' | 'sent' | 'error' | 'uncertain'; createdAt: string; packetHash: string; maxAcuLimit: number; message: string; sessionId?: string; url?: string };
export type Session = {
  id: string; startedAt: string; stoppedAt?: string; startUrl: string;
  target?: 'demo' | 'local';
  status: 'starting' | 'recording' | 'stopping' | 'captured' | 'interrupted' | 'error';
  events: RecordedEvent[]; actions: Action[]; consoleErrors: ConsoleEvidence[]; networkErrors: NetworkEvidence[];
  screenshots: Screenshot[]; warnings: string[]; failure?: Failure;
  report?: { title: string; expected: string; actual: string };
  generatedTest?: { source: string; hash: string; version: number };
  latestRun?: ReplayRun;
  agentHandoff?: AgentHandoff;
};
