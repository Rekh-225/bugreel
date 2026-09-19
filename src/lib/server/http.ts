import { NextResponse } from 'next/server';
import { APP_ORIGIN } from './session-manager';
import { validId } from './artifacts';

export class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function requireControl(request: Request) {
  if (request.headers.get('origin') !== APP_ORIGIN) throw new ApiError('Control requests must come from the local BugReel application.', 403);
}
export function requireId(id: string) {
  if (!validId(id)) throw new ApiError('Invalid session ID.', 400);
}
export async function api(operation: () => Promise<unknown>, status = 200) {
  try { return NextResponse.json(await operation(), { status, headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Operation failed.' }, { status: error instanceof ApiError ? error.status : 500 });
  }
}
