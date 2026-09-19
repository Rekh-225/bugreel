import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/demo-store'); });

test('normal checkout succeeds', async ({ page }) => {
  await page.getByTestId('add-to-cart').click();
  const response = page.waitForResponse(r => r.url().endsWith('/api/demo/checkout'));
  await page.getByTestId('checkout').click();
  expect((await response).status()).toBe(200);
  await expect(page.getByTestId('checkout-success')).toBeVisible();
  await expect(page.getByTestId('checkout-error')).toHaveCount(0);
});

test('applied SAVE20 produces real network, console, and visible failure', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('discount-code').fill('SAVE20');
  await page.getByTestId('apply-discount').click();
  await expect(page.getByTestId('discount-applied')).toBeVisible();
  const response = page.waitForResponse(r => r.url().endsWith('/api/demo/checkout'));
  await page.getByTestId('checkout').click();
  const result = await response;
  expect(result.status()).toBe(500);
  expect((await result.json()).code).toBe('DISCOUNT_CHECKOUT_FAILURE');
  await expect(page.getByTestId('checkout-error')).toContainText('Checkout failed after applying SAVE20.');
  expect(errors.some(error => error.includes('DISCOUNT_CHECKOUT_FAILURE'))).toBe(true);
});

test('typing SAVE20 without applying does not trigger the bug', async ({ page }) => {
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('discount-code').fill('SAVE20');
  await page.getByTestId('checkout').click();
  await expect(page.getByTestId('checkout-success')).toBeVisible();
});

test('invalid discount does not trigger the bug', async ({ page }) => {
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('discount-code').fill('INVALID');
  await page.getByTestId('apply-discount').click();
  await expect(page.getByTestId('discount-message')).toContainText('not recognized');
  await page.getByTestId('checkout').click();
  await expect(page.getByTestId('checkout-success')).toBeVisible();
});
