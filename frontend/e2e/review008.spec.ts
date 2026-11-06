import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

let stream = '';
test.beforeAll(() => {
  stream = execFileSync('.venv\\Scripts\\python.exe', ['-B', '-c', `
import asyncio,json
from rescueos.tower.snapshot import load_snapshot
from rescueos.tower.scout import ScoutAgent,ScoutTools,ScoutRequest
from tests.test_scout import ScoutStub
async def main():
 s=load_snapshot();t=ScoutTools(s,ScoutRequest(snapshot_id=s.snapshot_id,frame_index=20))
 print(''.join([json.dumps(e,ensure_ascii=True)+'\\n' async for e in ScoutAgent(ScoutStub()).stream(t)]),end='')
asyncio.run(main())
`], { cwd: '..', encoding: 'utf8', maxBuffer: 2_000_000 });
});

// Read the actual WebGL image, not just the existence/height of a mesh.
async function ring(page: Page, id: string, visible?: boolean) {
  return page.evaluate(async ({ id, visible }) => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/@react-three_fiber.js'))!;
    const { _roots } = await import(url);
    const canvas = document.querySelector('canvas')!;
    const s = _roots.get(canvas).store.getState();
    const r = s.scene.getObjectByName('scout-alert-' + id) ?? s.scene.getObjectByName('order-selection-' + id);
    if (!r) throw new Error('Selection ring missing');
    if (visible !== undefined) r.visible = visible;
    const point = r.getWorldPosition(s.camera.position.clone()), world = point.toArray();
    const marker = s.scene.getObjectByName('parcel-highlight-' + id);
    point.project(s.camera);
    return { frame: s.gl.info.render.frame, world, depthTest: r.material.depthTest,
      x: (point.x + 1) * canvas.clientWidth / 2, y: (1 - point.y) * canvas.clientHeight / 2,
      radius: Math.ceil(s.camera.zoom * .9) + 10,
      marker: marker ? { width: Math.round(marker.scale.x * s.camera.zoom), height: Math.round(marker.scale.y * s.camera.zoom) } : null };
  }, { id, visible });
}

async function compareRing(page: Page, id: string, label: string) {
  const canvas = page.locator('canvas');
  const p = await ring(page, id, true);
  await expect.poll(async () => (await ring(page, id)).frame).toBeGreaterThan(p.frame + 1);
  const on = await canvas.screenshot({ path: `../out/review008-${label}-on.png` });
  const f = await ring(page, id, false);
  await expect.poll(async () => (await ring(page, id)).frame).toBeGreaterThan(f.frame + 1);
  const off = await canvas.screenshot({ path: `../out/review008-${label}-off.png` });
  const noise = await canvas.screenshot();
  await ring(page, id, true);
  const stats = await page.evaluate(async ({ images, p }) => {
    const pixels = await Promise.all(images.map(async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = c.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return ctx.getImageData(0, 0, c.width, c.height);
    }));
    function changed(a: ImageData, b: ImageData) {
      let count = 0;
      for (let y = Math.max(0, Math.floor(p.y - p.radius)); y < Math.min(a.height, p.y + p.radius); y++) {
        for (let x = Math.max(0, Math.floor(p.x - p.radius)); x < Math.min(a.width, p.x + p.radius); x++) {
          const i = (y * a.width + x) * 4;
          if (Math.max(...[0, 1, 2].map(j => Math.abs(a.data[i + j] - b.data[i + j]))) > 12) count++;
        }
      }
      return count;
    }
    return { changed: changed(pixels[0], pixels[1]), noise: changed(pixels[1], pixels[2]), ...p };
  }, { images: [on, off, noise].map(b => b.toString('base64')), p: await ring(page, id) });
  writeFileSync(`../out/review008-${label}-pixels.json`, JSON.stringify(stats, null, 2));
  expect(stats.depthTest).toBe(true);
  expect(stats.changed, `Ring must change pixels in its projected region (${label})`).toBeGreaterThan(Math.max(8, stats.noise * 3));
}

