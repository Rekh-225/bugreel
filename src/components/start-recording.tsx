'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './icon';

export function StartRecording() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/sessions', { method: 'POST' });
      const session = await response.json();
      if (!response.ok) throw new Error(session.error);
      router.push(`/sessions/${session.id}`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not launch the recording browser.'); setBusy(false); }
  }
  return <div className="start-control"><button data-testid="start-recording" disabled={busy} onClick={start} className="button primary"><span className={busy ? 'spinner' : 'record-icon'} />{busy ? 'Opening browser…' : 'Record Demo Store'}{!busy && <Icon name="arrow" size={16} />}</button>{error && <p role="alert" className="start-error">{error}</p>}</div>;
}
