export type DevinConfiguration = { apiKey: string; organizationId: string; maxAcuLimit: number };
export class DevinRequestError extends Error {
  constructor(message: string, public uncertain = false) { super(message); }
}
export function devinConfiguration(env: Record<string, string | undefined> = process.env): DevinConfiguration | undefined {
  const apiKey = env.DEVIN_API_KEY?.trim();
  const organizationId = env.DEVIN_ORG_ID?.trim();
  const maxAcuLimit = Number(env.DEVIN_MAX_ACU_LIMIT || 10);
  if (!apiKey || !organizationId || !/^[a-zA-Z0-9_-]{1,100}$/.test(organizationId) || !Number.isInteger(maxAcuLimit) || maxAcuLimit < 1 || maxAcuLimit > 100) return undefined;
  return { apiKey, organizationId, maxAcuLimit };
}
export async function createDevinSession(packet: string, title: string, config: DevinConfiguration, transport: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await transport(`https://api.devin.ai/v3/organizations/${encodeURIComponent(config.organizationId)}/sessions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: packet, title: `BugReel: ${title}`.slice(0, 200), max_acu_limit: config.maxAcuLimit, tags: ['bugreel', 'bug-fix-handoff'], secret_ids: [] }),
    });
  } catch {
    throw new DevinRequestError('The request outcome is unknown. A Devin session may have started. Check your Devin account before retrying; BugReel will not automatically resend.', true);
  }
  if (!response.ok) {
    if ([408, 409].includes(response.status) || response.status >= 500) throw new DevinRequestError('Devin could not confirm the submission. Check your Devin account; a session may exist. Automatic retry is disabled.', true);
    const message = response.status === 401 ? 'Devin rejected the API key. Check the server-side credentials.' : response.status === 403 ? 'The Devin service user lacks permission to create sessions for this organization.' : response.status === 429 ? 'Devin rate-limited the request. No retry was attempted.' : `Devin rejected the request (HTTP ${response.status}). Check your organization and API configuration.`;
    throw new DevinRequestError(message);
  }
  const body = await response.json().catch(() => null);
  let validUrl = false;
  try { const url = new URL(body?.url); validUrl = url.origin === 'https://app.devin.ai' && url.pathname.startsWith('/sessions/'); } catch {}
  if (typeof body?.session_id !== 'string' || body.session_id.length > 200 || !validUrl) throw new DevinRequestError('Devin returned an unexpected response. Check your account before retrying; a session may have started.', true);
  return { sessionId: body.session_id as string, url: body.url as string };
}
