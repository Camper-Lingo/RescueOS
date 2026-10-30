import { test, expect } from '@playwright/test';
import { OrthographicCamera, Vector3 } from 'three';
import type { Bundle } from '../src/types/api.ts';

test('real API, 3D restaurant, orders, exact metrics, evidence and original crew', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByTestId('selected-order')).toHaveText('ord-1002');
  for (const [key, value] of [['total_created', '3'], ['total_delivered', '2'], ['total_cancelled', '1'], ['delay_rate', '1/2']]) {
    await expect(page.getByTestId(`kpi-${key}`).locator('strong')).toHaveText(value);
  }
  for (const [key, value] of [['delivery_delay', '13 min'], ['kitchen_delay', '11 min'], ['courier_waiting_time', '13 min']]) {
    await expect(page.getByTestId(`metric-${key}`).locator('strong')).toHaveText(value);
  }
  await expect(page.locator('canvas')).toBeVisible();
  const bounds = (await page.locator('canvas').boundingBox())!;
  const camera = new OrthographicCamera(-bounds.width / 2, bounds.width / 2, bounds.height / 2, -bounds.height / 2, .1, 100);
  camera.position.set(10, 11, 12); camera.lookAt(0, 0, 0);
  camera.zoom = Math.min(bounds.width / 14.2, bounds.height / 10.3); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const parcel = new Vector3(-3.15, .87, 2.85).project(camera);
  await page.locator('canvas').click({ position: { x: (parcel.x + 1) * bounds.width / 2, y: (1 - parcel.y) * bounds.height / 2 } });
  await expect(page.getByTestId('selected-order')).toHaveText('ord-1003');
  await page.getByRole('navigation', { name: 'Selecionar pedido', exact: true }).getByRole('button', { name: 'ord-1002' }).click();
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  // Dois renders reais diferentes comprovam movimento; nenhuma meta de FPS é inferida.
  const first = await page.locator('canvas').screenshot();
  await page.waitForTimeout(650);
  const second = await page.locator('canvas').screenshot();
  expect(first.equals(second)).toBe(false);
  await page.getByRole('button', { name: 'Abrir evidências' }).click();
  const evidence = page.getByTestId('evidence-panel');
  await expect(evidence).toContainText('evt-015');
  await expect(evidence).toContainText('evt-018');
  await expect(evidence).toContainText('demo_events.jsonl:15');
  await expect(evidence).toContainText('2026-10-29T18:22:00-03:00');
  for (const id of ['ord-1001', 'ord-1003', 'ord-1002']) {
    await page.getByRole('navigation', { name: 'Selecionar pedido', exact: true }).getByRole('button', { name: id }).click();
    await expect(page.getByTestId('selected-order')).toHaveText(id);
    if (id === 'ord-1003') await expect(page.getByTestId('metric-delivery_delay')).toContainText('Indisponível');
  }
  await page.getByRole('button', { name: /TRACE.*Evidências/ }).click();
  await expect(page.getByRole('status')).toContainText('Não há investigação autônoma');
  await page.getByRole('button', { name: 'Fechar papel do mascote' }).click();
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.getByLabel('Reduzir movimento').check();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../out/tower-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Abrir evidências' }).click();
  await page.screenshot({ path: '../out/tower-evidence.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(350);
  await page.screenshot({ path: '../out/tower-mobile-3d.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('backward seek, event mapping, play/pause, speed and complete replay', async ({ page, request }) => {
  const replay = await (await request.get('/api/v1/replay')).json() as Bundle['replay'];
  await page.goto('/?view=2d');
  await expect(page.getByTestId('selected-order')).toBeVisible();
  await page.getByRole('button', { name: 'Reiniciar replay' }).click();
  await expect(page.getByRole('heading', { name: 'Ainda não criado' })).toBeVisible();
  await expect(page.getByTestId('kpi-total_created').locator('strong')).toHaveText('0');
  await page.getByRole('button', { name: 'Próximo evento' }).click();
  await expect(page.getByTestId('frame-index')).toContainText('1 / 20');
  await page.getByRole('button', { name: 'Evento anterior' }).click();
  await expect(page.getByTestId('frame-index')).toContainText('0 / 20');
  const slider = page.getByRole('slider', { name: 'Posição na timeline' });
  for (const [id, state, wait] of [['evt-015', 'Em preparo', 'Indisponível'], ['evt-017', 'Pronto', 'Indisponível'], ['evt-018', 'Coletado', '13 min']]) {
    const index = replay.events.findIndex(event => event.event_id === id) + 1;
    await slider.fill(String(index));
    await expect(page.locator('.order-status')).toContainText(state);
    await expect(page.getByTestId('metric-courier_waiting_time').locator('strong')).toHaveText(wait);
  }
  await slider.fill('0');
  await page.getByRole('combobox', { name: 'Velocidade do replay' }).selectOption('4');
  await page.getByRole('button', { name: 'Reproduzir replay' }).click();
  await expect(page.getByTestId('frame-index')).not.toContainText('0 / 20');
  await page.getByRole('button', { name: 'Pausar replay' }).click();
  const paused = await slider.inputValue();
  await page.waitForTimeout(250);
  expect(await slider.inputValue()).toBe(paused);
  await page.getByRole('button', { name: 'Reproduzir replay' }).click();
  await expect(page.getByTestId('frame-index')).toContainText('20 / 20', { timeout: 20_000 });
  await expect(page.getByTestId('metric-delivery_delay').locator('strong')).toHaveText('13 min');
  await slider.fill(String(replay.events.findIndex(event => event.event_id === 'evt-015') + 1));
  await expect(page.getByTestId('metric-delivery_delay')).toContainText('Indisponível');
  await expect(page.locator('.order-status')).toContainText('Em preparo');
});

test('WebGL unavailable keeps accessible orders, metrics and timeline', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (String(args[0]).includes('webgl')) return null;
      return Reflect.apply(original, this, args);
    } as typeof original;
  });
  await page.goto('/');
  await expect(page.getByTestId('fallback-world')).toContainText('WebGL indisponível');
  await expect(page.getByTestId('metric-delivery_delay')).toContainText('13 min');
  await page.getByRole('navigation', { name: 'Selecionar pedido', exact: true }).getByRole('button', { name: 'ord-1001' }).click();
  await expect(page.getByTestId('metric-delivery_earliness')).toContainText('5 min');
  await page.getByRole('button', { name: 'Evento anterior' }).click();
  await expect(page.getByTestId('frame-index')).toContainText('19 / 20');
});

