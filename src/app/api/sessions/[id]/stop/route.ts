import { api, ApiError, requireControl, requireId } from '@/lib/server/http';
import { getSession, state } from '@/lib/server/session-manager';
import { finalizeSession } from '@/lib/server/finalize';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    requireControl(request);
    const { id } = await context.params;
    requireId(id);
    const session = state.activeRecording?.id === id ? await state.activeRecording.stop() : await getSession(id);
    if (!session) throw new ApiError('Session not found.', 404);
    return finalizeSession(session);
  });
}
