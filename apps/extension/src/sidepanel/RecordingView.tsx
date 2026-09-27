import { useEffect, useState } from 'react';
import type { ActiveSummary, TabDescription } from '../shared/types';
import { formatElapsed, loadSessionData, request, type SessionData } from './data';
import { ConfirmButton, useObjectUrl } from './ui';

export function RecordingView({ active, target, onStopped }: { active: NonNullable<ActiveSummary>; target: TabDescription | null; onStopped: (id: string) => void }) {
  const [data, setData] = useState<SessionData | undefined>();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const screenshotUrl = useObjectUrl(data?.screenshot?.blob);

  useEffect(() => {
    let cancelled = false;
    const tick = () => { setNow(Date.now()); void loadSessionData(active.sessionId).then(next => { if (!cancelled) setData(next); }); };
    tick();
    const timer = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active.sessionId]);

  async function run(label: string, message: Parameters<typeof request>[0], after?: () => void) {
    setBusy(label);
    setError(null);
    try { await request(message); after?.(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The request failed.'); } finally { setBusy(null); }
    void loadSessionData(active.sessionId).then(setData);
  }

  const paused = active.status === 'paused';
  const stopping = active.status === 'stopping';
  const counts = data?.session.counts;
  return (
    <>
      <section className={`card recording ${paused ? 'is-paused' : ''}`} aria-live="polite">
        <div className="indicator" data-testid="recording-indicator">
          <span className="pulse" aria-hidden="true" />
          <strong data-testid="recording-status">{stopping ? 'Stopping…' : paused ? 'Paused' : 'Recording'}</strong>
          <span className="timer">{formatElapsed(Math.max(0, now - Date.parse(active.startedAt)))}</span>
        </div>
        <p className="url">{active.origin}</p>
        {target && target.tabId !== active.tabId && <p className="notice">BugReel is recording a different tab. Switch to it to continue reproducing the bug.</p>}
        {paused && <p className="notice warn">Paused: actions are not recorded. The exported test will show a gap here and must be completed by hand.</p>}
        <div className="row">
          {paused
            ? <button className="primary" data-testid="resume" disabled={!!busy || stopping} onClick={() => run('resume', { type: 'resume' })}>Resume</button>
            : <button data-testid="pause" disabled={!!busy || stopping} onClick={() => run('pause', { type: 'pause' })}>Pause</button>}
          <button className="danger" data-testid="stop" disabled={!!busy || stopping} onClick={() => run('stop', { type: 'stop' }, () => onStopped(active.sessionId))}>Stop</button>
          <button data-testid="capture-screenshot" disabled={!!busy || stopping} onClick={() => run('screenshot', { type: 'captureScreenshot' })}>{data?.screenshot ? 'Replace screenshot' : 'Capture screenshot'}</button>
        </div>
        {error && <p className="notice error" role="alert" data-testid="error">{error}</p>}
      </section>

      {screenshotUrl && (
        <section className="card">
          <h2>Screenshot</h2>
          <img className="shot" src={screenshotUrl} alt="Captured screenshot of the recorded tab" data-testid="screenshot-preview" />
          <p className="muted small">Screenshot pixels are not redacted. Review it before exporting. You can include or exclude it on the review screen.</p>
          <ConfirmButton label="Discard screenshot" confirmLabel="Confirm discard" testId="discard-screenshot" onConfirm={() => run('discard', { type: 'deleteScreenshot', sessionId: active.sessionId })} />
        </section>
      )}

      <section className="card">
        <h2>Captured so far</h2>
        <p className="muted small" data-testid="live-counts">{counts ? `${counts.interactions} steps · ${counts.console} console errors · ${counts.network} network errors · ${counts.unsupported} not replayable` : 'Waiting for the first event…'}</p>
        <ol className="steps" data-testid="live-steps">
          {(data?.actions ?? []).slice(-12).map(action => <li key={action.id}>{action.label}</li>)}
        </ol>
      </section>
    </>
  );
}
