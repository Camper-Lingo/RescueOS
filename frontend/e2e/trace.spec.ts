import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

// Stub explícito com ferramentas reais; a avaliação Ollama fica em tests.trace_live.
const fixtures: Record<string, string> = {};
test.beforeAll(() => {
  for (const frame of [15, 20]) fixtures[frame] = execFileSync('.venv\\Scripts\\python.exe', ['-B', '-c', `
import asyncio,json
from tests.test_trace import StubProvider
from rescueos.tower.snapshot import load_snapshot
from rescueos.tower.trace import InvestigationRequest,OrderTools,TraceAgent
async def main():
 s=load_snapshot()
 t=OrderTools(s,InvestigationRequest(order_id='ord-1002',snapshot_id=s.snapshot_id,frame_index=${frame}))
 async for e in TraceAgent(StubProvider()).stream(t): print(json.dumps(e,ensure_ascii=True))
asyncio.run(main())
`], { cwd: '..', encoding: 'utf8' });
});

test('Trace opens from mascot, shows audited facts and links evidence without changing replay on start', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/v1/trace/investigate', route => route.fulfill({ contentType: 'application/x-ndjson', body: fixtures[20] }));
  await page.goto('/');
  await page.getByRole('button', { name: /TRACE.*Evidências/ }).click();
  await page.getByRole('button', { name: 'Investigar com Trace', exact: true }).click();
  await expect(page.getByTestId('trace-status')).toHaveText('Investigação concluída.');
  await expect(page.getByTestId('frame-index')).toContainText('20 / 20');
  const result = page.getByTestId('trace-result');
  await expect(result).toContainText('Atraso na entrega: 13 minutes.');
  await expect(result).toContainText('Atraso na cozinha: 11 minutes.');
  await expect(result).toContainText('Espera do entregador: 13 minutes.');
  await expect(page.getByText('STUB DE TESTE — não é IA real')).toBeVisible();
  await page.getByText('Histórico de ferramentas e auditoria', { exact: true }).click();
  await expect(page.getByText('4 consultas iniciadas; 4 concluídas.')).toBeVisible();
  await result.getByRole('button', { name: 'evt-018 ↗', exact: true }).first().click();
  await expect(page.getByTestId('frame-index')).toContainText('18 / 20');
  await expect(page.getByText(/O replay mudou; esta investigação mantém o quadro indicado/)).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('navigation', { name: 'Selecionar pedido', exact: true }).getByRole('button', { name: 'ord-1001' }).click();
  await expect(result).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Trace provider failure remains visible and retry succeeds', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/v1/trace/investigate', route => {
    const started = JSON.parse(fixtures[20].split('\n')[0]);
    const failure = JSON.stringify(started) + '\n' + JSON.stringify({ ...started, type: 'error', code: 'MODEL_UNAVAILABLE', tool_history: [] }) + '\n';
    return route.fulfill({ contentType: 'application/x-ndjson', body: ++calls === 1 ? failure : fixtures[20] });
  });
  await page.goto('/?view=2d');
  await page.getByRole('button', { name: 'Abrir painel Trace' }).click();
  await page.getByRole('button', { name: 'Investigar com Trace', exact: true }).click();
  await expect(page.getByTestId('trace-status')).toContainText('Modelo local indisponível');
  await expect(page.getByTestId('trace-result')).toHaveCount(0);
  await expect(page.getByTestId('selected-order')).toHaveText('ord-1002');
  await page.getByRole('button', { name: 'Investigar com Trace', exact: true }).click();
  await expect(page.getByTestId('trace-result')).toBeVisible();
  expect(calls).toBe(2);
});

test('Trace cancels and a subsequent investigation uses only the selected frame', async ({ page }) => {
  let calls = 0;
  const scopes: number[] = [];
  await page.route('**/api/v1/trace/investigate', async route => {
    const scope = route.request().postDataJSON(); scopes.push(scope.frame_index);
    if (++calls === 1) await new Promise(resolve => setTimeout(resolve, 1000));
    await route.fulfill({ contentType: 'application/x-ndjson', body: fixtures[scope.frame_index] }).catch(() => {});
  });
  await page.goto('/?view=2d');
  await page.getByRole('button', { name: 'Abrir painel Trace' }).click();
  await page.getByRole('button', { name: 'Investigar com Trace', exact: true }).click();
  await expect.poll(() => scopes.length).toBe(1);
  await page.getByRole('button', { name: 'Cancelar investigação', exact: true }).click();
  await expect(page.getByTestId('trace-status')).toHaveText('Investigação cancelada pelo usuário.');
  await page.getByRole('slider', { name: 'Posição na timeline' }).fill('15');
  await page.getByRole('button', { name: 'Investigar com Trace', exact: true }).click();
  await expect(page.getByTestId('trace-result')).toBeVisible();
  await expect(page.getByTestId('trace-result')).not.toContainText('evt-020');
  await expect(page.getByTestId('trace-result')).toContainText('Atraso na entrega indisponível');
  expect(scopes).toEqual([20, 15]);
});
