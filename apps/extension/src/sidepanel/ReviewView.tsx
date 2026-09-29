import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConsoleItem, NetworkItem } from '../../../../packages/core/src/index';
import type { ReviewRecord } from '../shared/types';
import { baseName, buildExport, download, formatElapsed, formatTime, loadSessionData, request, saveReview, type SessionData } from './data';
import { ConfirmButton, StatusBadge, useObjectUrl } from './ui';

type Evidence = (ConsoleItem | NetworkItem) & { label: string; detail: string };

function describeEvidence(item: ConsoleItem | NetworkItem): Evidence {
  if (item.kind === 'http') return { ...item, label: `${item.method} → HTTP ${item.status}${item.statusText ? ` ${item.statusText}` : ''}`, detail: item.url };
  if (item.kind === 'transport') return { ...item, label: `${item.method} failed: ${item.error ?? 'network error'}`, detail: item.url };
  const consoleItem = item as ConsoleItem;
  return { ...item, label: item.kind === 'exception' ? 'Uncaught exception' : consoleItem.consoleType === 'assert' ? 'Console assertion failure' : 'Console error', detail: consoleItem.message };
}

export function ReviewView({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [data, setData] = useState<SessionData | null | undefined>(undefined);
  const [review, setReview] = useState<ReviewRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const screenshotUrl = useObjectUrl(data?.screenshot?.blob);

  const reload = () => loadSessionData(sessionId).then(next => { setData(next ?? null); if (next) setReview(current => current ?? next.review); });
  useEffect(() => { void reload(); }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  // A session that is still finishing (for example right after an interruption) is refreshed until it settles.
  const settling = data?.session.status === 'recording' || data?.session.status === 'paused';
  useEffect(() => {
    if (!settling) return;
    const timer = setInterval(() => { void reload(); }, 500);
    return () => clearInterval(timer);
  }, [settling]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  function update(patch: Partial<ReviewRecord>) {
    if (!review) return;
    const next = { ...review, ...patch };
    setReview(next);
    setSaved(false);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveReview(next).then(() => setSaved(true), cause => setError(cause instanceof Error ? cause.message : 'Could not save.')); }, 300);
  }

  const current = useMemo(() => data && review ? { ...data, review } : null, [data, review]);
  const bundle = useMemo(() => {
    if (!current) return null;
    try { return { value: buildExport(current), error: null }; } catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : 'Export failed.' }; }
  }, [current]);

  if (data === undefined || (data && !review)) return <p className="muted">Loading…</p>;
  if (data === null || !review || !current) return <section className="card"><p>This session no longer exists.</p><button onClick={onClose}>Back</button></section>;

  const { session } = data;
  const evidence = [...data.network, ...data.console].sort((a, b) => a.elapsedMs - b.elapsedMs).map(describeEvidence);
  const excludedActions = new Set(review.excludedActionIds);
  const excludedEvidence = new Set(review.excludedEvidenceIds);
  const toggle = (list: string[], id: string, include: boolean) => include ? list.filter(item => item !== id) : [...new Set([...list, id])];
  const name = baseName(session);

  const timeline = [
    ...data.actions.map(action => ({ at: action.elapsedMs, kind: 'action' as const, action })),
    ...session.gaps.map((gap, index) => ({ at: gap.startElapsedMs, kind: 'gap' as const, text: `Recording gap ${index + 1}: paused${gap.endElapsedMs !== null ? ` for ${formatElapsed(gap.endElapsedMs - gap.startElapsedMs)}` : ''}. Actions during the pause were not captured.` })),
    ...data.unsupported.map(step => ({ at: step.elapsedMs, kind: 'unsupported' as const, text: step.description })),
  ].sort((a, b) => a.at - b.at || (a.kind === 'action' ? 1 : -1));

  async function flushReview() {
    clearTimeout(saveTimer.current);
    if (review) await saveReview(review);
    setSaved(true);
  }

  async function exportFile(kind: 'markdown' | 'json' | 'playwright' | 'screenshot') {
    setError(null);
    try {
      await flushReview();
      const value = buildExport(current!);
      if (kind === 'markdown') download(`${name}-report.md`, value.markdown, 'text/markdown');
      else if (kind === 'json') download(`${name}.recording.json`, value.json, 'application/json');
      else if (kind === 'playwright') download(`${name}.spec.ts`, value.playwright, 'text/plain');
      else if (value.screenshotName && data!.screenshot) download(value.screenshotName, data!.screenshot.blob);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Export failed.'); }
  }

  async function discardScreenshot() {
    try { await request({ type: 'deleteScreenshot', sessionId }); setReview(value => value && { ...value, includeScreenshot: false }); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not discard the screenshot.'); }
  }

  async function remove() {
    try { await request({ type: 'deleteSession', sessionId }); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete the session.'); }
  }

  const playwright = bundle?.value?.recording.playwright;
  return (
    <>
      <button className="link back" onClick={() => { void flushReview().then(onClose); }} data-testid="back">← Session history</button>
      <section className="card">
        <h2>Review recording <StatusBadge status={session.status} /></h2>
        <p className="muted small"><span className="url">{session.startUrl}</span><br />{formatTime(session.startedAt)} · typed text {session.recordValues ? 'recorded (non-sensitive fields)' : 'not recorded'}</p>
        {session.interruption && <p className="notice warn" data-testid="interruption">{session.interruption.message}</p>}
        {session.notes.map(note => <p className="notice" key={note}>{note}</p>)}
        {session.counts.dropped > 0 && <p className="notice">{session.counts.dropped} additional events were not stored because a collection limit was reached.</p>}
        {(session.counts.outOfScope ?? 0) > 0 && <p className="notice" data-testid="out-of-scope">{session.counts.outOfScope} console, exception, or network events came from embedded frames or could not be attributed to the recorded page, so they were not stored. BugReel records the main frame only.</p>}
      </section>

      <section className="card" aria-labelledby="describe-heading">
        <h2 id="describe-heading">Describe the bug</h2>
        <label className="field">Title<input data-testid="title" value={review.title} maxLength={200} placeholder={`Bug report for ${new URL(session.startUrl).host}`} onChange={event => update({ title: event.target.value })} /></label>
        <label className="field">Expected behaviour<textarea data-testid="expected" value={review.expected} maxLength={5000} rows={3} onChange={event => update({ expected: event.target.value })} /></label>
        <label className="field">Actual behaviour<textarea data-testid="actual" value={review.actual} maxLength={5000} rows={3} onChange={event => update({ actual: event.target.value })} /></label>
        <label className="field">Notes (optional)<textarea data-testid="notes" value={review.notes} maxLength={5000} rows={2} onChange={event => update({ notes: event.target.value })} /></label>
        <p className="muted small" aria-live="polite">{saved ? 'Saved locally.' : 'Saving…'}</p>
      </section>

      <section className="card" aria-labelledby="steps-heading">
        <h2 id="steps-heading">Steps ({data.actions.filter(action => !excludedActions.has(action.id)).length} of {data.actions.length} included)</h2>
        <p className="muted small">Uncheck steps that are not part of the reproduction.</p>
        <ol className="steps review" data-testid="steps">
          {timeline.map(item => item.kind === 'action' ? (
            <li key={item.action.id} data-testid="step">
              <label className="check">
                <input type="checkbox" checked={!excludedActions.has(item.action.id)} onChange={event => update({ excludedActionIds: toggle(review.excludedActionIds, item.action.id, event.target.checked) })} />
                <span>{item.action.label}{item.action.selector?.confidence === 'fallback' && <small>Low-confidence selector</small>}</span>
              </label>
            </li>
          ) : <li key={`${item.kind}-${item.at}-${item.text}`} className={item.kind} data-testid={item.kind}>{item.kind === 'gap' ? '⏸ ' : '⚠ Not replayable: '}{item.text}</li>)}
        </ol>
      </section>

      <section className="card" aria-labelledby="evidence-heading">
        <h2 id="evidence-heading">Evidence</h2>
        {evidence.length === 0 ? <p className="muted" data-testid="no-evidence">No console or network errors were captured. You can still report a visual or behavioural bug.</p> : (
          <>
            <p className="muted small">Uncheck items to leave them out of the export. Optionally mark one item as the failure signature; the Playwright draft will assert that it occurs.</p>
            <ul className="evidence" data-testid="evidence">
              {evidence.map(item => (
                <li key={item.id} data-testid="evidence-item">
                  <label className="check">
                    <input type="checkbox" checked={!excludedEvidence.has(item.id)} data-testid="include-evidence"
                      onChange={event => update({ excludedEvidenceIds: toggle(review.excludedEvidenceIds, item.id, event.target.checked), ...(event.target.checked || review.failureEvidenceId !== item.id ? {} : { failureEvidenceId: null }) })} />
                    <span><strong>{item.label}</strong> <small>+{formatElapsed(item.elapsedMs)}</small><code className="detail">{item.detail}</code></span>
                  </label>
                  <label className="radio">
                    <input type="radio" name="signature" checked={review.failureEvidenceId === item.id} data-testid="signature"
                      onChange={() => update({ failureEvidenceId: item.id, excludedEvidenceIds: review.excludedEvidenceIds.filter(id => id !== item.id) })} />
                    Failure signature
                  </label>
                </li>
              ))}
            </ul>
            <label className="radio"><input type="radio" name="signature" checked={review.failureEvidenceId === null} onChange={() => update({ failureEvidenceId: null })} data-testid="no-signature" />No failure signature (visual or behavioural bug)</label>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="screenshot-heading">
        <h2 id="screenshot-heading">Screenshot</h2>
        {screenshotUrl ? (
          <>
            <img className="shot" src={screenshotUrl} alt="Captured screenshot of the recorded tab" data-testid="screenshot-preview" />
            <p className="notice warn small">Text filtering does not apply to images. Check the screenshot for personal or confidential information before including it.</p>
            <label className="check"><input type="checkbox" data-testid="include-screenshot" checked={review.includeScreenshot} onChange={event => update({ includeScreenshot: event.target.checked })} /><span>Include screenshot in export</span></label>
            <ConfirmButton label="Discard screenshot" confirmLabel="Confirm discard" onConfirm={discardScreenshot} testId="discard-screenshot" />
          </>
        ) : <p className="muted" data-testid="no-screenshot">No screenshot. Screenshots can only be captured while recording.</p>}
      </section>

      <section className="card" aria-labelledby="export-heading">
        <h2 id="export-heading">Export</h2>
        {bundle?.error && <p className="notice error" role="alert">{bundle.error}</p>}
        {playwright && (
          <div data-testid="draft-status">
            <p><strong>Playwright draft: {playwright.status === 'draft' ? 'unverified draft' : 'incomplete, unverified draft'}.</strong> BugReel does not run exported tests and does not confirm that the bug reproduces.</p>
            <ul className="small">{playwright.notes.map(note => <li key={note}>{note}</li>)}</ul>
          </div>
        )}
        <div className="grid">
          <button data-testid="export-markdown" onClick={() => exportFile('markdown')} disabled={!bundle?.value}>Markdown report</button>
          <button data-testid="export-json" onClick={() => exportFile('json')} disabled={!bundle?.value}>JSON recording</button>
          <button data-testid="export-playwright" onClick={() => exportFile('playwright')} disabled={!bundle?.value}>Playwright draft</button>
          <button data-testid="export-screenshot" onClick={() => exportFile('screenshot')} disabled={!bundle?.value?.screenshotName}>Screenshot</button>
        </div>
        {bundle?.value && (
          <details>
            <summary>Preview Playwright draft</summary>
            <pre className="code" data-testid="playwright-preview">{bundle.value.playwright}</pre>
          </details>
        )}
        {error && <p className="notice error" role="alert" data-testid="error">{error}</p>}
      </section>

      <section className="card">
        <ConfirmButton label="Delete session" confirmLabel="Confirm: delete steps, evidence, and screenshot" onConfirm={remove} testId="delete-session" />
      </section>
    </>
  );
}
