import { test, expect } from '@playwright/test';
import { sceneState } from './scene-probe.ts';

test('five original mascots animate, reduced motion freezes their transforms and HTML selection stays available', async ({ page }) => {
  await page.goto('/?mode=history&sceneProbe=1');
  await expect(page.locator('canvas')).toBeVisible();
  const before = await sceneState(page);
  await expect.poll(async () => {
    const animated = await sceneState(page);
    return animated.crew.filter((character, index) => JSON.stringify(character.transforms)
      !== JSON.stringify(before.crew[index].transforms)).map(character => character.id);
  }, { timeout: 10_000, message: 'Todos os cinco mascotes devem mudar transformações reais dentro do prazo.' })
    .toEqual(before.crew.map(character => character.id));
  await page.getByLabel('Reduzir movimento').check();
  const toggled = await sceneState(page);
  await expect.poll(async () => (await sceneState(page)).frame).toBeGreaterThan(toggled.frame + 1);
  const reduced = await sceneState(page);
  await expect.poll(async () => (await sceneState(page)).frame).toBeGreaterThan(reduced.frame + 1);
  expect((await sceneState(page)).crew).toEqual(reduced.crew);
  for (const name of ['SCOUT', 'FIXER', 'TRACE', 'RUNNER', 'COORDINATOR']) {
    const button = page.locator('.crew-list').getByRole('button', { name: new RegExp(name) });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Fechar papel do mascote' }).click();
  }
  await expect(page.getByTestId('kpi-total_created').locator('strong')).toHaveText('3');
});

test('normal camera focus zoom and repeated overview restore real position, orientation, target and zoom', async ({ page }) => {
  await page.goto('/?mode=history&sceneProbe=1');
  await expect(page.locator('canvas')).toBeVisible();
  // Verify zoom against the size actually used by CameraRig (R3F),
  // not an early DOM bounding box while layout is still changing.
  await expect.poll(async () => {
    const { camera, canvasSize: [width, height] } = await sceneState(page);
    const expectedZoom = Math.max(18, Math.min(85, Math.min(width / 14.2, height / 10.3)));
    return Math.abs(camera[10] - expectedZoom);
  }, { message: 'Camera zoom must match the actual R3F canvas size' }).toBeLessThan(.005);
  const initial = (await sceneState(page)).camera;
  const bounds = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 120, bounds.y + bounds.height / 2 + 35, { steps: 12 });
  await page.mouse.up(); await page.mouse.wheel(0, 200);
  expect((await sceneState(page)).camera).not.toEqual(initial);
  const overview = page.getByRole('button', { name: 'Visão geral', exact: true });
  const restored = async () => {
    await overview.click();
    await expect.poll(async () => Math.max(...(await sceneState(page)).camera.map((value: number, index: number) => Math.abs(value - initial[index])))).toBeLessThan(.005);
  };
  await restored(); await restored();
  const kitchen = page.getByRole('button', { name: 'Cozinha', exact: true });
  await kitchen.focus(); await page.keyboard.press('Enter');
  await expect(kitchen).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => {
    const camera = (await sceneState(page)).camera;
    return Math.max(Math.abs(camera[7] + 2.7), Math.abs(camera[8] - .35), Math.abs(camera[9] + 1.7), Math.abs(camera[10] - initial[10] * 1.12));
  }).toBeLessThan(.01);
  await restored();
  await page.getByRole('slider').fill('15');
  await page.getByRole('slider').fill('20');
  await restored();
});

test('Runner placement follows applied courier events when seeking backward and forward', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?mode=history&sceneProbe=1');
  await expect(page.locator('canvas')).toBeVisible();
  for (const [frame, position, waiting] of [
    [14, [4, .16, 2.2], 'Indisponível'],
    [15, [2.4, .16, .25], 'Indisponível'],
    [18, [4, .16, 2.2], '13 min'],
    [14, [4, .16, 2.2], 'Indisponível'],
  ] as const) {
    await page.getByRole('slider').fill(String(frame));
    await expect.poll(async () => (await sceneState(page)).crew.find(character => character.id === 'runner')!.position).toEqual([...position]);
    await expect(page.getByTestId('metric-courier_waiting_time').locator('strong')).toHaveText(waiting);
  }
});
