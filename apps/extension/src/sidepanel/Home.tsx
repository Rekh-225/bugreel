import { useCallback, useEffect, useState } from 'react';
import { listSessions } from '../shared/db';
import { MAX_SESSIONS } from '../shared/limits';
import type { SessionRecord, TabDescription } from '../shared/types';
import { formatTime, request } from './data';
import { ConfirmButton, StatusBadge } from './ui';

export function Home({ target, onOpen }: { target: TabDescription | null; onOpen: (id: string) => void }) {
  const [recordValues, setRecordValues] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);

  const load = useCallback(() => { listSessions().then(setSessions, cause => setError(cause instanceof Error ? cause.message : 'Could not load sessions.')); }, []);
  useEffect(load, [load]);

  async function start() {
    if (!target) return;
    setStarting(true);
    setError(null);
    try { await request({ type: 'start', tabId: target.tabId, recordValues }); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Recording could not start.'); } finally { setStarting(false); }
  }

  async function remove(id: string) {
    setError(null);
    try { await request({ type: 'deleteSession', sessionId: id }); load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete the session.'); }
  }

  const full = (sessions?.length ?? 0) >= MAX_SESSIONS;
  return (
    <>
      <section className="card" aria-labelledby="target-heading">
        <h2 id="target-heading">Record this tab</h2>
        {target?.url ? (
          <div className="target" data-testid="target">
            <strong>{target.title || 'Untitled page'}</strong>
            <span className="url">{target.url}</span>
          </div>
        ) : <p className="muted">No recordable tab selected.</p>}
        {target && !target.supported && <p className="notice warn" data-testid="unsupported-reason">{target.reason}</p>}
        <label className="check">
          <input type="checkbox" checked={recordValues} onChange={event => setRecordValues(event.target.checked)} data-testid="record-values" />
          <span>Record typed text for this session<small>Only fields not identified as sensitive. Passwords, emails, phone numbers, and payment fields are always omitted. Off by default.</small></span>
        </label>
        <button className="primary" data-testid="start" disabled={!target?.supported || starting || full} onClick={start}>{starting ? 'Starting…' : 'Start recording'}</button>
        {full && <p className="notice warn">BugReel keeps at most {MAX_SESSIONS} sessions. Delete old sessions to record a new one.</p>}
        {error && <p className="notice error" role="alert" data-testid="error">{error}</p>}
        <p className="muted small">Reproduce the bug in the tab, then return here to stop. Chrome will show a “started debugging this browser” banner while recording.</p>
      </section>

      <section className="card" aria-labelledby="history-heading">
        <h2 id="history-heading">Session history</h2>
        {sessions === null ? <p className="muted">Loading…</p> : sessions.length === 0 ? <p className="muted" data-testid="empty-history">No sessions yet.</p> : (
          <ul className="history" data-testid="history">
            {sessions.map(session => (
              <li key={session.id} data-testid="history-item">
                <div>
                  <strong>{new URL(session.startUrl).host}</strong> <StatusBadge status={session.status} />
                  <span className="muted small">{formatTime(session.startedAt)} · {session.counts.interactions} steps · {session.counts.console + session.counts.network} errors</span>
                </div>
                <div className="row">
                  <button onClick={() => onOpen(session.id)} data-testid="open-session">Review</button>
                  <ConfirmButton label="Delete" confirmLabel="Confirm delete" onConfirm={() => remove(session.id)} testId="delete-session" />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Sessions are stored only in this Chrome profile (up to {MAX_SESSIONS}). Deleting a session removes its steps, evidence, and screenshot.</p>
      </section>
    </>
  );
}
