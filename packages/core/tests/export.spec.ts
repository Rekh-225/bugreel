import { test, expect } from '@playwright/test';
import ts from 'typescript';
import { buildRecording, generateMarkdown, generatePlaywright } from '../src/index';
import { at, checkout, event, sampleInput } from './sample';

function syntaxErrors(source: string) {
  const output = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return (output.diagnostics ?? []).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

test('Playwright draft: unverified label, escaped steps, placeholders, and an HTTP failure-signature assertion', () => {
  const source = generatePlaywright(buildRecording(sampleInput()));
  expect(syntaxErrors(source)).toEqual([]);
  expect(source).toContain('STATUS: UNVERIFIED DRAFT. BugReel has not run this test.');
  expect(source).not.toMatch(/reproduction confirmed|bug reproduced|\bverified\b(?! draft)/i);
  expect(source).toContain('test("Checkout fails with a coupon (BugReel unverified draft)"');
  expect(source).toContain('await page.goto("https://shop.example/cart");');
  expect(source).toContain('page.getByRole("textbox", { name: "Coupon code", exact: true }).fill("SAVE20")');
  expect(source).toContain('page.getByLabel("Password", { exact: true }).fill(requiredValue("BUGREEL_VALUE_1"))');
  expect(source).toContain('function requiredValue(name: string): string');
  expect(source).toContain('response.request().method() === "POST" && new URL(response.url()).pathname === "/api/checkout" && response.status() === 500');
  expect(source).toContain('test.use({ viewport: { width: 1280, height: 800 } });');
  expect(source).not.toContain('eval(');
});

test('Playwright draft: no selected evidence produces an action-only draft with an explicit TODO', () => {
  const source = generatePlaywright(buildRecording(sampleInput({ review: { ...sampleInput().review, failureEvidenceId: null, actual: 'Total shows NaN\nafter applying the coupon' } })));
  expect(syntaxErrors(source)).toEqual([]);
  expect(source).toContain('// TODO: no assertion was generated.');
  expect(source).toContain('// Actual behaviour reported: Total shows NaN after applying the coupon');
  expect(source).not.toContain('expect(');
});

test('Playwright draft: console and transport signatures, gaps, and unsupported steps', () => {
  const input = sampleInput({
    network: [{ id: 'net-2', kind: 'transport', method: 'GET', url: 'https://shop.example/api/stock?sku=1', error: 'net::ERR_EMPTY_RESPONSE', timestamp: at(4000), elapsedMs: 4000 }],
    gaps: [{ id: 'gap-1', reason: 'paused', startedAt: at(2500), endedAt: at(3000), startElapsedMs: 2500, endElapsedMs: 3000 }],
    unsupported: [{ id: 'uns-1', reason: 'file-input', description: 'File selection in input "Attachment" cannot be recorded', timestamp: at(3500), elapsedMs: 3500 }],
  });
  const transport = generatePlaywright(buildRecording({ ...input, review: { ...input.review, includedEvidenceIds: ['net-2'], failureEvidenceId: 'net-2' } }));
  expect(syntaxErrors(transport)).toEqual([]);
  expect(transport).toContain("page.on('requestfailed'");
  expect(transport).toContain('request.method === "GET" && new URL(request.url).pathname === "/api/stock"');
  expect(transport).toContain('test.fixme(true, "BugReel: this recording has gaps.');
  expect(transport.indexOf('RECORDING GAP 1')).toBeLessThan(transport.indexOf('UNSUPPORTED STEP'));
  expect(transport.indexOf('UNSUPPORTED STEP')).toBeLessThan(transport.indexOf('Click Checkout'));

  const consoleDraft = generatePlaywright(buildRecording({ ...input, gaps: [], review: { ...input.review, failureEvidenceId: 'con-1' } }));
  expect(consoleDraft).toContain('consoleErrors.some(text => text.includes("Checkout failed: ORDER_SUBMISSION_FAILED for"))');
});

test('hostile page-derived values cannot break out of generated source or Markdown', () => {
  const hostile = 'x"); require("child_process").exec("calc"); ("\n// \u2028*/`${1}`';
  const input = sampleInput({
    events: [
      event('navigation', 0, { url: 'https://shop.example/cart?q=%22%29%3B' }),
      event('click', 100, { selector: { ...checkout, value: hostile }, element: { tag: 'button', text: hostile } }),
      event('input', 200, { selector: { kind: 'css', value: `[name="${hostile}"]`, confidence: 'fallback' }, value: hostile }),
    ],
    review: { ...sampleInput().review, title: hostile, actual: hostile, expected: `![img](https://evil.example/x.png) <script>alert(1)</script>`, failureEvidenceId: null },
  });
  const recording = buildRecording(input);
  const source = generatePlaywright(recording);
  expect(syntaxErrors(source)).toEqual([]);
  expect(source).not.toMatch(/[\u2028\u2029]/);
  // The hostile text may appear inside comments and string literals, but must never become code: no call
  // expression in the parsed draft may reference it.
  const file = ts.createSourceFile('draft.ts', source, ts.ScriptTarget.ES2022, true);
  const identifiers = new Set<string>();
  const visit = (node: ts.Node) => { if (ts.isIdentifier(node)) identifiers.add(node.text); ts.forEachChild(node, visit); };
  visit(file);
  expect(identifiers.has('require')).toBe(false);
  expect(identifiers.has('exec')).toBe(false);

  const markdown = generateMarkdown(recording);
  expect(markdown).not.toMatch(/!\[img\]\(|<script>/);
  expect(markdown).toContain('&lt;script&gt;');
});

test('Markdown report: unverified banner, evidence, steps, configuration, and screenshot disclosure', () => {
  const markdown = generateMarkdown(buildRecording(sampleInput({
    screenshot: { fileName: 'bugreel-11111111-screenshot.png', mimeType: 'image/png', width: 800, height: 600, byteLength: 1234, capturedAt: at(5000), pixelsRedacted: false },
  })));
  expect(markdown).toMatch(/^# Checkout fails with a coupon/);
  expect(markdown).toContain('**Unverified BugReel recording.**');
  expect(markdown).toContain('| **Failure signature** | POST | `https://shop.example/api/checkout` | HTTP 500 Internal Server Error |');
  expect(markdown).toContain('1. Open /cart');
  expect(markdown).toContain('value placeholder `BUGREEL_VALUE_1`');
  expect(markdown).toContain('Screenshot pixels are not redacted.');
  expect(markdown).toContain('## Required configuration');
  expect(markdown).not.toMatch(/reproduction confirmed|bug reproduced/i);
});
