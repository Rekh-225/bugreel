import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateReport, generateTest, sourceHash } from '../generation';
import type { Session } from '../session';
import { saveSession, sessionDirectory } from './artifacts';

export async function finalizeSession(session: Session) {
  session.report = generateReport(session);
  if (session.status === 'captured' && !session.generatedTest) {
    try {
      const source = generateTest(session);
      await fs.writeFile(path.join(sessionDirectory(session.id), 'reproduction.spec.ts'), source);
      session.generatedTest = { source, hash: sourceHash(source), version: 1 };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Test generation could not complete.';
      if (!session.warnings.includes(message)) session.warnings.push(message);
    }
  }
  await saveSession(session);
  return session;
}
