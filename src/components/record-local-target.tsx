'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './icon';

export function RecordLocalTarget() {
  const router = useRouter();
  const [targetUrl, setTargetUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetUrl }) });
      const session = await response.json();
      if (!response.ok) throw new Error(session.error);
      router.push(`/sessions/${session.id}`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not launch the recording browser.'); setBusy(false); }
  }
  return <>
    <div className="local-target-copy"><h2>Bring your own local app</h2><p>Enter the URL of an app running on this machine. BugReel records it the same way and treats the first HTTP 5xx response as the failure signature. Experimental.</p></div>
    <div className="local-target-form"><input data-testid="target-url" type="url" placeholder="http://localhost:5173/" value={targetUrl} onChange={event => setTargetUrl(event.target.value)} aria-label="Local app URL" /><button data-testid="start-local-recording" disabled={busy || !targetUrl.trim()} onClick={start} className="button secondary"><span className={busy ? 'spinner' : 'record-icon'} />{busy ? 'Opening browser…' : 'Record local app'}{!busy && <Icon name="arrow" size={15} />}</button></div>
    {error && <p role="alert" className="start-error">{error}</p>}
  </>;
}
