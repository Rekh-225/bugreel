'use client';

import { useEffect, useState } from 'react';
import type { AgentHandoff as Handoff, Session } from '@/lib/session';
import type { RepositoryContext } from '@/lib/agent-packet';
import { Icon } from './icon';

type Preview = { packet: string; hash: string; configured: boolean; maxAcuLimit: number; repository: RepositoryContext; handoff?: Handoff };
export function AgentHandoff({ session }: { session: Session }) {
  const [preview, setPreview] = useState<Preview>();
  const [handoff, setHandoff] = useState<Handoff>();
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const id = session.id;
  async function refresh() {
    setConsent(false);
    try {
      const response = await fetch(`/api/sessions/${id}/handoff`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setPreview(body); setHandoff(body.handoff); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not prepare the handoff packet.'); }
  }
  useEffect(() => {
    let mounted = true;
    setConsent(false);
    fetch(`/api/sessions/${id}/handoff`, { cache: 'no-store' }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (mounted) { setPreview(body); setHandoff(body.handoff); }
    }).catch(error => { if (mounted) setError(error.message); });
    return () => { mounted = false; };
  }, [id, session.latestRun?.id, session.latestRun?.status]);
  async function copy() {
    if (!preview) return;
    try { await navigator.clipboard.writeText(preview.packet); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError('Clipboard unavailable. Download the packet instead.'); }
  }
  function download() {
    if (!preview) return;
    const url = URL.createObjectURL(new Blob([preview.packet], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `bugreel-${id}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function send() {
    if (!preview || !consent) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/sessions/${id}/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, packetHash: preview.hash, maxAcuLimit: preview.maxAcuLimit }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setHandoff(body); setConsent(false);
    } catch (error) { setConsent(false); setError(`${error instanceof Error ? error.message : 'Submission could not be confirmed.'} Refresh the packet/status before trying again.`); }
    finally { setBusy(false); }
  }
  const current = handoff || session.agentHandoff;
  const blocked = !!current && ['sent', 'sending', 'uncertain'].includes(current.status);
  const confirmed = session.latestRun?.status === 'confirmed';
  return <section className="panel mt-5" id="agent-handoff"><div className="panel-heading"><div className="panel-title"><Icon name="arrow" /><h2>Hand off to a coding agent</h2><span className="badge">OPTIONAL</span></div><button className="text-button" onClick={refresh} disabled={busy}>Refresh packet / status</button></div><div className="p-5">
    <p className="text-xs leading-6 text-[#a3b1ac]">Give Devin—or another coding agent—the evidence, repository context, and exact test. Ask for a fix on a separate branch. Your working demo stays untouched.</p>
    <div className="my-4 flex flex-wrap gap-2"><button className="button secondary" data-testid="copy-agent-packet" onClick={copy} disabled={!preview}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Copied agent packet' : 'Copy Agent Packet'}</button><button className="button secondary" data-testid="download-agent-packet" onClick={download} disabled={!preview}><Icon name="download" size={14} />Download packet</button></div>
    {preview && <><details className="rounded border border-[#29332d] bg-[#0e1215]"><summary className="cursor-pointer px-4 py-3 text-[11px] text-[#9cb4a5]">Review exactly what will be sent <span className="ml-2 text-[9px] text-[#6f8176]">TEXT ONLY · {Math.ceil(new Blob([preview.packet]).size / 1024)} KB</span></summary><pre data-testid="agent-packet" className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-[#29332d] p-4 text-[10px] leading-5 text-[#91aa9c]">{preview.packet}</pre></details>
      <p className="my-3 text-[10px] leading-5 text-[#819087]">Screenshots are not uploaded. Attach them manually in the agent session if needed. Preview all recorded text before sharing it.</p>
      {preview.repository.dirty && <p className="mb-3 text-[10px] text-amber-200/70">There are local code changes. They are not included in the packet; publish the intended code before asking a cloud agent to investigate.</p>}
      <div className="mt-5 border-t border-[#29332d] pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs font-medium">Send directly to Devin</strong><span className={`badge ${preview.configured ? 'mint' : ''}`} data-testid="devin-configuration">{preview.configured ? 'API configured' : 'API not configured'}</span></div>
        {!preview.configured && <p className="mt-3 text-[11px] leading-6 text-[#8a9691]">Copy/download works now. For one-click sending, configure server-side <code>DEVIN_API_KEY</code> and <code>DEVIN_ORG_ID</code>, then restart BugReel. Use a Devin service-user key with session-creation permission. Never put it in frontend code or GitHub.</p>}
        {!confirmed && <p className="mt-3 text-[11px] text-[#baa779]">Run Reproduction must confirm this bug before an automatic fix handoff is available.</p>}
        <label className="mt-4 flex items-start gap-3 text-[11px] leading-6 text-[#a7b4ac]"><input data-testid="handoff-consent" className="mt-1 accent-[#b5f3cb]" type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={!preview.configured || !confirmed || blocked || busy} /><span>I reviewed the packet and authorize sending it to Devin and starting a session using my account’s credits, with a limit of <strong>{preview.maxAcuLimit} ACUs</strong>.</span></label>
        <div className="mt-4 flex flex-wrap items-center gap-3"><button data-testid="send-to-devin" className="button primary" onClick={send} disabled={!preview.configured || !confirmed || !consent || blocked || busy}>{busy ? <span className="spinner" /> : <Icon name="external" size={14} />}{busy ? 'Starting Devin session…' : 'Send to Devin'}</button><span className="text-[10px] text-[#7a8e80]">Separate fix branch · No automatic merge · No automatic retry</span></div>
      </div>
    </>}
    {current && <div className="mt-4 rounded border border-[#35483c] bg-[#1a302233] p-4" aria-live="polite"><strong className="text-[11px] text-[#b5dbc1]" data-testid="handoff-status">{current.status === 'sent' ? 'SENT TO DEVIN' : current.status === 'sending' ? 'HANDOFF PENDING' : current.status === 'uncertain' ? 'HANDOFF OUTCOME UNKNOWN' : 'HANDOFF NOT SENT'}</strong><p className="mt-2 text-[11px] leading-6 text-[#95a89b]">{current.message}</p>{current.url && <a data-testid="open-devin" className="button secondary mt-3" href={current.url} target="_blank" rel="noreferrer">Open Devin Session <Icon name="external" size={14} /></a>}</div>}
    {error && <p role="alert" className="mt-4 text-[11px] leading-6 text-[#e6a6b8]">{error}</p>}
  </div></section>;
}
