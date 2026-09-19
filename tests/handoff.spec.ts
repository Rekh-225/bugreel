import { test, expect } from '@playwright/test';
import { createAgentPacket } from '../src/lib/agent-packet';
import { createDevinSession, devinConfiguration, DevinRequestError } from '../src/lib/server/devin-client';
import { submitHandoff } from '../src/lib/server/agent-handoff';
import { state } from '../src/lib/server/session-manager';
import type { Session } from '../src/lib/session';

const fixture = (): Session => ({
  id: '00000000-0000-0000-0000-000000000001', startedAt: '2026-09-19T10:00:00Z', startUrl: 'http://127.0.0.1:3000/demo-store', status: 'captured',
  events: [], actions: [{ id: '1', type: 'click', label: 'Click Checkout', timestamp: '', elapsedMs: 0 }],
  consoleErrors: [], networkErrors: [], screenshots: [], warnings: [],
  failure: { code: 'DISCOUNT_CHECKOUT_FAILURE', message: 'Failure', status: 500, pathname: '/api/demo/checkout', method: 'POST', networkId: '1', visible: true },
  generatedTest: { source: 'exact recorded test source', hash: 'source-hash', version: 1 },
  latestRun: { id: 'run', status: 'confirmed', startedAt: '', message: 'Confirmed', sourceHash: 'source-hash' },
});
const config = { apiKey: 'fake-test-key', organizationId: 'org-test', maxAcuLimit: 10 };
const prepared = { packet: 'reviewed packet', hash: 'a'.repeat(64), repository: { branch: 'main', commit: 'abc', dirty: false }, configured: true, maxAcuLimit: 10, handoff: undefined };
const result = { sessionId: 'devin-test', url: 'https://app.devin.ai/sessions/devin-test' };
const dependencies = { prepare: async () => prepared, configuration: () => config, save: async () => {} };
const confirmation = { confirm: true, packetHash: prepared.hash, maxAcuLimit: 10 };

test.afterEach(() => { state.busy = undefined; });

test('agent packet contains exact evidence, test, repo context, and demo protection', () => {
  const packet = createAgentPacket(fixture(), { branch: 'main', commit: 'abc', dirty: false });
  expect(packet).toContain('https://github.com/Rekh-225/bugreel');
  expect(packet).toContain('exact recorded test source');
  expect(packet).toContain('DISCOUNT_CHECKOUT_FAILURE');
  expect(packet).toContain('Do not merge, deploy, or modify main');
  expect(packet).toContain('Screenshot image bytes are NOT included');
  expect(packet).toContain('test PASSES when the bug exists');
});

test('configuration does not require credentials for the copy fallback', () => {
  expect(devinConfiguration({})).toBeUndefined();
  expect(devinConfiguration({ DEVIN_API_KEY: 'fake', DEVIN_ORG_ID: 'org-test' })?.maxAcuLimit).toBe(10);
  expect(devinConfiguration({ DEVIN_API_KEY: 'fake', DEVIN_ORG_ID: 'org-test', DEVIN_MAX_ACU_LIMIT: '0' })).toBeUndefined();
});

test('mocked Devin API receives exact packet, server auth, and bounded usage', async () => {
  let calls = 0;
  const mock: typeof fetch = async (url, options) => {
    calls++;
    expect(String(url)).toBe('https://api.devin.ai/v3/organizations/org-test/sessions');
    expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer fake-test-key');
    const body = JSON.parse(options?.body as string);
    expect(body.prompt).toBe('exact packet');
    expect(body.max_acu_limit).toBe(10);
    expect(body.secret_ids).toEqual([]);
    expect(body.bypass_approval).toBeUndefined();
    return Response.json({ session_id: 'devin-test', url: result.url });
  };
  expect(await createDevinSession('exact packet', 'Checkout issue', config, mock)).toEqual(result);
  expect(calls).toBe(1);
});

test('API errors are sanitized and ambiguous outcomes are not retried', async () => {
  for (const code of [401, 403, 429]) {
    const mock: typeof fetch = async () => new Response('sensitive upstream body', { status: code });
    await expect(createDevinSession('packet', 'title', config, mock)).rejects.not.toThrow('sensitive upstream body');
  }
  for (const mock of [async () => { throw new Error('network'); }, async () => new Response('', { status: 500 }), async () => Response.json({ session_id: 'id', url: 'https://example.com' })]) {
    await expect(createDevinSession('packet', 'title', config, mock)).rejects.toMatchObject({ uncertain: true });
  }
});

test('consent, exact preview hash, and a confirmed reproduction are required', async () => {
  const send = async () => { throw new Error('must never send'); };
  await expect(submitHandoff(fixture(), { ...confirmation, confirm: false }, { ...dependencies, send })).rejects.toThrow('Explicit confirmation');
  await expect(submitHandoff(fixture(), { ...confirmation, packetHash: 'different' }, { ...dependencies, send })).rejects.toThrow('changed');
  await expect(submitHandoff(fixture(), { ...confirmation, maxAcuLimit: 20 }, { ...dependencies, send })).rejects.toThrow('usage limit changed');
  await expect(submitHandoff({ ...fixture(), latestRun: undefined }, confirmation, { ...dependencies, send })).rejects.toThrow('Confirm the bug');
});

test('successful submission is persisted and duplicate clicks do not start another session', async () => {
  let calls = 0;
  let saves = 0;
  const session = fixture();
  const deps = { ...dependencies, send: async () => { calls++; return result; }, save: async () => { saves++; } };
  expect((await submitHandoff(session, confirmation, deps)).status).toBe('sent');
  expect((await submitHandoff(session, confirmation, deps)).url).toBe(result.url);
  expect(calls).toBe(1);
  expect(saves).toBe(2);
});

test('concurrent requests recheck persisted success after preparing the packet', async () => {
  const session = fixture();
  let preparations = 0;
  let calls = 0;
  let release!: (value: typeof prepared) => void;
  const delayed = new Promise<typeof prepared>(resolve => { release = resolve; });
  const deps = { ...dependencies, prepare: async () => ++preparations === 1 ? prepared : delayed, send: async () => { calls++; return result; } };
  const first = submitHandoff(session, confirmation, deps);
  const second = submitHandoff(session, confirmation, deps);
  await first;
  release(prepared);
  await second;
  expect(calls).toBe(1);
});

test('uncertain submissions block resending and missing configuration makes zero calls', async () => {
  const session = fixture();
  await submitHandoff(session, confirmation, { ...dependencies, send: async () => { throw new DevinRequestError('Check account', true); } });
  expect(session.agentHandoff?.status).toBe('uncertain');
  await expect(submitHandoff(session, confirmation, dependencies)).rejects.toThrow('uncertain');
  await expect(submitHandoff(fixture(), confirmation, { ...dependencies, configuration: () => undefined, send: async () => { throw new Error('must never send'); } })).rejects.toThrow('Configure DEVIN_API_KEY');
});
