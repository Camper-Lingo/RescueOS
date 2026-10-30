import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Object3D } from 'three';

async function sceneState(page: Page) {
  return page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).find(name => name.includes('/@react-three_fiber.js'))!;
    const { _roots } = await import(path);
    const state = _roots.get(document.querySelector('canvas')).store.getState();
    return {
      camera: [...state.camera.position.toArray(), ...state.camera.quaternion.toArray(), ...state.controls.target.toArray(), state.camera.zoom],
      crew: ['scout', 'fixer', 'trace', 'runner', 'coordinator'].map(id => {
        const root = state.scene.getObjectByName(`mascot-${id}`);
        if (!root) throw new Error(`Missing mascot ${id}`);
        const transforms: number[][] = [];
        root.traverse((part: Object3D) => transforms.push([...part.position.toArray(), part.rotation.x, part.rotation.y, part.rotation.z, ...part.scale.toArray()]));
        return { id, position: root.position.toArray() as number[], transforms };
      }),
    };
  });
}

test('five original mascots animate, reduced motion freezes their transforms and HTML selection stays available', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  const before = await sceneState(page);
  await page.waitForTimeout(350);
  const animated = await sceneState(page);
  for (let index = 0; index < before.crew.length; index++) {
    expect(animated.crew[index].transforms, before.crew[index].id).not.toEqual(before.crew[index].transforms);
  }
  await page.getByLabel('Reduzir movimento').check();
  await page.waitForTimeout(180);
  const reduced = await sceneState(page);
  await page.waitForTimeout(350);
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
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  const bounds = (await page.locator('canvas').boundingBox())!;
  const overviewZoom = Math.max(18, Math.min(85, Math.min(bounds.width / 14.2, bounds.height / 10.3)));
  await expect.poll(async () => (await sceneState(page)).camera[10]).toBeCloseTo(overviewZoom, 3);
  const initial = (await sceneState(page)).camera;
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
  await page.goto('/');
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
