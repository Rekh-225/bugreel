import { test, expect } from '@playwright/test';
import { comment, cssEscape, cssString, literal, locatorSource, mdCode, mdText } from '../src/index';

const hostile = 'a"; process.exit(1); //\u2028`${x}`\u202e</script>\\';

test('string literals round-trip untrusted text and escape line separators and bidi controls', () => {
  const source = literal(hostile);
  expect(source).not.toMatch(/[\u2028\u2029\u202e]/);
  expect(source).toContain('\\u202e');
  expect(new Function(`return ${source};`)()).toBe(hostile);
});

test('comments cannot be terminated by embedded line breaks', () => {
  const lines = comment('first\nsecond\r\nthird\u2028fourth\u2029fifth').split('\n');
  expect(lines).toEqual(['// first', '// second', '// third', '// fourth', '// fifth']);
  expect(comment('evil */ \u202e')).toBe('// evil */');
});

test('locator source escapes every selector kind', () => {
  const role = locatorSource({ kind: 'role', role: 'button', value: hostile, confidence: 'stable' }, literal);
  expect(role.startsWith('page.getByRole("button", { name: ')).toBe(true);
  expect(new Function('page', `return ${role};`)({ getByRole: (_role: string, options: { name: string }) => options.name })).toBe(hostile);
  for (const kind of ['testId', 'label', 'placeholder', 'text', 'css'] as const) {
    const source = locatorSource({ kind, value: hostile, confidence: 'stable' }, literal);
    const page = new Proxy({}, { get: () => (value: string) => value });
    expect(new Function('page', `return ${source};`)(page)).toBe(hostile);
  }
});

test('CSS escaping matches the browser CSS.escape implementation', async ({ page }) => {
  const samples = ['plain', '1leading-digit', '-1dash-digit', '-', 'with space', 'quote"s', 'back\\slash', 'colon:and.dot', 'new\nline', '\u0000nul', 'ünïcode', '#hash[attr]'];
  const browser = await page.evaluate(values => values.map(value => CSS.escape(value)), samples);
  expect(samples.map(cssEscape)).toEqual(browser);
  await page.setContent('<div></div>');
  // NUL cannot be matched by any CSS selector (the parser replaces it with U+FFFD), so it is excluded here.
  for (const value of samples.filter(sample => !sample.includes('\u0000'))) {
    const matched = await page.evaluate(({ value, selector }) => { const div = document.querySelector('div')!; div.setAttribute('data-x', value); return div.matches(selector); }, { value, selector: `[data-x=${cssString(value)}]` });
    expect(matched, value).toBe(true);
  }
});

test('Markdown escaping neutralizes links, images, HTML, and code fences', () => {
  const text = mdText('![x](https://evil.example/t.png) <img src=x onerror=alert(1)> [link](javascript:alert(1)) # heading');
  expect(text).not.toMatch(/!\[|\]\(|<img|javascript:/);
  expect(mdText('1. not a list')).toBe('1\\. not a list');
  expect(mdCode('a `tick` b')).toBe('``a `tick` b``');
});
