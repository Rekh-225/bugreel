import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAgentPacket, type RepositoryContext } from '../agent-packet';
import { sourceHash } from '../generation';
import type { Session } from '../session';
import { saveSession } from './artifacts';
import { ApiError } from './http';
import { state } from './session-manager';
import { createDevinSession, devinConfiguration, DevinRequestError } from './devin-client';

const execute = promisify(execFile);
export async function repositoryContext(): Promise<RepositoryContext> {
  const git = async (args: string[]) => (await execute('git', args, { cwd: process.cwd(), timeout: 5000, windowsHide: true })).stdout.trim();
  try {
    const [branch, commit, changes] = await Promise.all([git(['branch', '--show-current']), git(['rev-parse', 'HEAD']), git(['status', '--porcelain', '--untracked-files=no'])]);
    return { branch: branch || 'detached HEAD', commit, dirty: !!changes };
  } catch { return { branch: 'unknown', commit: 'unknown; verify repository revision manually', dirty: true }; }
}
export async function prepareHandoff(session: Session) {
  if (session.status !== 'captured' || !session.generatedTest) throw new ApiError('Finish a recording with a generated test before preparing an agent handoff.');
  const repository = await repositoryContext();
  const packet = createAgentPacket(session, repository);
  const config = devinConfiguration();
  return { packet, hash: sourceHash(packet), repository, configured: !!config, maxAcuLimit: config?.maxAcuLimit ?? 10, handoff: session.agentHandoff };
}

function previousSubmission(session: Session) {
  if (session.agentHandoff?.status === 'sent') return session.agentHandoff;
  if (session.agentHandoff && ['sending', 'uncertain'].includes(session.agentHandoff.status)) throw new ApiError('This handoff is already pending or its outcome is uncertain. Check Devin before resending.', 409);
}

type Dependencies = { prepare?: typeof prepareHandoff; configuration?: typeof devinConfiguration; send?: typeof createDevinSession; save?: typeof saveSession };
export async function submitHandoff(session: Session, body: { confirm?: boolean; packetHash?: string; maxAcuLimit?: number }, dependencies: Dependencies = {}) {
  if (body.confirm !== true) throw new ApiError('Explicit confirmation is required to send evidence and use Devin credits.');
  const previous = previousSubmission(session);
  if (previous) return previous;
  const prepared = await (dependencies.prepare || prepareHandoff)(session);
  if (body.packetHash !== prepared.hash) throw new ApiError('The evidence or repository context changed. Refresh the packet and review it before sending.', 409);
  if (!session.failure || session.latestRun?.status !== 'confirmed' || session.latestRun.sourceHash !== session.generatedTest?.hash) throw new ApiError('Confirm the bug with Run Reproduction before starting a fix session.');
  if (Buffer.byteLength(prepared.packet, 'utf8') > 150_000) throw new ApiError('This packet is too large for the one-click handoff. Download and review it manually.');
  const config = (dependencies.configuration || devinConfiguration)();
  if (!config) throw new ApiError('Configure DEVIN_API_KEY and DEVIN_ORG_ID on the server, then restart BugReel. Copy Agent Packet is available without credentials.', 503);
  if (body.maxAcuLimit !== config.maxAcuLimit) throw new ApiError('The usage limit changed. Refresh the packet and confirm the current limit.', 409);
  const latest = previousSubmission(session);
  if (latest) return latest;
  if (state.busy) throw new ApiError('Wait for the current recording, replay, or handoff to finish.', 409);
  const lock = `handoff-${session.id}`;
  state.busy = lock;
  const save = dependencies.save || saveSession;
  session.agentHandoff = { status: 'sending', createdAt: new Date().toISOString(), packetHash: prepared.hash, maxAcuLimit: config.maxAcuLimit, message: 'Sending the reviewed evidence to Devin.' };
  try {
    await save(session);
    const result = await (dependencies.send || createDevinSession)(prepared.packet, session.report?.title || 'Captured browser failure', config);
    Object.assign(session.agentHandoff, result, { status: 'sent', message: 'A Devin session was created. Follow its progress in Devin; this does not mean the bug is fixed.' });
  } catch (error) {
    session.agentHandoff.status = error instanceof DevinRequestError && !error.uncertain ? 'error' : 'uncertain';
    session.agentHandoff.message = error instanceof DevinRequestError ? error.message : 'Handoff could not be confirmed. Check Devin before retrying; no automatic retry will occur.';
  } finally {
    try { await save(session); }
    finally { if (state.busy === lock) state.busy = undefined; }
  }
  return session.agentHandoff;
}
