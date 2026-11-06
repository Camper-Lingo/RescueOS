import { expect, test } from '@playwright/test';

test('the night can end, be reviewed without restarting, and start fresh', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/');

  const endDay = page.getByRole('button', { name: '🌙 Encerrar dia' });
  await expect(endDay).toBeDisabled();
  await page.getByRole('button', { name: /Começar simulação/ }).click();
  await page.clock.fastForward(10_000);
  await expect(page.getByText('sim-001').first()).toBeVisible();
  await expect(endDay).toBeEnabled();
  await endDay.click();

  await expect(page.getByRole('heading', { name: /Resumo da noite/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Resultados da noite' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Resultados da noite' }).getByText('Pedidos que chegaram', { exact: true })).toBeVisible();
  await expect(page.getByText(/Ainda em andamento/)).toBeVisible();
  await expect(page.getByText(/Nenhum agente de IA foi executado/)).toBeVisible();

  await page.getByRole('button', { name: /Rever restaurante/ }).first().click();
  await expect(page.getByRole('button', { name: 'Noite encerrada' })).toBeDisabled();
  const minute = await page.locator('.live-time').innerText();
  await page.clock.fastForward(1200);
  await expect(page.locator('.live-time')).toHaveText(minute);
  await page.getByRole('button', { name: /Ver resumo do dia/ }).click();
  await expect(page.getByRole('heading', { name: /Resumo da noite/ })).toBeVisible();
  await page.getByRole('button', { name: /Jogar outra noite/ }).first().click();
  await expect(page.getByText(/Minuto simulado: 0 \/ 60/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Começar simulação/ })).toBeEnabled();
});


test('at 60 simulated minutes the night closes itself and keeps pending orders visible', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Intensidade da noite' }).selectOption('busy');
  await page.getByRole('combobox', { name: /Velocidade/ }).selectOption('4');
  await page.getByRole('button', { name: /Começar simulação/ }).click();
  await page.clock.fastForward(149_000);
  await expect(page.getByText(/Minuto simulado: 59 \/ 60/)).toBeVisible();
  await page.clock.fastForward(1_000);
  await expect(page.getByRole('heading', { name: /Resumo da noite/ })).toBeVisible();
  await expect(page.getByText(/Fim automático/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Resultados da noite' })).toBeVisible();
  await page.getByRole('button', { name: /Rever restaurante/ }).first().click();
  await expect(page.getByRole('button', { name: 'Noite encerrada' })).toBeDisabled();
  await expect(page.getByText(/Minuto simulado: 60 \/ 60/)).toBeVisible();
  await page.clock.fastForward(10_000);
  await expect(page.getByText(/Minuto simulado: 60 \/ 60/)).toBeVisible();
});
