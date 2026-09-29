// Serves the BugReel demo site used for manual verification and Chrome Web Store review.
// Usage: npm run ext:demo   ->  http://127.0.0.1:4180/  (the same site as "another origin": http://localhost:4180/)
// Everything here is synthetic. There are no accounts, no external services, and no real data.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.BUGREEL_DEMO_PORT) || 4180;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  const json = (status, body) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
  if (url.pathname === '/api/checkout') return json(500, { code: 'DEMO_CHECKOUT_FAILURE', message: 'Synthetic checkout failure for the BugReel demo.' });
  if (url.pathname === '/api/missing') return json(404, { error: 'not found' });
  if (url.pathname === '/api/ok') return json(200, { ok: true });
  if (url.pathname === '/api/reset') { request.socket.destroy(); return; }
  let file = url.pathname === '/' ? '/index.html' : url.pathname.startsWith('/app/') ? '/index.html' : url.pathname;
  const resolved = path.normalize(path.join(root, file));
  if (!resolved.startsWith(root)) { response.writeHead(403); return response.end(); }
  try {
    const body = await fs.readFile(resolved);
    response.writeHead(200, { 'content-type': types[path.extname(resolved)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`BugReel demo site: http://127.0.0.1:${port}/`);
  console.log(`Same site as a different origin (for the cross-origin case): http://localhost:${port}/`);
  console.log('Press Ctrl+C to stop.');
});
