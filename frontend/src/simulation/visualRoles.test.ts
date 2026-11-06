import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORDER_VISUALS, cookState, orderVisual } from './visualRoles.ts';
import { advanceLive, createLive } from './live.ts';

test('cada etapa tem uma silhueta única e pedidos em trânsito não duplicam caixa na bancada', () => {
  assert.equal(orderVisual('QUEUED'), 'ticket');
  assert.equal(orderVisual('PREPARING'), 'pan');
  assert.equal(orderVisual('READY'), 'bag');
  assert.equal(orderVisual('PICKED_UP'), 'none');
  assert.equal(orderVisual('DELIVERED'), 'bag');
  assert.equal(new Set([ORDER_VISUALS.QUEUED, ORDER_VISUALS.PREPARING, ORDER_VISUALS.READY]).size, 3);
});

test('cozinheiro reage a preparo, espera e falha sem inventar ações de IA', () => {
  assert.equal(cookState(0, false).mode, 'idle');
  assert.equal(cookState(1, false).mode, 'cooking');
  assert.match(cookState(2, false).title, /2 pedidos/);
  assert.equal(cookState(1, true).mode, 'fault', 'falha tem prioridade sobre o trabalho');
  assert.match(cookState(1, true).message, /Fixer/);
});

test('cozinheiro acompanha os pedidos do simulador e a falha da noite cheia', () => {
  let night = createLive(2026, 'busy');
  const states = new Set<string>();
  for (let minute = 1; minute <= 12; minute++) {
    night = advanceLive(night);
    const broken = night.incidents.some(incident => incident.resolvedAt === null);
    const preparing = night.orders.filter(order => order.status === 'PREPARING').length;
    states.add(cookState(preparing, broken).mode);
  }
  assert.ok(states.has('cooking'));
  assert.ok(states.has('fault'));
  assert.ok(states.has('idle') || states.has('cooking'));
});
