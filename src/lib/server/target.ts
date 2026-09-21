import { ApiError } from './http';
import { APP_ORIGIN } from './session-manager';

export const DEMO_STORE_URL = `${APP_ORIGIN}/demo-store`;

export function resolveTarget(input?: string | null): { url: string; target: 'demo' | 'local' } {
  const trimmed = input?.trim();
  if (!trimmed) return { url: DEMO_STORE_URL, target: 'demo' };
  let url: URL;
  try { url = new URL(trimmed); }
  catch { throw new ApiError('Enter a valid http:// URL for an app running on this machine.', 400); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new ApiError('Only local http://127.0.0.1 or http://localhost targets can be recorded.', 400);
  }
  url.hash = '';
  if (url.origin === APP_ORIGIN) {
    if (url.pathname === '/demo-store') return { url: DEMO_STORE_URL, target: 'demo' };
    throw new ApiError('BugReel cannot record itself. Enter the URL of another local app.', 400);
  }
  return { url: url.toString(), target: 'local' };
}
