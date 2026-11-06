import { test, expect } from '@playwright/test';

test('leigo consegue entender as três etapas e consultar o cozinheiro sem IA', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/');
  const legend = page.locator('.live-visual-legend[aria-label="Como reconhecer os pedidos"]');
  await expect(legend.getByText(/Comandas: aguardando/)).toBeVisible();
  await expect(legend.getByText(/Panelas: preparando/)).toBeVisible();
  await expect(legend.getByText(/Sacolas: prontas/)).toBeVisible();

  await page.getByRole('button', { name: /Cozinheiro.*Aguardando pedidos/ }).click();
  const detail = page.locator('.live-worker-detail');
  await expect(detail.getByRole('heading', { name: 'Cozinheiro' })).toBeVisible();
  await expect(detail.getByText('Aguardando pedidos')).toBeVisible();
  await expect(detail.getByText(/sem agente de IA/)).toBeVisible();

  await page.getByRole('button', { name: /Usar vista 2D/ }).click();
  await page.getByRole('button', { name: /Começar simulação/ }).click();
  await expect(page.getByText(/Comandas: aguardando/)).toBeVisible();
  await expect(page.locator('.live-worker-detail').getByText(/Preparando.*pedido/)).toBeVisible({ timeout: 18000 });
});
