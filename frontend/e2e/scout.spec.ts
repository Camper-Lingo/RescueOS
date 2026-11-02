import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const fixtures: Record<number, string> = {};
let trace = '';
test.beforeAll(() => {
  const data = JSON.parse(execFileSync('.venv\\Scripts\\python.exe', ['-B', '-c', `
import asyncio,json
from rescueos.tower.snapshot import load_snapshot
from rescueos.tower.scout import ScoutAgent,ScoutTools,ScoutRequest
from rescueos.tower.trace import TraceAgent,OrderTools,InvestigationRequest
from tests.test_scout import ScoutStub
from tests.test_trace import StubProvider
async def main():
 s=load_snapshot();out={}
 for frame in (0,15,20):
  t=ScoutTools(s,ScoutRequest(snapshot_id=s.snapshot_id,frame_index=frame))
  out[str(frame)]=''.join([json.dumps(e,ensure_ascii=True)+'\\n' async for e in ScoutAgent(ScoutStub()).stream(t)])
 t=OrderTools(s,InvestigationRequest(snapshot_id=s.snapshot_id,frame_index=20,order_id='ord-1002'))
 out['trace']=''.join([json.dumps(e,ensure_ascii=True)+'\\n' async for e in TraceAgent(StubProvider()).stream(t)])
 print(json.dumps(out,ensure_ascii=True))
asyncio.run(main())
`], { cwd: '..', encoding: 'utf8', maxBuffer: 2_000_000 })) as Record<string, string>;
  for (const frame of [0, 15, 20]) fixtures[frame] = data[frame];
  trace = data.trace;
});
const scout = (page: Page) => page.getByRole('region', { name: 'Análise Scout', exact: true });
const waitAlert = (page: Page) => page.getByTestId('scout-alert-COURIER_WAIT');
async function scene(page: Page) {
  return page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/@react-three_fiber.js'))!;
    const { _roots } = await import(path);
    const state = _roots.get(document.querySelector('canvas')).store.getState();
    return { highlighted: !!state.scene.getObjectByName('scout-alert-ord-1002'), target: state.controls.target.toArray() as number[] };
  });
}

test('Scout explores real evidence in 3D and hands the correct order and frame to Trace without auto investigation', async ({ page }) => {
  let scoutCalls = 0, traceCalls = 0;
  await page.route('**/api/v1/scout/analyze', route => { scoutCalls++; return route.fulfill({ contentType: 'application/x-ndjson', body: fixtures[20] }); });
  await page.route('**/api/v1/trace/investigate', route => { traceCalls++; return route.fulfill({ contentType: 'application/x-ndjson', body: trace }); });
  await page.goto('/?order=ord-1001');
  await expect(page.locator('canvas')).toBeVisible();
  await page.screenshot({ path: '../out/stage6b-overview.png', fullPage: true });
  await page.getByRole('button', { name: /SCOUT.*Operações/ }).click();
  await expect(scout(page).getByRole('button', { name: 'Analisar restaurante', exact: true })).toBeVisible();
  expect(scoutCalls).toBe(0);
  await page.screenshot({ path: '../out/stage6b-scout-selected.png', fullPage: true });
  await scout(page).getByRole('button', { name: 'Analisar restaurante', exact: true }).click();
  await expect(page.getByTestId('scout-status')).toHaveText('Análise concluída.');
  await expect(page.getByTestId('scout-result')).toContainText('4 ocorrências observadas');
  await expect(scout(page)).toContainText('STUB DE TESTE — não é IA real');
  await page.screenshot({ path: '../out/stage6b-analysis.png', fullPage: true });
  await waitAlert(page).getByRole('button', { name: /Espera acima/ }).click();
  await expect(page.getByTestId('selected-order')).toHaveText('ord-1002');
  await expect.poll(async () => (await scene(page)).highlighted).toBe(true);
  await expect.poll(async () => (await scene(page)).target[0]).toBeCloseTo(2.4, 2);
  await page.screenshot({ path: '../out/stage6b-alert-highlight.png', fullPage: true });
  await waitAlert(page).getByRole('button', { name: 'Ver o que aconteceu', exact: true }).click();
  await expect(page.getByTestId('frame-index')).toContainText('15 / 20');
  await expect(page.getByTestId('scout-pinned-context')).toContainText('Análise fixada no quadro 20');
  await expect(page.getByTestId('selected-order')).toHaveText('ord-1002');
  await page.screenshot({ path: '../out/stage6b-guided-replay.png', fullPage: true });
  await page.getByTestId('scout-step-evt-018').click();
  await expect(page.getByTestId('frame-index')).toContainText('18 / 20');
  await page.getByTestId('scout-step-evt-015').click();
  await expect(page.getByTestId('frame-index')).toContainText('15 / 20');
  expect(scoutCalls).toBe(1);
  await waitAlert(page).getByRole('button', { name: 'Abrir investigação no Trace' }).click();
  await expect(page.getByTestId('frame-index')).toContainText('20 / 20');
  const tracePanel = page.getByRole('region', { name: 'Investigação Trace', exact: true });
  await expect(tracePanel.getByRole('button', { name: 'Investigar com Trace', exact: true })).toBeVisible();
  expect(traceCalls).toBe(0);
  await page.screenshot({ path: '../out/stage6b-handoff.png', fullPage: true });
  await tracePanel.getByRole('button', { name: 'Investigar com Trace', exact: true }).click();
  const summary = page.getByTestId('trace-summary');
  await expect(summary).toContainText('Entregue');
  await expect(summary).toContainText('13'); await expect(summary).toContainText('11');
  await expect(tracePanel.locator('.trace-inspect')).not.toHaveAttribute('open');
  await page.screenshot({ path: '../out/stage6b-trace-summary.png', fullPage: true });
  await tracePanel.getByText('Inspecionar todos os fatos, fontes e hashes', { exact: true }).click();
  await expect(tracePanel.locator('.trace-inspect')).toContainText('SHA-256');
  await expect(tracePanel.locator('.trace-inspect')).toContainText('evt-018');
  expect(traceCalls).toBe(1);
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await expect.poll(async () => (await scene(page)).target[0]).toBeCloseTo(0, 2);
});

