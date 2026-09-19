import type { Session } from '../session';
import { loadSession, savedSessionIds } from './artifacts';

type State = { sessions: Map<string, Session>; activeRecording?: { id: string; stop: () => Promise<Session> }; busy?: string };
const globalState = globalThis as typeof globalThis & { __bugreelState?: State };
export const state: State = globalState.__bugreelState ??= { sessions: new Map() };
export const APP_ORIGIN = 'http://127.0.0.1:3000';

export async function getSession(id: string) {
  const cached = state.sessions.get(id);
  if (cached) return cached;
  const saved = await loadSession(id);
  if (saved) {
    if (['starting', 'recording', 'stopping'].includes(saved.status)) {
      saved.status = 'interrupted';
      saved.warnings.push('The server restarted before recording completed.');
    }
    if (saved.latestRun?.status === 'running') {
      saved.latestRun.status = 'error';
      saved.latestRun.message = 'The server restarted before replay completed.';
    }
    state.sessions.set(id, saved);
  }
  return saved;
}
export async function listSessions() {
  const ids = new Set([...await savedSessionIds(), ...state.sessions.keys()]);
  const sessions = (await Promise.all([...ids].map(getSession))).filter((s): s is Session => !!s);
  return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 12).map(session => ({
    id: session.id, startedAt: session.startedAt, status: session.status, title: session.report?.title || 'Demo Store recording',
    actionCount: session.actions.length, failure: !!session.failure, runStatus: session.latestRun?.status,
  }));
}
