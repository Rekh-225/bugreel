import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Deterministic local fixture site. The same server is reachable as two different origins:
// http://127.0.0.1:<port> (the recorded site) and http://localhost:<port> (a "different site").

const page = (title: string, body: string, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;margin:24px}main>*{display:block;margin:6px 0}iframe{height:60px}</style></head>
<body><main>${body}</main><script>${script}</script></body></html>`;

function appPage(crossOrigin: string) {
  return page('Fixture Shop', `
<h1 id="heading">Fixture Shop</h1>
<label for="name">Full name</label><input id="name" name="fullName">
<label for="coupon">Coupon code</label><input id="coupon" name="coupon">
<label for="pw">Password</label><input id="pw" type="password" name="password">
<label for="email">Email</label><input id="email" type="email">
<label for="size">Size</label><select id="size"><option value="s">Small</option><option value="m">Medium</option></select>
<label><input type="checkbox" id="terms"> Accept terms</label>
<button data-testid="checkout">Checkout</button>
<button id="throw">Throw error</button>
<button id="missing">Load missing</button>
<button id="reset">Break connection</button>
<button id="log">Log problem</button>
<a href="/second.html">Go to second page</a>
<button id="spa">Open settings view</button>
<a id="cross" href="${crossOrigin}/second.html">Leave site</a>
<form id="search-form"><input name="query" aria-label="Query"><button type="submit">Search</button></form>
<div contenteditable="true" aria-label="Notes" style="border:1px solid #999;min-height:20px"></div>
<input type="file" aria-label="Attachment">
<iframe src="/frame.html" title="Embedded frame"></iframe>
<p id="result" role="status"></p>`, `
const result = document.getElementById('result');
document.querySelector('[data-testid="checkout"]').addEventListener('click', async () => {
  const response = await fetch('/api/fail', { method: 'POST' });
  console.error('Checkout failed: ORDER_SUBMISSION_FAILED for user test@example.com');
  result.textContent = 'Checkout failed (' + response.status + ')';
});
document.getElementById('throw').addEventListener('click', () => { setTimeout(() => { throw new Error('Fixture exception while rendering cart'); }, 0); });
document.getElementById('missing').addEventListener('click', () => fetch('/api/missing'));
document.getElementById('reset').addEventListener('click', () => fetch('/api/reset').catch(() => {}));
document.getElementById('log').addEventListener('click', () => console.error('Problem logged with token=supersecretvalue123'));
document.getElementById('spa').addEventListener('click', () => { history.pushState({}, '', '/app/settings'); result.textContent = 'Settings view'; });
document.getElementById('search-form').addEventListener('submit', event => { event.preventDefault(); result.textContent = 'Searched'; });
if (location.pathname === '/app/settings') result.textContent = 'Settings view';
`);
}

export type FixtureServer = { origin: string; otherOrigin: string; url: (path: string) => string; close: () => Promise<void> };

export async function startFixtureServer(): Promise<FixtureServer> {
  let port = 0;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const html = (body: string) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(body); };
    const json = (status: number, body: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (url.pathname === '/' || url.pathname === '/app.html' || url.pathname.startsWith('/app/')) return html(appPage(`http://localhost:${port}`));
    if (url.pathname === '/second.html') return html(page('Second page', '<h1>Second page</h1><button id="second-action">Continue</button><a href="/app.html">Back to shop</a><p id="result"></p>', "document.getElementById('second-action').addEventListener('click', () => { document.getElementById('result').textContent = 'Continued'; });"));
    if (url.pathname === '/frame.html') return html(page('Frame', '<button id="in-frame">Inside frame</button>'));
    if (url.pathname === '/redirect') { response.writeHead(302, { location: '/second.html' }); return response.end(); }
    if (url.pathname === '/api/ok') return json(200, { ok: true });
    if (url.pathname === '/api/fail') return json(500, { code: 'ORDER_SUBMISSION_FAILED' });
    if (url.pathname === '/api/missing') return json(404, { error: 'not found' });
    if (url.pathname === '/api/reset') { request.socket.destroy(); return; }
    json(404, { error: 'not found' });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  // localhost must resolve to the same listener; bind IPv6 loopback too when available.
  const v6 = http.createServer((request, response) => server.emit('request', request, response));
  await new Promise<void>(resolve => { v6.once('error', () => resolve()); v6.listen(port, '::1', resolve); });
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin, otherOrigin: `http://localhost:${port}`, url: path => `${origin}${path}`,
    close: () => Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => v6.listening ? v6.close(() => resolve()) : resolve())]).then(() => undefined),
  };
}