for (const change of ['frame', 'order']) test(`Scout discards delayed results after changing ${change}`, async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  let calls = 0;
  await page.route('**/api/v1/scout/analyze', async route => {
    const first = ++calls === 1, frame = route.request().postDataJSON().frame_index as number;
    if (first) await gate;
    const data = fixtures[frame].trim().split('\n').map(line => ({ ...JSON.parse(line), run_id: (first ? 'a' : 'b').repeat(8) + '-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }));
    await route.fulfill({ contentType: 'application/x-ndjson', body: data.map(e => JSON.stringify(e)).join('\n') + '\n' }).catch(() => {});
  });
  await page.goto('/?view=2d'); await scout(page).getByRole('button', { name: 'Abrir painel Scout' }).click();
  const analyze = scout(page).getByRole('button', { name: 'Analisar restaurante', exact: true });
  await analyze.click(); await expect.poll(() => calls).toBe(1); await expect(analyze).toBeDisabled();
  if (change === 'frame') await page.getByRole('slider', { name: 'Posição na timeline' }).fill('15');
  else await page.getByRole('navigation', { name: 'Selecionar pedido', exact: true }).getByRole('button', { name: 'ord-1001', exact: true }).click();
  await expect(page.getByTestId('scout-status')).toContainText('contexto mudou');
  await expect(analyze).toBeEnabled(); await analyze.click();
  await expect(page.getByTestId('scout-status')).toHaveText('Análise concluída.'); release();
  await scout(page).getByText('Inspecionar execução Scout', { exact: true }).click();
  await expect(scout(page).locator('pre').last()).toContainText('bbbbbbbb-aaaa');
  await expect(scout(page).locator('pre').last()).not.toContainText('aaaaaaaa-aaaa');
  if (change === 'frame') await expect(page.getByTestId('scout-alert-DELIVERY_DELAY')).toHaveCount(0);
  expect(calls).toBe(2);
});

test('Scout provider errors and cancellation are explicit and retry remains functional', async ({ page }) => {
  let calls = 0, release!: () => void; const gate = new Promise<void>(r => { release = r; });
  await page.route('**/api/v1/scout/analyze', async route => {
    const n = ++calls;
    if (n === 1) {
      const started = JSON.parse(fixtures[20].split('\n')[0]);
      return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify(started) + '\n' + JSON.stringify({ ...started, type: 'error', code: 'MODEL_UNAVAILABLE', tool_history: [] }) + '\n' });
    }
    if (n === 2) await gate;
    await route.fulfill({ contentType: 'application/x-ndjson', body: fixtures[20] }).catch(() => {});
  });
  await page.goto('/?view=2d'); await scout(page).getByRole('button', { name: 'Abrir painel Scout' }).click();
  const analyze = scout(page).getByRole('button', { name: 'Analisar restaurante', exact: true });
  await analyze.click(); await expect(page.getByTestId('scout-status')).toContainText('Modelo local indisponível');
  await expect(page.getByTestId('scout-result')).toHaveCount(0);
  await analyze.click(); await expect.poll(() => calls).toBe(2);
  await scout(page).getByRole('button', { name: 'Cancelar análise' }).click(); release();
  await expect(page.getByTestId('scout-status')).toContainText('cancelada pelo usuário');
  await analyze.click(); await expect(page.getByTestId('scout-result')).toBeVisible(); expect(calls).toBe(3);
});

