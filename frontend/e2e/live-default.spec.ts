import { test, expect } from '@playwright/test';

test('home opens live simulation without a visible history option or a backend dependency', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Começar simulação/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Modo do restaurante' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Histórico', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'API offline' })).toHaveCount(0);
});
