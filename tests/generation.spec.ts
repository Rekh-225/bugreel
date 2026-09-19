import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateTest, locatorSource } from '../src/lib/generation';
import type { Action } from '../src/lib/session';

const actions: Action[] = [
  { id: '1', type: 'goto', url: 'http://127.0.0.1:3000/demo-store', label: 'Open Demo Store', timestamp: '', elapsedMs: 0 },
  ...['add-to-cart', 'discount-code', 'apply-discount', 'checkout'].map((value, index): Action => ({ id: String(index + 2), type: value === 'discount-code' ? 'fill' : 'click', value: value === 'discount-code' ? 'SAVE20' : undefined, label: value, selector: { kind: 'testId', value, confidence: 'stable' }, timestamp: '', elapsedMs: 0 })),
];
const repeatedActions = [actions[0], actions[1], { ...actions[4], id: 'early-checkout' }, actions[2], { ...actions[4], id: 'unapplied-checkout' }, actions[3], actions[4]];

test('generation preserves actions, escapes values, and asserts the precise failure', () => {
  const source = generateTest({ actions, startUrl: 'http://127.0.0.1:3000/demo-store' });
  expect(source).toContain('page.getByTestId("discount-code").fill("SAVE20")');
  expect(source).toContain('DISCOUNT_CHECKOUT_FAILURE');
  expect(source).toContain('BUGREEL_SIGNATURE_MISMATCH');
  expect(source).not.toContain('waitForTimeout');
  expect(locatorSource({ kind: 'testId', value: 'a"; throw new Error("oops', confidence: 'stable' })).toBe('page.getByTestId("a\\"; throw new Error(\\"oops")');
});

test('missing checkout and external navigation cannot generate a runnable scenario', () => {
  expect(() => generateTest({ actions: actions.slice(0, 2), startUrl: 'http://127.0.0.1:3000/demo-store' })).toThrow('Record a checkout attempt');
  expect(() => generateTest({ actions: [{ ...actions[0], url: 'https://example.com' }, ...actions.slice(1)], startUrl: 'http://127.0.0.1:3000/demo-store' })).toThrow('Only local');
});

for (const sequence of [actions, repeatedActions]) test(`the generated ${sequence.length}-action test is executable by the actual Playwright CLI`, async () => {
  test.setTimeout(70_000);
  const directory = path.resolve('.bugreel', 'generation-verification', crypto.randomUUID());
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'reproduction.spec.ts'), generateTest({ actions: sequence, startUrl: 'http://127.0.0.1:3000/demo-store' }));
  const require = createRequire(path.resolve('package.json'));
  const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', 'playwright.reproduction.config.ts'], {
    env: { ...process.env, BUGREEL_SESSION_DIR: directory, BUGREEL_HEADLESS: '1' }, shell: false,
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exit = await new Promise<number | null>((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
  expect(exit, output).toBe(0);
  const report = JSON.parse(await fs.readFile(path.join(directory, 'standalone-run', 'result.json'), 'utf8'));
  expect(report.stats.expected).toBe(1);
  expect(report.stats.unexpected).toBe(0);
});
