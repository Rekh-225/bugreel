import { test, expect } from '@playwright/test';

test('browser controls reject cross-origin and missing-origin requests', async ({ request }) => {
  const headerCases: Record<string, string>[] = [{}, { origin: 'https://example.com' }];
  for (const headers of headerCases) {
    const response = await request.post('/api/sessions', { headers });
    expect(response.status()).toBe(403);
  }
});

test('invalid session IDs and unapproved artifacts are rejected', async ({ request }) => {
  expect((await request.get('/api/sessions/not-a-session')).status()).toBe(400);
  expect((await request.get('/api/sessions/00000000-0000-0000-0000-000000000000/artifacts/package.json')).status()).toBe(404);
});

test('local recording targets are validated before any browser work', async ({ request }) => {
  const before = (await (await request.get('/api/sessions')).json()).length;
  for (const targetUrl of ['https://example.com', 'http://192.168.1.10:3000/', 'http://127.0.0.1:3000/', 'not a url']) {
    const response = await request.post('/api/sessions', { headers: { origin: 'http://127.0.0.1:3000' }, data: { targetUrl } });
    expect(response.status(), targetUrl).toBe(400);
  }
  const after = (await (await request.get('/api/sessions')).json()).length;
  expect(after).toBe(before);
});
