import { api, ApiError, requireId } from '@/lib/server/http';
import { getSession } from '@/lib/server/session-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const { id } = await context.params;
    requireId(id);
    const session = await getSession(id);
    if (!session) throw new ApiError('Session not found.', 404);
    return session;
  });
}
