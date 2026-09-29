import { useEffect, useState } from 'react';
import type { SessionStatus } from '../shared/types';

const STATUS_TEXT: Record<SessionStatus, string> = { recording: 'Recording', paused: 'Paused', completed: 'Completed', interrupted: 'Interrupted' };

export function StatusBadge({ status }: { status: SessionStatus }) {
  return <span className={`badge ${status}`} data-testid="status-badge">{STATUS_TEXT[status]}</span>;
}

/** Two-step button for destructive actions. */
export function ConfirmButton({ label, confirmLabel, onConfirm, testId }: { label: string; confirmLabel: string; onConfirm: () => void; testId: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return armed
    ? <button className="danger" data-testid={`${testId}-confirm`} onClick={() => { setArmed(false); onConfirm(); }}>{confirmLabel}</button>
    : <button className="subtle" data-testid={testId} onClick={() => setArmed(true)}>{label}</button>;
}

/** Object URL for a stored screenshot blob, revoked when no longer shown. */
export function useObjectUrl(blob: Blob | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
