import { api, ApiError, requireControl, requireId } from '@/lib/server/http';
import { getSession } from '@/lib/server/session-manager';
import { prepareHandoff, submitHandoff } from '@/lib/server/agent-handoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function sessionFor(context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  requireId(id);
  const session = await getSession(id);
  if (!session) throw new ApiError('Session not found.', 404);
  return session;
}
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => prepareHandoff(await sessionFor(context)));
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    requireControl(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.packetHash !== 'string' || body.packetHash.length !== 64) throw new ApiError('A reviewed packet hash is required.');
    return submitHandoff(await sessionFor(context), body);
  });
}
