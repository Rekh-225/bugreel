import { test, expect, chromium } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Session } from '../src/lib/session';

let failing = true;
let port = 0;
let server: http.Server;

const fixturePage = `<!doctype html><html><head><title>Ledger</title></head><body>
<button data-testid="pay" type="button">Pay invoice</button>
<p data-testid="pay-error" hidden></p>
<script>
document.querySelector('[data-testid="pay"]').addEventListener('click', async () => {
  const response = await fetch('/api/pay', { method: 'POST' });
  if (!response.ok) {
    const error = document.querySelector('[data-testid="pay-error"]');
    error.textContent = 'Payment failed (' + response.status + ')';
    error.hidden = false;
  }
});
</script>
</body></html>`;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/pay') {
      res.writeHead(failing ? 503 : 200, { 'content-type': 'application/json' });
      res.end(failing ? JSON.stringify({ code: 'PAYMENT_DOWN', message: 'Payment provider unavailable' }) : JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(fixturePage);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

test.afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test('records and replays a local app HTTP 5xx failure signature', async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByTestId('target-url').fill(`http://127.0.0.1:${port}/`);
  await page.getByTestId('start-local-recording').click();
  await expect(page).toHaveURL(/\/sessions\//);
  const id = page.url().split('/').at(-1)!;
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const store = browser.contexts()[0].pages()[0];
  try {
    await store.getByTestId('pay').click();
    await expect(store.getByTestId('pay-error')).toBeVisible();
    await page.getByTestId('stop-recording').click();
    await expect(page.getByTestId('session-status')).toHaveText('captured');
    await expect(page.getByTestId('failure-signature')).toHaveText('PAYMENT_DOWN');
    await expect(page.getByTestId('generated-source')).toContainText('/api/pay');
    await page.getByTestId('run-reproduction').click();
    await expect(page.getByTestId('replay-status')).toHaveText('REPRODUCTION CONFIRMED', { timeout: 70_000 });
    const session: Session = await (await request.get(`/api/sessions/${id}`)).json();
    expect(session.latestRun?.status).toBe('confirmed');
    expect(session.target).toBe('local');
    failing = false;
    await page.getByTestId('run-reproduction').click();
    await expect(page.getByTestId('replay-status')).toHaveText('NOT REPRODUCED', { timeout: 70_000 });
  } finally {
    await request.post(`/api/sessions/${id}/stop`, { headers: { origin: 'http://127.0.0.1:3000' } });
    await browser.close();
  }
});
