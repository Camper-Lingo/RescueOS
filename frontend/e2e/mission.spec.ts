import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

let trace = '';
let empty: Record<string, unknown>;
test.beforeAll(() => {
  const fixtures = JSON.parse(execFileSync('.venv\\Scripts\\python.exe', ['-B', '-c', `
import asyncio,json,tempfile
from pathlib import Path
from fastapi.testclient import TestClient
from rescueos.tower.api import create_app
from rescueos.tower.snapshot import load_snapshot
from rescueos.tower.trace import TraceAgent,OrderTools,InvestigationRequest
from tests.test_trace import StubProvider
from tests.test_scout import ScoutStub
async def main():
 s=load_snapshot();t=OrderTools(s,InvestigationRequest(snapshot_id=s.snapshot_id,frame_index=20,order_id='ord-1002'))
 result=''.join([json.dumps(e,ensure_ascii=True)+'\\n' async for e in TraceAgent(StubProvider()).stream(t)])
 with tempfile.TemporaryDirectory() as tmp:
  path=Path(tmp)/'empty.jsonl';path.write_text('',encoding='utf8')
  with TestClient(create_app(path,trace_provider=StubProvider(),scout_provider=ScoutStub())) as c:
   empty={key:c.get('/api/v1/'+key).json() for key in ('replay','orders','overview','diagnostics')}
 print(json.dumps({'trace':result,'empty':empty},ensure_ascii=True))
asyncio.run(main())
`], { cwd: '..', encoding: 'utf8', maxBuffer: 2_000_000 }));
  trace = fixtures.trace; empty = fixtures.empty;
});

for (const view of ['desktop', 'mobile', 'fallback']) test(`first mission is playable without AI in ${view}`, async ({ page }) => {
  if (view === 'mobile') await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (view === 'fallback') await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      return String(args[0]).includes('webgl') ? null : original.apply(this, args);
    } as typeof original;
  });
  let scoutCalls = 0, traceCalls = 0;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/v1/scout/analyze', route => { scoutCalls++; return route.fulfill({ status: 503, body: 'Unexpected mission inference' }); });
  await page.route('**/api/v1/trace/investigate', route => { traceCalls++; return route.fulfill({ contentType: 'application/x-ndjson', body: trace }); });
  await page.goto('/?mode=history');
  const welcome = page.getByRole('region', { name: 'Boas-vindas ao RescueOS' });
  await expect(welcome).toContainText('Bem-vindo ao RescueOS!');
  if (view === 'desktop') await welcome.screenshot({ path: '../out/stage6b5-onboarding.png' });
  await page.getByRole('button', { name: 'Começar primeira missão', exact: true }).click();
  const guide = page.getByRole('region', { name: 'Primeira missão', exact: true });
  await expect(guide).toContainText('Conheça Scout');
  await page.locator('.crew-list').getByRole('button', { name: /SCOUT.*Operações/ }).click();
  await expect(guide).toContainText('13 min de espera');
  await expect(guide).toContainText('Demonstração sem IA');
  await guide.getByRole('button', { name: 'Ver pedido ord-1002', exact: true }).click();
  await expect(page.getByTestId('selected-order')).toHaveText('ord-1002');
  await guide.getByRole('button', { name: 'Voltar à chegada' }).click();
  await expect(page.getByTestId('frame-index')).toContainText('15 / 20');
  await expect(page.getByTestId('metric-courier_waiting_time')).toContainText('Indisponível');
  if (view === 'mobile') await guide.screenshot({ path: '../out/stage6b5-mission-mobile.png' });
  await guide.getByRole('button', { name: 'Avançar até a coleta' }).click();
  await expect(page.getByTestId('frame-index')).toContainText('18 / 20');
  await expect(page.getByTestId('metric-courier_waiting_time')).toContainText('13 min');
  if (view === 'desktop') await guide.screenshot({ path: '../out/stage6b5-mission.png' });
  await guide.getByRole('button', { name: 'Abrir investigação no Trace', exact: true }).click();
  await expect(page.getByTestId('frame-index')).toContainText('20 / 20');
  const investigate = page.getByRole('button', { name: 'Investigar com Trace', exact: true });
  await expect(page.getByRole('region', { name: 'Investigação Trace', exact: true })).toBeFocused();
  expect(scoutCalls).toBe(0); expect(traceCalls).toBe(0);
  if (view === 'desktop') {
    await investigate.click(); await expect(page.getByTestId('trace-summary')).toContainText('13');
    expect(traceCalls).toBe(1);
  }
  await page.getByRole('button', { name: 'Concluir primeira missão', exact: true }).click();
  await expect(guide).toContainText('Missão concluída!');
  await expect(guide).toContainText('não demonstram causa ou responsabilidade');
  await guide.screenshot({ path: `../out/stage6b5-completed-${view}.png` });
  await guide.getByRole('button', { name: 'Voltar à visão geral' }).click();
  await expect(page.getByRole('button', { name: 'Visão geral', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await guide.getByRole('button', { name: 'Explorar livremente', exact: true }).click();
  await expect(guide).toHaveCount(0);
  await page.getByRole('button', { name: 'Reiniciar primeira missão' }).click();
  await expect(guide).toContainText('Conheça Scout');
  await guide.getByRole('button', { name: 'Sair da missão' }).click();
  if (view === 'fallback') await expect(page.getByTestId('fallback-world')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('welcome can be skipped and the mission works by keyboard without trapping focus', async ({ page }) => {
  await page.goto('/?mode=history&view=2d');
  await page.getByRole('button', { name: 'Explorar livremente', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Reiniciar primeira missão' }).focus(); await page.keyboard.press('Enter');
  const guide = page.getByRole('region', { name: 'Primeira missão', exact: true });
  for (const name of ['Selecionar Scout', 'Ver pedido ord-1002', 'Voltar à chegada', 'Avançar até a coleta', 'Concluir missão sem IA']) {
    await guide.getByRole('button', { name, exact: true }).focus(); await page.keyboard.press('Enter');
  }
  await expect(guide).toContainText('Missão concluída!');
  await guide.getByRole('button', { name: 'Explorar livremente', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.locator('.crew-list').getByRole('button', { name: /FIXER/ }).click();
  await expect(page.getByRole('status')).toContainText('Em desenvolvimento');
  await expect(page.getByRole('button', { name: 'Investigar pedido', exact: true })).toHaveCount(0);
});

test('mission is unavailable on a snapshot without its canonical evidence', async ({ page }) => {
  for (const key of ['replay', 'orders', 'overview', 'diagnostics']) {
    await page.route('**/api/v1/' + key, route => route.fulfill({ json: empty[key] }));
  }
  await page.goto('/?mode=history&view=2d');
  await expect(page.getByRole('button', { name: 'Começar primeira missão' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Boas-vindas ao RescueOS' })).toContainText('não está disponível');
  await page.getByRole('button', { name: 'Explorar livremente', exact: true }).click();
  await expect(page.getByText('Nenhum evento disponível', { exact: true })).toBeVisible();
});
