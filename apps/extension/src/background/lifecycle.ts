import type { InterruptionReason } from '../../../../packages/core/src/index';
import type { ActiveRecording, SessionRecord } from '../shared/types';

export type Command = 'start' | 'pause' | 'resume' | 'stop' | 'screenshot';
type ActiveStatus = ActiveRecording['status'] | null;

/** Which commands are valid in each state of the single active recording. */
export function checkCommand(command: Command, status: ActiveStatus): string | null {
  switch (command) {
    case 'start': return status ? 'A recording is already in progress. Stop it before starting another.' : null;
    case 'pause': return status === 'recording' ? null : status === 'paused' ? 'The recording is already paused.' : 'Nothing is being recorded.';
    case 'resume': return status === 'paused' ? null : status === 'recording' ? 'The recording is not paused.' : 'Nothing is being recorded.';
    case 'stop': return status === 'recording' || status === 'paused' ? null : status === 'stopping' ? 'The recording is already stopping.' : 'Nothing is being recorded.';
    case 'screenshot': return status === 'recording' || status === 'paused' ? null : 'Screenshots can only be captured while a recording is active or paused.';
  }
}

export const INTERRUPTIONS: Record<InterruptionReason, string> = {
  'cross-origin-navigation': 'Capture stopped because the tab navigated to a different site. Steps before the navigation were kept.',
  'tab-closed': 'The recorded tab was closed, or Chrome moved it to a page that extensions cannot access.',
  'debugger-detached': 'Chrome ended BugReel\'s debugging session (for example with Cancel on the "started debugging this browser" banner), so capture stopped.',
  'browser-restart': 'Chrome or the extension restarted while this session was recording. BugReel does not resume recordings automatically.',
  'access-lost': 'BugReel lost access to the tab while its background worker restarted, so capture stopped.',
  'storage-error': 'Browser storage failed or is full, so capture stopped. Delete old sessions to free space.',
  'limit-reached': 'The recording reached the maximum number of steps and was stopped.',
  'tab-crashed': 'The recorded tab crashed, so capture stopped.',
};

export function interruption(reason: InterruptionReason, detail?: string) {
  return { reason, message: detail ? `${INTERRUPTIONS[reason]} ${detail}`.slice(0, 500) : INTERRUPTIONS[reason] };
}

export function detachReason(reason: string): InterruptionReason {
  return reason === 'canceled_by_user' ? 'debugger-detached' : 'tab-closed';
}

/** Ends a session record: closes open gaps and records the final status. */
export function finishSession(session: SessionRecord, status: 'completed' | 'interrupted', at: string, detail: SessionRecord['interruption']) {
  session.status = status;
  session.stoppedAt = at;
  session.interruption = status === 'interrupted' ? detail : null;
  const elapsed = Math.max(0, Date.parse(at) - Date.parse(session.startedAt));
  for (const gap of session.gaps) if (gap.endedAt === null) { gap.endedAt = at; gap.endElapsedMs = elapsed; }
  return session;
}

/** Sessions left in a recording state without matching live coordination state were cut off by a restart. */
export function orphanedSessions(sessions: SessionRecord[], activeSessionId: string | undefined) {
  return sessions.filter(session => (session.status === 'recording' || session.status === 'paused') && session.id !== activeSessionId);
}
