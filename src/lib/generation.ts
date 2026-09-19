import { createHash } from 'node:crypto';
import { CHECKOUT_PATH, FAILURE_CODE, FAILURE_MESSAGE } from './demo';
import type { Action, Selector, Session } from './session';

const quote = (value: string) => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export const sourceHash = (source: string) => createHash('sha256').update(source).digest('hex');

export function locatorSource(selector: Selector) {
  switch (selector.kind) {
    case 'testId': return `page.getByTestId(${quote(selector.value)})`;
    case 'id': return `page.locator(${quote(`[id=${JSON.stringify(selector.value)}]`)})`;
    case 'label': return `page.getByLabel(${quote(selector.value)}, { exact: true })`;
    case 'placeholder': return `page.getByPlaceholder(${quote(selector.value)}, { exact: true })`;
    case 'text': return `page.getByText(${quote(selector.value)}, { exact: true })`;
    case 'css': return `page.locator(${quote(selector.value)})`;
    default: throw new Error('Unsupported selector.');
  }
}

function actionSource(action: Action, origin: string) {
  if (action.type === 'goto' || action.type === 'waitForURL') {
    if (!action.url || new URL(action.url).origin !== origin) throw new Error('Only local Demo Store navigation can be generated.');
    return action.type === 'goto' ? `await page.goto(${quote(action.url)});` : `await expect(page).toHaveURL(${quote(action.url)});`;
  }
  if (!action.selector) throw new Error('A recorded action has no reliable selector.');
  const locator = locatorSource(action.selector);
  if (action.type === 'fill') return `await ${locator}.fill(${quote(action.value || '')});`;
  if (action.type === 'press') return `await ${locator}.press(${quote(action.value || 'Enter')});`;
  return `await ${locator}.click();`;
}

export function generateTest(session: Pick<Session, 'actions' | 'startUrl'>) {
  const origin = new URL(session.startUrl).origin;
  const checkouts = session.actions.filter(action => action.type === 'click' && action.selector?.kind === 'testId' && action.selector.value === 'checkout');
  if (checkouts.length !== 1) throw new Error('Record exactly one checkout attempt to generate a reproduction test.');
  if (session.actions[0]?.type !== 'goto') throw new Error('The recording is missing its initial navigation.');
  const steps = session.actions.map((action, index) => {
    const source = actionSource(action, origin);
    const checkout = action.id === checkouts[0].id;
    const body = checkout ? `const [response] = await Promise.all([\n        page.waitForResponse(response => new URL(response.url()).pathname === ${quote(CHECKOUT_PATH)} && response.request().method() === 'POST'),\n        ${source.replace(/^await /, '').replace(/;$/, '')},\n      ]);\n      const body = await response.json().catch(() => null);\n      observed = { status: response.status(), code: body?.code ?? null };` : source;
    return `    await test.step(${quote(`${index + 1}. ${action.label}`)}, async () => {\n      ${body}\n    });`;
  }).join('\n');
  return `import { test, expect } from '@playwright/test';

test('reproduces DISCOUNT_CHECKOUT_FAILURE from recorded actions', async ({ page }, testInfo) => {
  let observed: { status: number; code: string | null } | undefined;
  try {
${steps}
    await test.step('Verify the captured failure signature', async () => {
      await expect(page.locator('main')).toHaveAttribute('data-checkout-state', /^(success|error)$/);
      const error = page.getByTestId('checkout-error');
      const visible = await error.isVisible();
      const message = visible ? await error.innerText() : '';
      const matches = observed?.status === 500 && observed?.code === ${quote(FAILURE_CODE)} && visible && message.includes(${quote(FAILURE_MESSAGE)});
      await testInfo.attach('bugreel-evidence', {
        body: Buffer.from(JSON.stringify({ completed: true, matches, observed, visible, expectedCode: ${quote(FAILURE_CODE)} })),
        contentType: 'application/json',
      });
      expect(matches, 'BUGREEL_SIGNATURE_MISMATCH').toBe(true);
    });
  } finally {
    if (!page.isClosed()) {
      const screenshot = testInfo.outputPath('replay.png');
      await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
      await testInfo.attach('replay-screenshot', { path: screenshot, contentType: 'image/png' });
    }
  }
});
`;
}

export function generateReport(session: Session) {
  return session.failure ? {
    title: 'Checkout fails after applying SAVE20',
    expected: 'An applied discount should reduce the total without preventing checkout.',
    actual: `${session.failure.method} ${session.failure.pathname} returned ${session.failure.status} (${session.failure.code}). ${session.failure.visible ? 'The checkout failure was also visible in the browser.' : 'The failure response was captured.'}`,
  } : {
    title: 'Demo Store checkout session',
    expected: 'Checkout should complete successfully.',
    actual: 'The target checkout failure was not observed in this recording. Replay checks whether this scenario triggers DISCOUNT_CHECKOUT_FAILURE.',
  };
}