async function highlight(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/v1/scout/analyze', route => route.fulfill({ contentType: 'application/x-ndjson', body: stream }));
  await page.goto('/?mode=history&order=ord-1001');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: /SCOUT.*Opera/ }).click();
  await page.getByRole('button', { name: 'Analisar restaurante', exact: true }).click();
  await expect(page.getByTestId('scout-status')).toHaveText('Análise concluída.');
  await page.getByTestId('scout-alert-COURIER_WAIT').getByRole('button', { name: /Espera acima/ }).click();
  await expect(page.getByTestId('selected-order')).toHaveText('ord-1002');
}

test('Scout highlight changes actual pixels above the floor in focused and overview cameras', async ({ page }) => {
  await highlight(page);
  await expect.poll(async () => (await ring(page, 'ord-1002')).marker).toEqual({ width: 124, height: 54 });
  await page.locator('.scene-container').screenshot({ path: '../out/final6b-desktop.png' });
  await compareRing(page, 'ord-1002', 'ring-focused');
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await compareRing(page, 'ord-1002', 'ring-overview');
});

test('Scout ring remains visible in preparing, ready and picked-up positions', async ({ page }) => {
  await highlight(page);
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  for (const frame of [11, 17, 18]) {
    await page.getByRole('slider', { name: 'Posição na timeline' }).fill(String(frame));
    await compareRing(page, 'ord-1002', `ring-frame-${frame}`);
  }
});

test('Scout and selected-only rings change rendered pixels on mobile with reduced motion', async ({ page }) => {
  await highlight(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await ring(page, 'ord-1002')).marker).toEqual({ width: 124, height: 54 });
  await page.locator('.scene-container').screenshot({ path: '../out/final6b-mobile.png' });
  await compareRing(page, 'ord-1002', 'ring-mobile');
  await page.getByRole('navigation', { name: 'Selecionar pedido', exact: true }).getByRole('button', { name: 'ord-1003', exact: true }).click();
  await expect.poll(async () => (await ring(page, 'ord-1003')).marker).toEqual({ width: 124, height: 54 });
  await compareRing(page, 'ord-1003', 'ring-selected-cancelled-mobile');
});

test('Scout UI rejects false cancellation and arbitrary blame, then accepts a valid retry', async ({ page }) => {
  let calls = 0;
  const replay = await (await page.request.get('/api/v1/replay')).json();
  const e = replay.events.find((e: any) => e.event_id === 'evt-019');
  await page.route('**/api/v1/scout/analyze', route => {
    const events = stream.trim().split('\n').map(line => JSON.parse(line));
    if (++calls === 1) {
      const result = events.find(e => e.type === 'tool_result' && e.name === 'get_operations_alerts');
      const cancelled = structuredClone(result.result.alerts.find((a: any) => a.code === 'CANCELLED'));
      // Keep every audit copy mutually consistent; only operational truth contradicts it.
      Object.assign(cancelled, { order_id: 'ord-1001', alert_id: 'a'.repeat(64), anchor_event_id: e.event_id, anchor_frame: 19,
        sources: [{ event_id: e.event_id, event_type: e.type, field: 'occurred_at', timestamp: e.occurred_at, origins: e.origins }], origins: e.origins });
      result.result.alerts.push(cancelled);
      events.at(-1).alerts = structuredClone(result.result.alerts);
      events.at(-1).tool_history.find((h: any) => h.name === result.name).result = structuredClone(result.result);
      events.at(-1).explanation = 'O restaurante é culpado.';
    }
    return route.fulfill({ contentType: 'application/x-ndjson', body: events.map(e => JSON.stringify(e)).join('\n') + '\n' });
  });
  await page.goto('/?mode=history&view=2d');
  await page.getByRole('button', { name: 'Abrir painel Scout' }).click();
  const analyze = page.getByRole('button', { name: 'Analisar restaurante', exact: true });
  await analyze.click();
  await expect(page.getByTestId('scout-status')).toContainText('inválida');
  await expect(page.getByTestId('scout-result')).toHaveCount(0);
  await analyze.click();
  await expect(page.getByTestId('scout-result')).toContainText('4 ocorrências observadas');
  await expect(page.getByTestId('scout-result')).not.toContainText('culpado');
});
