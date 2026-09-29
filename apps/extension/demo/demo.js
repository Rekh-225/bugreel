// Synthetic demo behaviour. Every failure is deliberate and self-contained.
const result = document.getElementById('result');
const other = `http://${location.hostname === 'localhost' ? '127.0.0.1' : 'localhost'}:${location.port}`;
document.getElementById('cross').href = `${other}/second.html`;

document.getElementById('checkout').addEventListener('click', async () => {
  const response = await fetch('/api/checkout', { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  console.error(`${body.code || 'CHECKOUT_FAILED'}: ${body.message || 'Checkout failed.'} (demo-user@example.test)`);
  result.textContent = `Checkout failed (HTTP ${response.status})`;
});
document.getElementById('assert').addEventListener('click', () => {
  console.assert(false, 'Cart total must stay positive after applying a coupon');
  result.textContent = 'Assertion failed (see console)';
});
document.getElementById('throw').addEventListener('click', () => {
  setTimeout(() => { throw new Error('Demo exception while rendering the cart'); }, 0);
  result.textContent = 'Exception thrown';
});
document.getElementById('missing').addEventListener('click', async () => {
  const response = await fetch('/api/missing');
  result.textContent = `Missing resource returned HTTP ${response.status}`;
});
document.getElementById('reset').addEventListener('click', async () => {
  await fetch('/api/reset').catch(() => {});
  result.textContent = 'Connection failed';
});
document.getElementById('spa').addEventListener('click', () => {
  history.pushState({}, '', '/app/settings');
  result.textContent = 'Settings view';
});
if (location.pathname === '/app/settings') result.textContent = 'Settings view';
