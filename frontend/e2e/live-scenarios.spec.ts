import { expect, test } from '@playwright/test';

test('busy night has a real scripted kitchen fault and the Fixer explains the repair', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Intensidade da noite' }).selectOption('busy');
  await page.getByRole('combobox', { name: /Velocidade/ }).selectOption('4');
  await page.getByRole('button', { name: /Começar simulação/ }).click();
  // 15 real seconds at 4× = 6 simulated minutes; virtual clock avoids waiting.
  await page.clock.fastForward(15_000);
  await expect(page.getByText(/Cozinha parada · Fixer está consertando/)).toBeVisible();
  await page.getByRole('button', { name: /Pausar/ }).click();
  await page.getByRole('button', { name: 'Ver Fixer trabalhando' }).click();
  await expect(page.getByText(/Meu reparo por regras terminará/)).toBeVisible();
});

test('switching night scenario resets synthetic orders and stops running state', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: /Começar simulação/ }).click();
  await page.clock.fastForward(10_000);
  await expect(page.getByText('sim-001').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Intensidade da noite' }).selectOption('quiet');
  await expect(page.getByRole('button', { name: /Começar simulação/ })).toBeVisible();
  await expect(page.getByText(/Minuto simulado: 0 \/ 60/)).toBeVisible();
  await expect(page.getByText('sim-001')).toHaveCount(0);
});
