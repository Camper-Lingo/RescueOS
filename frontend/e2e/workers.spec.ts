import { expect, test } from '@playwright/test';

test('crew explains simulated work without depending on Ollama or backend', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Começar simulação/ })).toBeVisible();
  const coordinator = page.getByRole('button', { name: /COORDINATOR/ });
  await expect(coordinator).toContainText('Em espera');
  await page.getByRole('button', { name: /Começar simulação/ }).click();
  await page.clock.fastForward(10_000);
  await expect(coordinator).toContainText('Em atividade', { timeout: 10000 });
  await coordinator.click();
  await expect(page.getByText('Conheça seu ajudante')).toBeVisible();
  await expect(page.getByText(/pedidos ocupam as bancadas|pedidos aguardam a cozinha|novos pedidos à fila/)).toBeVisible();
  await page.getByRole('button', { name: /Pausar/ }).click();
  await expect(coordinator).toContainText('Em espera');
});
