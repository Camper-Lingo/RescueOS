import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceLive, createLive } from './live.ts';
import { crewActivities } from './crew.ts';

test('crew is idle before the simulation, without claiming an AI action', () => {
  const crew = crewActivities(createLive(), false);
  assert.equal(crew.runner.orderId, null);
  assert.equal(crew.runner.carrying, false);
  assert.equal(crew.scout.busy, false);
  assert.match(crew.trace.message, /IA não está ativa/);
});

test('assignments derive from synthetic order states and are reproducible', () => {
  const sim = advanceLive(createLive(2026), 35);
  const crew = crewActivities(sim, true);
  assert.deepEqual(crew, crewActivities(advanceLive(createLive(2026), 35), true));
  assert.equal(crew.coordinator.orderId, sim.orders.find(o => o.status === 'QUEUED')?.id
    ?? sim.orders.find(o => o.status === 'PREPARING')?.id ?? sim.orders.at(-1)?.id ?? null);
  if (crew.runner.carrying) assert.equal(sim.orders.find(o => o.id === crew.runner.orderId)?.status, 'READY');
  assert.equal(crew.fixer.carrying, false);
});

test('runner prepares dispatch; external delivery belongs to the couriers', () => {
  let found = false;
  for (let minute = 1; minute <= 60; minute++) {
    const sim = advanceLive(createLive(2026), minute);
    const task = crewActivities(sim, true).runner;
    if (task.carrying) {
      assert.equal(task.action, 'carry');
      assert.equal(sim.orders.find(o => o.id === task.orderId)?.status, 'READY');
      assert.deepEqual(task.position, [2.4, .16, .25]);
      found = true;
    }
  }
  assert.ok(found);
});

test('busy night causes a real repair action and incident inspection', () => {
  const broken = advanceLive(createLive(2026, 'busy'), 6);
  const crew = crewActivities(broken, true);
  assert.equal(crew.fixer.action, 'repair');
  assert.equal(crew.scout.action, 'scan');
  assert.equal(crew.trace.action, 'inspect');
  assert.match(crew.fixer.message, /minuto 10/);
  const repaired = advanceLive(broken, 4);
  assert.equal(repaired.incidents[0].resolvedAt, 10);
  assert.notEqual(crewActivities(repaired, true).fixer.action, 'repair');
});

test('pause leaves assignments visible but disables work gestures and carrying', () => {
  const sim = advanceLive(createLive(2026, 'busy'), 6);
  const crew = crewActivities(sim, false);
  for (const value of Object.values(crew)) {
    assert.equal(value.busy, false);
    assert.equal(value.carrying, false);
    assert.equal(value.action, 'idle');
  }
  assert.match(crew.coordinator.message, /pausada/);
});