test('Scout works with keyboard, reduced motion, mobile and unavailable WebGL', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      return String(args[0]).includes('webgl') ? null : original.apply(this, args);
    } as typeof original;
  });
  await page.route('**/api/v1/scout/analyze', route => route.fulfill({ contentType: 'application/x-ndjson', body: fixtures[20] }));
  await page.goto('/'); await expect(page.getByTestId('fallback-world')).toBeVisible();
  const mascot = page.getByRole('button', { name: /SCOUT.*Operações/ }); await mascot.focus(); await page.keyboard.press('Enter');
  await scout(page).getByRole('button', { name: 'Analisar restaurante', exact: true }).click();
  await expect(page.getByTestId('scout-result')).toBeVisible();
  await waitAlert(page).getByRole('button', { name: /Espera acima/ }).click();
  await expect(page.getByTestId('fallback-world')).toContainText('Alerta selecionado');
  await expect(page.getByLabel('Reduzir movimento')).toBeChecked();
  await page.screenshot({ path: '../out/stage6b-mobile.png', fullPage: true });
  await waitAlert(page).getByRole('button', { name: 'Ver o que aconteceu', exact: true }).click();
  await expect(page.getByTestId('frame-index')).toContainText('15 / 20');
  await page.screenshot({ path: '../out/stage6b-fallback.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('Scout rejects a coordinated forged value and recovers on retry', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/v1/scout/analyze', route => {
    const data = fixtures[20].trim().split('\n').map(line => JSON.parse(line));
    if (++calls === 1) {
      const result = data.find(e => e.type === 'tool_result' && e.name === 'get_operations_alerts');
      result.result.alerts[0].value = { numerator: '999', denominator: '1' };
      data.at(-1).alerts = structuredClone(result.result.alerts);
      data.at(-1).tool_history.find((h: any) => h.name === result.name).result = structuredClone(result.result);
    }
    return route.fulfill({ contentType: 'application/x-ndjson', body: data.map(e => JSON.stringify(e)).join('\n') + '\n' });
  });
  await page.goto('/?view=2d'); await scout(page).getByRole('button', { name: 'Abrir painel Scout' }).click();
  const analyze = scout(page).getByRole('button', { name: 'Analisar restaurante', exact: true });
  await analyze.click(); await expect(page.getByTestId('scout-status')).toContainText('inválida');
  await expect(page.getByTestId('scout-result')).toHaveCount(0);
  await analyze.click(); await expect(page.getByTestId('scout-result')).toContainText('13 min');
  await expect(page.getByTestId('scout-result')).not.toContainText('999');
  const delivery = page.getByTestId('scout-alert-DELIVERY_DELAY');
  await delivery.getByRole('button', { name: 'Entrega após o prazo', exact: false }).click();
  await expect(delivery).toContainText('Sem localização espacial atribuída');
  await delivery.getByRole('button', { name: 'Ver o que aconteceu', exact: true }).click();
  await expect(page.getByTestId('frame-index')).toContainText('20 / 20');
  await expect(page.getByRole('button', { name: 'Visão geral', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(calls).toBe(2);
});