test('loading, offline and HTTP failures can retry', async ({ page }) => {
  let mode: 'pending' | 'offline' | 'http' | 'ok' = 'pending';
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/**', async route => {
    if (mode === 'pending') await pending;
    if (mode === 'offline') return route.abort('connectionrefused');
    if (mode === 'http') return route.fulfill({ status: 503, body: 'unavailable' });
    await route.continue();
  });
  await page.goto('/?view=2d');
  await expect(page.getByRole('heading', { name: 'Acendendo as luzes…' })).toBeVisible();
  mode = 'offline'; release();
  await expect(page.getByRole('heading', { name: 'API offline' })).toBeVisible();
  mode = 'http'; await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('heading', { name: 'Não foi possível carregar o cenário' })).toBeVisible();
  mode = 'ok'; await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByTestId('selected-order')).toBeVisible();
});

test('unknown order and mobile layout, reduced motion, no overflow', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?order=missing&view=2d');
  await expect(page.getByRole('heading', { name: 'Pedido não encontrado' })).toBeVisible();
  await expect(page.getByLabel('Reduzir movimento')).toBeChecked();
  await page.getByRole('navigation', { name: 'Selecionar pedido', exact: true }).getByRole('button', { name: 'ord-1002' }).click();
  await expect(page.getByTestId('metric-delivery_delay')).toContainText('13 min');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../out/tower-mobile-2d.png', fullPage: true });
});

test('empty snapshot renders no synthetic orders', async ({ page, request }) => {
  const response = await (await request.get('/api/v1/replay')).json() as Bundle['replay'];
  await page.route('**/api/v1/**', async route => {
    const actual = await route.fetch();
    const body = await actual.json();
    if (route.request().url().endsWith('/replay')) Object.assign(body, { events: [], frames: [response.frames[0]], duration_us: '0', start_at: null, end_at: null });
    if (route.request().url().endsWith('/orders')) body.orders = [];
    if (route.request().url().endsWith('/overview')) Object.assign(body, response.frames[0].overview);
    await route.fulfill({ response: actual, json: body });
  });
  await page.goto('/?view=2d');
  await expect(page.getByRole('status')).toContainText('Nenhum evento disponível');
  await expect(page.getByRole('button', { name: 'Reproduzir replay' })).toBeDisabled();
  await expect(page.getByTestId('kpi-total_created').locator('strong')).toHaveText('0');
});

test('lost WebGL context falls back without losing order data', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.evaluate(() => document.querySelector('canvas')?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext());
  await expect(page.getByTestId('fallback-world')).toContainText('WebGL indisponível');
  await expect(page.getByTestId('metric-delivery_delay')).toContainText('13 min');
});

test('incomplete and ambiguous evidence is explicitly shown, never a definitive status', async ({ page }) => {
  await page.route(/\/api\/v1\/(replay|orders)$/, async route => {
    const actual = await route.fetch(), body = await actual.json();
    const orders = route.request().url().endsWith('/replay') ? body.frames.at(-1).orders : body.orders;
    const order = orders.find((candidate: { order_id: string }) => candidate.order_id === 'ord-1002');
    order.evidence_quality = 'INCOMPLETE'; order.resolution = 'AMBIGUOUS'; order.status = null;
    for (const metric of Object.values(order.metrics) as Bundle['orders']['orders'][number]['metrics'][string][]) {
      metric.value = null; metric.available = false; metric.reason = 'AMBIGUOUS_HISTORY';
      metric.order_resolution = 'AMBIGUOUS'; metric.order_evidence_quality = 'INCOMPLETE';
    }
    await route.fulfill({ response: actual, json: body });
  });
  await page.goto('/?view=2d');
  await expect(page.locator('.order-status')).toContainText('Estado indeterminado');
  await expect(page.locator('.quality')).toContainText('Evidência incompleta');
  await expect(page.locator('.quality')).toContainText('AMBIGUOUS');
  await expect(page.getByTestId('metric-delivery_delay')).toContainText('Indisponível');
  await expect(page.getByTestId('fallback-world')).toContainText('Indeterminado');
});
