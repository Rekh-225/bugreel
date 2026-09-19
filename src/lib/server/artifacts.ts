import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Session } from '../session';

export const ARTIFACT_ROOT = path.join(process.cwd(), '.bugreel', 'sessions');
export function validId(id: string) { return /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id); }
export function sessionDirectory(id: string) {
  if (!validId(id)) throw new Error('Invalid session ID.');
  return path.join(ARTIFACT_ROOT, id);
}
export async function saveSession(session: Session) {
  const directory = sessionDirectory(session.id);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, 'session.json.tmp');
  await fs.writeFile(temporary, JSON.stringify(session, null, 2));
  await fs.rename(temporary, path.join(directory, 'session.json'));
}
export async function loadSession(id: string): Promise<Session | undefined> {
  try { return JSON.parse(await fs.readFile(path.join(sessionDirectory(id), 'session.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
export async function savedSessionIds() {
  const entries = await fs.readdir(ARTIFACT_ROOT).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []; throw error;
  });
  return entries.filter(validId);
}
