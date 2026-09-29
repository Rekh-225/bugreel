import { test, expect } from '@playwright/test';
import { looksSecret, redactText, sanitizeUrl } from '../src/index';

test('URL credentials and sensitive query values are redacted while ordinary parameters are kept', () => {
  expect(sanitizeUrl('https://user:pass@shop.example/cart?page=2&q=shoes&token=abc123&session_id=xyz').url)
    .toBe('https://shop.example/cart?page=2&q=shoes&token=REDACTED&session_id=REDACTED');
  expect(sanitizeUrl('https://shop.example/cart?page=2').redacted).toBe(false);
});

test('secret-looking values are redacted regardless of the parameter name', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVl';
  const result = sanitizeUrl(`https://shop.example/a?x=${jwt}&y=alice%40example.com&z=4111111111111111&w=Ab3dEf7hIj0lMn4pQr8tUv2x`);
  expect(result.url).toBe('https://shop.example/a?x=REDACTED&y=REDACTED&z=REDACTED&w=REDACTED');
  expect(looksSecret('hello')).toBe(false);
  expect(looksSecret('123e4567-e89b-42d3-a456-426614174000')).toBe(false);
});

test('fragments: OAuth-style parameters and opaque tokens are redacted, SPA routes are preserved', () => {
  expect(sanitizeUrl('https://app.example/callback#access_token=abc&state=xyz&view=list').url).toBe('https://app.example/callback#access_token=REDACTED&state=REDACTED&view=list');
  expect(sanitizeUrl('https://app.example/#/orders/42?tab=items').url).toBe('https://app.example/#/orders/42?tab=items');
  expect(sanitizeUrl('https://app.example/#section-2').url).toBe('https://app.example/#section-2');
  expect(sanitizeUrl('https://app.example/#Zk9x2mQ7rT4vW8yB1nC5dF3gH6jK0lP').url).toBe('https://app.example/#REDACTED');
});

test('token-like path segments are redacted; UUIDs and asset file names are not', () => {
  expect(sanitizeUrl('https://app.example/reset/Zk9x2mQ7rT4vW8yB1nC5dF3gH6jK0lPq/confirm').url).toBe('https://app.example/reset/REDACTED/confirm');
  expect(sanitizeUrl('https://app.example/orders/123e4567-e89b-42d3-a456-426614174000').redacted).toBe(false);
  expect(sanitizeUrl('https://app.example/static/page-4f9a2b1c3d4e5f6a7b8c9d0e1f2a3b4c.js').redacted).toBe(false);
});

test('non-web and malformed URLs are omitted entirely', () => {
  expect(sanitizeUrl('data:text/html,<script>alert(1)</script>').url).toBe('data:[omitted]');
  expect(sanitizeUrl('not a url').url).toBe('[invalid URL omitted]');
});

test('diagnostic text redaction covers tokens, key-value secrets, emails, card numbers, and embedded URLs', () => {
  const text = redactText('Failed for alice@example.com: Authorization: Bearer abcdefghijklmnop password=hunter2 card 4111 1111 1111 1111 at https://api.example/v1?api_key=XYZ123 token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig');
  expect(text).not.toMatch(/alice@example\.com|abcdefghijklmnop|hunter2|4111 1111|XYZ123|eyJhbGci/);
  expect(text).toContain('[REDACTED:email]');
  expect(text).toContain('https://api.example/v1?api_key=REDACTED');
  expect(redactText('Checkout failed: ORDER_SUBMISSION_FAILED')).toBe('Checkout failed: ORDER_SUBMISSION_FAILED');
});

test('redacted text is bounded and control characters are removed', () => {
  expect(redactText('x'.repeat(5000), 100)).toHaveLength(100);
  expect(redactText('a\u0000b\u001bc')).toBe('a b c');
});
