import { test, expect } from '@playwright/test';

test('landing communicates the workflow and has no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Reproduce it once. Never explain it again.' })).toBeVisible();
  await expect(page.getByTestId('start-recording')).toBeEnabled();
  await expect(page.locator('.workflow-stages')).toContainText('CAPTURE');
  await expect(page.locator('.workflow-stages')).toContainText('EVIDENCE');
  await expect(page.locator('.workflow-stages')).toContainText('REPRODUCE');
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await expect(page.locator('.hero')).toHaveScreenshot('landing-hero.png', { animations: 'disabled' });
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Demo Store has a clear visible failure and fits mobile', async ({ page }) => {
  await page.goto('/demo-store');
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('discount-code').fill('SAVE20');
  await page.getByTestId('apply-discount').click();
  await page.getByTestId('checkout').click();
  await expect(page.getByTestId('checkout-error')).toBeVisible();
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.mouse.move(0, 0);
  await expect(page.locator('.store-grid')).toHaveScreenshot('demo-failure.png', { animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByTestId('checkout-error')).toBeVisible();
});
