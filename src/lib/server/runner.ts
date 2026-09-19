import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateTest, sourceHash } from '../generation';
import { classifyReplay, reportResults, type Proof, type RunnerReport } from '../replay-result';
import type { ReplayRun, Session } from '../session';
import { saveSession, sessionDirectory } from './artifacts';
import { ApiError } from './http';
import { state } from './session-manager';

export async function startReplay(session: Session) {
  if (state.busy) throw new ApiError('Another recording or reproduction is already running.', 409);
  if (session.status !== 'captured' || !session.generatedTest) throw new ApiError('Finish a valid checkout recording before running reproduction.');
  const directory = sessionDirectory(session.id);
  const source = await fs.readFile(path.join(directory, 'reproduction.spec.ts'), 'utf8');
  if (source !== session.generatedTest.source || sourceHash(source) !== session.generatedTest.hash || source !== generateTest(session)) throw new ApiError('The saved test no longer matches the generated, displayed source. Record a new session.', 409);
  if (state.busy) throw new ApiError('Another browser task has started.', 409);
  const run: ReplayRun = { id: randomUUID(), status: 'running', startedAt: new Date().toISOString(), sourceHash: sourceHash(source), message: 'Executing the exact generated test in a fresh browser context.' };
  state.busy = run.id;
  session.latestRun = run;
  try { await saveSession(session); }
  catch (error) { state.busy = undefined; run.status = 'error'; throw error; }
  void execute(session, run, directory);
  return run;
}

async function execute(session: Session, run: ReplayRun, directory: string) {
  const runDirectory = path.join(directory, 'runs', run.id);
  try {
    await fs.mkdir(runDirectory, { recursive: true });
    const require = createRequire(path.join(process.cwd(), 'package.json'));
    const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', path.join(process.cwd(), 'playwright.reproduction.config.ts')], {
      cwd: process.cwd(), shell: false, windowsHide: true,
      env: { ...process.env, BUGREEL_SESSION_DIR: directory, BUGREEL_RUN_DIR: runDirectory, BUGREEL_HEADLESS: process.env.BUGREEL_REPLAY_HEADLESS === '1' ? '1' : '0' },
    });
    let output = '';
    const collect = (data: Buffer) => { output = (output + data.toString()).slice(-12_000); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let timedOut = false;
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const deadline = setTimeout(() => {
        timedOut = true;
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true });
          killer.on('error', () => child.kill());
        } else child.kill('SIGTERM');
      }, 75_000);
      child.once('error', error => { clearTimeout(deadline); reject(error); });
      child.once('close', code => { clearTimeout(deadline); resolve(code); });
    });
    run.output = output;
    if (timedOut) throw new Error('Replay exceeded its execution deadline. No reproduction was confirmed.');
    const report: RunnerReport = JSON.parse(await fs.readFile(path.join(runDirectory, 'result.json'), 'utf8'));
    const result = reportResults(report)[0];
    const attachment = result?.attachments?.find(item => item.name === 'bugreel-evidence');
    const safeAttachmentPath = (file: string) => {
      const relative = path.relative(runDirectory, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid replay artifact path.');
      return file;
    };
    const proof: Proof | undefined = attachment?.body ? JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')) : attachment?.path ? JSON.parse(await fs.readFile(safeAttachmentPath(attachment.path), 'utf8')) : undefined;
    Object.assign(run, classifyReplay(report, exitCode, proof));
    const screenshot = result?.attachments?.find(item => item.name === 'replay-screenshot');
    if (screenshot?.path) {
      run.screenshot = `replay-${run.id}.png`;
      await fs.copyFile(safeAttachmentPath(screenshot.path), path.join(directory, run.screenshot));
    }
    if (run.status === 'error' && result?.errors?.[0]?.message) run.output = `${result.errors[0].message}\n${output}`.slice(0, 12_000);
  } catch (error) {
    run.status = 'error';
    run.message = error instanceof Error ? error.message : 'Replay could not complete.';
  } finally {
    run.finishedAt = new Date().toISOString();
    run.durationMs = Date.now() - Date.parse(run.startedAt);
    if (state.busy === run.id) state.busy = undefined;
    await saveSession(session).catch(error => { run.status = 'error'; run.message = `Could not persist replay result: ${error instanceof Error ? error.message : 'disk error'}`; });
  }
}
