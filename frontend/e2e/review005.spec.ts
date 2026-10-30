import { test, expect } from '@playwright/test';

for (const fault of ['orders-missing', 'zero-denominator', 'orders-not-array', 'fraction-missing-field', 'invalid-frame', 'invalid-state', 'invalid-evidence', 'invalid-availability']) {
  test(`review005 rejects ${fault}, stays visible and can retry`, async ({ page }) => {
    let invalid = true;
    await page.route(`**/api/v1/${fault.startsWith('orders-') ? 'orders' : 'replay'}`, async route => {
      const actual = await route.fetch(), body = await actual.json();
      if (invalid) {
        if (fault === 'orders-missing') delete body.orders;
        else if (fault === 'orders-not-array') body.orders = {};
        else if (fault === 'invalid-frame') delete body.frames[0].overview;
        else {
          const order = body.frames.at(-1).orders.find((candidate: { order_id: string }) => candidate.order_id === 'ord-1002');
          if (fault === 'zero-denominator') order.metrics.delivery_delay.value.denominator = '0';
          if (fault === 'fraction-missing-field') delete order.metrics.delivery_delay.value.numerator;
          if (fault === 'invalid-state') order.status = 'UNDECLARED';
          if (fault === 'invalid-evidence') order.metrics.delivery_delay.sources[0].origins = null;
          if (fault === 'invalid-availability') order.metrics.delivery_delay.available = false;
        }
      }
      await route.fulfill({ response: actual, json: body });
    });
    await page.goto('/?view=2d');
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible({ timeout: 2500 });
    await expect(page.getByRole('link', { name: 'RescueOS início' })).toBeVisible();
    invalid = false;
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByTestId('selected-order')).toHaveText('ord-1002');
    await expect(page.getByTestId('metric-delivery_delay')).toContainText('13 min');
  });
}

test('review005 failed lazy import keeps HTML, evidence and working 2D replay', async ({ page }) => {
  await page.route('**/src/scene/RestaurantScene.tsx*', route => route.abort('connectionfailed'));
  await page.goto('/');
  await expect(page.getByTestId('fallback-world')).toBeVisible({ timeout: 2500 });
  await expect(page.getByTestId('kpi-total_created').locator('strong')).toHaveText('3');
  await page.getByRole('navigation', { name: 'Selecionar pedido', exact: true }).getByRole('button', { name: 'ord-1001' }).click();
  await expect(page.getByTestId('selected-order')).toHaveText('ord-1001');
  await page.getByRole('button', { name: 'Abrir evidências' }).click();
  await expect(page.getByTestId('evidence-panel')).toContainText('evt-019');
  await page.getByRole('button', { name: 'Reiniciar replay' }).click();
  await expect(page.getByRole('slider')).toHaveValue('0');
  await page.getByRole('button', { name: 'Próximo evento' }).click();
  await expect(page.getByRole('slider')).toHaveValue('1');
  await page.unroute('**/src/scene/RestaurantScene.tsx*');
  await page.getByRole('button', { name: 'Recarregar cena 3D' }).click();
  await expect(page.locator('canvas')).toBeVisible();
});

test('review005 rendering failure inside 3D preserves HTML and the current snapshot', async ({ page }) => {
  await page.route('**/src/scene/RestaurantScene.tsx*', route => route.fulfill({ contentType: 'application/javascript',
    body: 'export default function Scene(){throw new Error("forced scene render failure")}' }));
  await page.goto('/');
  await expect(page.getByTestId('fallback-world')).toBeVisible();
  await expect(page.getByRole('link', { name: 'RescueOS início' })).toBeVisible();
  await expect(page.getByTestId('metric-delivery_delay')).toContainText('13 min');
  await page.getByRole('button', { name: 'Abrir evidências' }).click();
  await expect(page.getByTestId('evidence-panel')).toContainText('evt-020');
  await page.getByRole('slider').fill('15');
  await expect(page.getByTestId('metric-delivery_delay')).toContainText('Indisponível');
  await page.screenshot({ path: '../out/review005-scene-fallback.png', fullPage: true });
});

test('review005 unexpected HTML rendering error is contained and retry remounts the UI', async ({ page }) => {
  await page.route('**/src/components/OrderDetails.tsx*', route => route.fulfill({ contentType: 'application/javascript',
    body: 'export default function Details(){if(!window.__reviewAllowRender)throw new Error("forced HTML failure");return "render recuperado";}' }));
  await page.goto('/?view=2d');
  await expect(page.getByRole('heading', { name: 'Não foi possível exibir o cenário' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'RescueOS início' })).toBeVisible();
  await page.evaluate(() => { Reflect.set(window, '__reviewAllowRender', true); });
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByTestId('kpi-total_created').locator('strong')).toHaveText('3');
  await expect(page.getByRole('complementary', { name: 'Pedidos e evidências' })).toContainText('render recuperado');
});

test('review005 individual client uses the query route against the real API', async ({ page }) => {
  await page.goto('/?view=2d');
  await expect(page.getByTestId('selected-order')).toBeVisible();
  const result = await page.evaluate(async () => {
    const path = '/src/api/client.ts';
    const client = await import(path);
    return client.loadOrder('ord-1002');
  });
  expect(result.order.order_id).toBe('ord-1002');
  expect(result.order.metrics.delivery_delay.value).toEqual({ numerator: '13', denominator: '1' });
});

test('review005 overview restores orbit, zoom and repeated reset after replay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const canvas = page.locator('canvas'); await expect(canvas).toBeVisible();
  await page.waitForTimeout(450);
  const original = await canvas.screenshot(), bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 140, bounds.y + bounds.height / 2 + 35, { steps: 15 });
  await page.mouse.up(); await page.mouse.wheel(0, 200); await page.waitForTimeout(200);
  expect(original.equals(await canvas.screenshot())).toBe(false);
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.waitForTimeout(350);
  expect(original.equals(await canvas.screenshot())).toBe(true);
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.waitForTimeout(150);
  expect(original.equals(await canvas.screenshot())).toBe(true);
  await page.getByRole('button', { name: 'Cozinha', exact: true }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.waitForTimeout(200);
  expect(original.equals(await canvas.screenshot())).toBe(true);
  await page.getByRole('slider').fill('15');
  await page.getByRole('slider').fill('20');
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.waitForTimeout(200);
  expect(original.equals(await canvas.screenshot())).toBe(true);
});
