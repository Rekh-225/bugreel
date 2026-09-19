'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Session } from '@/lib/session';
import { AppHeader } from './app-header';
import { EvidencePanel } from './evidence-panel';
import { GeneratedTest } from './generated-test';
import { AgentHandoff } from './agent-handoff';
import { Icon, type IconName } from './icon';

const resultLabels = { running: 'RUNNING REPRODUCTION', confirmed: 'REPRODUCTION CONFIRMED', not_reproduced: 'NOT REPRODUCED', error: 'REPLAY ERROR' };
const actionIcons: Record<string, IconName> = { goto: 'external', click: 'arrow', fill: 'code', press: 'terminal', waitForURL: 'external' };
function duration(ms: number) { return `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`; }

export function SessionView({ id }: { id: string }) {
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch(`/api/sessions/${id}`, { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (mounted) { setSession(body); setLoadError(''); setNow(Date.now()); }
      } catch (error) { if (mounted) setLoadError(error instanceof Error ? error.message : 'Could not load session.'); }
      if (mounted) timer = setTimeout(load, 1000);
    };
    void load();
    return () => { mounted = false; clearTimeout(timer); };
  }, [id]);
  async function stop() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/sessions/${id}/stop`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setSession(body);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not stop recording.'); }
    finally { setBusy(false); }
  }
  async function run() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/sessions/${id}/run`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setSession(current => current ? { ...current, latestRun: body } : current);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not start replay.'); }
    finally { setBusy(false); }
  }
  const active = !!session && ['starting', 'recording', 'stopping'].includes(session.status);
  const screenshot = session?.screenshots[0];
  const replay = session?.latestRun;
  return <><AppHeader /><main className="workspace report-workspace">
    <div className="breadcrumbs"><Link href="/">Workspace</Link><span>/</span><span>{active ? 'Recording session' : 'Session report'}</span><span className="session-id mono">{id.slice(0, 8)}</span></div>
    {(error || loadError) && <div className="error-banner" role="alert"><Icon name="alert" /><span>{error || loadError}</span></div>}
    {!session ? <div className="loading-panel">{loadError ? <><Icon name="alert" /><h1>Session unavailable</h1><p>{loadError}</p><Link href="/" className="button secondary">Back to workspace</Link></> : <><span className="spinner" /><p>Loading your evidence…</p></>}</div> : <>
      <header className="report-header"><div><div className="report-kicker"><span className={`badge ${active ? 'recording-badge' : session.failure ? 'rose' : ''}`}><span className={`status-dot ${active || session.failure ? 'red' : ''}`} /><span data-testid="session-status">{session.status}</span></span><span>DEMO STORE <span className="divider-dot">/</span> CHROMIUM</span></div><h1>{active ? 'Catch it in the act.' : session.report?.title || (session.failure ? 'Checkout fails after applying SAVE20' : 'Demo Store recording')}</h1><p className="report-subtitle">{active ? 'Your browser is recording. Reproduce the failure, then stop to build your report.' : 'One session. The exact steps, the evidence, and an executable reproduction.'}</p></div><div className="report-header-action">{active ? <button data-testid="stop-recording" disabled={busy || session.status === 'stopping'} onClick={stop} className="button stop-button"><Icon name="stop" size={15} />{busy || session.status === 'stopping' ? 'Collecting evidence…' : 'Stop & Generate Report'}</button> : session.generatedTest ? <button data-testid="run-reproduction" disabled={busy || replay?.status === 'running'} onClick={run} className="button primary">{replay?.status === 'running' ? <span className="spinner" /> : <Icon name="play" size={16} />}{replay?.status === 'running' ? 'Reproducing…' : 'Run Reproduction'}</button> : session.status === 'captured' && session.actions.some(action => action.type === 'click' && action.selector?.value === 'checkout') ? <button data-testid="generate-report" disabled={busy} onClick={stop} className="button primary"><Icon name="code" size={15} />{busy ? 'Generating…' : 'Generate Playwright Test'}</button> : <Link className="button secondary" href="/">New recording <Icon name="arrow" size={15} /></Link>}<span>{active ? 'Return here when the failure is visible' : session.generatedTest ? 'Fresh browser · Exact generated test' : 'Captured evidence is preserved below'}</span></div></header>
      <div className="session-metrics"><div><Icon name="clock" size={15} /><strong>{duration((session.stoppedAt ? Date.parse(session.stoppedAt) : now) - Date.parse(session.startedAt))}</strong><span>duration</span></div><div><Icon name="activity" size={15} /><strong>{session.actions.length}</strong><span>actions</span></div><div><Icon name="network" size={15} /><strong>{session.networkErrors.length}</strong><span>network errors</span></div><div><Icon name="terminal" size={15} /><strong>{session.consoleErrors.length}</strong><span>console errors</span></div><div><Icon name="camera" size={15} /><strong>{session.screenshots.length}</strong><span>screenshots</span></div><span className="metrics-origin mono">127.0.0.1:3000/demo-store</span></div>
      {active && <section className="recording-guide"><div className="recording-radar"><span /><Icon name="activity" size={23} /></div><div><h2>Recording in a separate browser</h2><p>Add to Cart <span>→</span> enter <code>SAVE20</code> <span>→</span> Apply Discount <span>→</span> Checkout</p><p className="muted small">Keep the browser open. Click Stop &amp; Generate Report here after the checkout error appears.</p></div><span className="live-label"><span className="status-dot red" /> LIVE</span></section>}
      {session.generatedTest && <section id="replay-result" className={`replay-result ${replay?.status || 'ready'}`} aria-live="polite"><span className="result-icon">{replay?.status === 'running' ? <span className="spinner" /> : <Icon name={replay?.status === 'confirmed' ? 'check' : replay?.status === 'error' ? 'alert' : replay?.status === 'not_reproduced' ? 'close' : 'play'} size={23} />}</span><div className="result-copy"><h2 data-testid="replay-status">{replay ? resultLabels[replay.status] : 'READY TO REPRODUCE'}</h2><p>{replay?.message || 'The evidence is captured. Run the generated test to check this scenario independently.'}</p></div>{replay?.durationMs !== undefined && <span className="result-duration mono">{(replay.durationMs / 1000).toFixed(1)}s</span>}{replay?.status === 'running' && <div className="running-line" />}</section>}
      <div className="report-primary-grid"><section className="panel steps-panel"><div className="panel-heading"><div className="panel-title"><Icon name="activity" /><h2>Reproduction steps</h2></div><span className="panel-caption">{active ? 'CAPTURING LIVE' : 'FROM RECORDED ACTIONS'}</span></div>{session.actions.length ? <ol className="steps-list" data-testid="reproduction-steps">{session.actions.map((action, index) => <li key={action.id}><span className="step-number">{String(index + 1).padStart(2, '0')}</span><div className="step-content"><strong>{action.label}</strong><span className="mono">{action.selector ? `${action.selector.kind}: ${action.selector.value}` : action.url ? new URL(action.url).pathname : action.type}</span></div><span className="step-time">+{(action.elapsedMs / 1000).toFixed(1)}s</span><Icon name={actionIcons[action.type]} size={14} /></li>)}</ol> : <div className="evidence-empty">Waiting for your first interaction…</div>}<div className={`signature-block ${session.failure ? 'has-failure' : ''}`}><span className="eyebrow">FAILURE SIGNATURE</span><p className="mono" data-testid="failure-signature">{session.failure?.code || (active ? 'Listening for diagnostic evidence…' : 'No target checkout failure observed')}</p>{session.failure && <span><span className="http-code small-code">500</span> POST /api/demo/checkout <span className="divider-dot">·</span> {session.failure.visible ? 'Visible error confirmed' : 'Response captured'}</span>}</div></section>
      <section className="panel screenshot-panel"><div className="panel-heading"><div className="panel-title"><Icon name="camera" /><h2>Recorded {screenshot?.reason === 'stopped' ? 'session' : 'failure'}</h2></div>{screenshot && <a className="text-button" href={`/api/sessions/${id}/artifacts/${screenshot.name}`} target="_blank" rel="noreferrer">Full size <Icon name="external" size={12} /></a>}</div>{screenshot ? <><div className="screenshot-browser-bar"><span className="window-dots"><i /><i /><i /></span><span className="mono">Demo Store</span><span className="screenshot-label">ACTUAL CAPTURE</span></div><a className="screenshot-link" href={`/api/sessions/${id}/artifacts/${screenshot.name}`} target="_blank" rel="noreferrer"><img data-testid="recorded-screenshot" src={`/api/sessions/${id}/artifacts/${screenshot.name}`} alt={screenshot.reason === 'failure' ? 'Actual recorded Demo Store checkout failure' : 'Actual browser state when recording stopped'} /></a><div className="screenshot-caption"><Icon name="check" size={13} /><span>{screenshot.reason === 'failure' ? 'Captured after the visible checkout error rendered' : 'Captured when recording stopped'}</span><time>{new Date(screenshot.timestamp).toLocaleTimeString()}</time></div></> : <div className="screenshot-placeholder"><Icon name="camera" size={32} /><strong>{active ? 'Your evidence, not a mockup.' : 'No screenshot available'}</strong><p>{active ? 'A screenshot is captured when the checkout failure becomes visible.' : 'The browser may have closed before a screenshot could be saved.'}</p></div>}</section></div>
      {session.report && <div className="behavior-summary"><div><span>EXPECTED BEHAVIOR</span><p>{session.report.expected}</p></div><div><span>ACTUAL BEHAVIOR</span><p>{session.report.actual}</p></div></div>}
      <EvidencePanel session={session} />
      {!active && !session.generatedTest && <section className="panel mt-5 p-5"><h2 className="text-sm font-medium">Playwright test and Devin handoff</h2><p className="mt-2 text-xs leading-6 text-[#9daaa2]">Your report and captured evidence are saved. {session.actions.some(action => action.type === 'click' && action.selector?.value === 'checkout') ? 'Test generation did not complete. Use Generate Playwright Test above to retry; Devin handoff will become available with the generated test.' : 'No checkout click was captured in this session. Record a checkout attempt to generate an executable test and enable Devin handoff.'}</p></section>}
      {session.generatedTest && <><GeneratedTest id={id} source={session.generatedTest.source} hash={session.generatedTest.hash} /><AgentHandoff session={session} /></>}
      {replay?.screenshot && <details className="panel replay-artifact"><summary><span><Icon name="camera" />Automated reproduction screenshot</span><span className="badge">FRESH CONTEXT</span></summary><img src={`/api/sessions/${id}/artifacts/${replay.screenshot}`} alt="Actual browser state after executing the generated test" /><p className="artifact-note">Captured from the automated run, independently of the original recording.</p></details>}
      {replay?.status === 'error' && replay.output && <details className="panel replay-artifact"><summary>Execution details</summary><pre className="execution-output">{replay.output}</pre></details>}
      {!!session.warnings.length && <div className="warning-list">{session.warnings.map((warning, index) => <p key={index}><Icon name="alert" size={15} />{warning}</p>)}</div>}
      <footer className="app-footer"><span><Icon name="check" size={13} /> {active ? 'Recording locally. No data leaves this machine.' : 'Evidence saved locally in .bugreel/'}</span><Link href="/">Back to workspace <Icon name="arrow" size={13} /></Link></footer>
    </>}
  </main></>;
}
