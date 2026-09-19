import { api, requireControl } from '@/lib/server/http';
import { listSessions } from '@/lib/server/session-manager';
import { startRecording } from '@/lib/server/recorder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { return api(listSessions); }
export async function POST(request: Request) { return api(async () => { requireControl(request); return startRecording(); }, 201); }
