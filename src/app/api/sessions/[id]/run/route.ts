import { api, ApiError, requireControl, requireId } from '@/lib/server/http';
import { getSession } from '@/lib/server/session-manager';
import { startReplay } from '@/lib/server/runner';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    requireControl(request);
    const { id } = await context.params;
    requireId(id);
    const session = await getSession(id);
    if (!session) throw new ApiError('Session not found.', 404);
    return startReplay(session);
  }, 202);
}
