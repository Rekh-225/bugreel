'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from './icon';

type Recent = { id: string; startedAt: string; status: string; title: string; actionCount: number; failure: boolean; runStatus?: string };
export function RecentSessions() {
  const [sessions, setSessions] = useState<Recent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    fetch('/api/sessions', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Saved sessions are temporarily unavailable.');
      const body = await response.json();
      if (mounted) setSessions(body);
    }).catch(error => { if (mounted) setError(error.message); }).finally(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; };
  }, []);
  return <section className="recent-section"><div className="section-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>Recent sessions</h2></div><span className="muted small">Saved on this machine</span></div>
    {error ? <p className="empty-state">{error}</p> : !loaded ? <p className="empty-state">Loading local sessions…</p> : !sessions.length ? <div className="empty-state"><Icon name="layers" size={24} /><div><strong>Your first bug starts here.</strong><p>Record the Demo Store to turn a checkout failure into executable evidence.</p></div></div> : <div className="session-list">{sessions.slice(0, 5).map(session => <Link key={session.id} href={`/sessions/${session.id}`} className="session-row"><span className={`session-row-icon ${session.failure ? 'failure' : ''}`}><Icon name={session.failure ? 'alert' : 'layers'} /></span><div className="session-row-main"><strong>{session.title}</strong><span>{session.id.slice(0, 8)} <span className="divider-dot">·</span> {session.actionCount} actions <span className="divider-dot">·</span> {new Date(session.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div><span className={`badge ${session.runStatus === 'confirmed' ? 'mint' : ''}`}>{session.runStatus === 'confirmed' ? 'Reproduced' : session.runStatus === 'not_reproduced' ? 'Not reproduced' : session.status === 'recording' ? 'Recording' : session.runStatus === 'error' ? 'Replay error' : 'Saved session'}</span><Icon name="arrow" size={16} /></Link>)}</div>}
  </section>;
}
