import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceLive, createLive } from './live.ts';
import { buildDaySummary, describeOrder } from './daySummary.ts';

test('empty night does not invent completed deliveries or percentages', () => {
  const state = createLive();
  const info = buildDaySummary(state);
  assert.equal(info.received, 0);
  assert.equal(info.delivered, 0);
  assert.equal(info.inProgress, 0);
  assert.equal(info.onTimePercent, null);
  assert.equal(info.averageCourierWait, null);
  assert.equal(info.incidentCount, 0);
});

test('early closing shows pending orders instead of calling them delivered or late', () => {
  const state = advanceLive(createLive(2026, 'busy'), 6);
  const info = buildDaySummary(state);
  assert.equal(info.received, state.orders.length);
  assert.equal(info.received, info.delivered + info.inProgress);
  assert.equal(info.onTime + info.late, info.delivered);
  assert.equal(info.faults, 1);
  assert.equal(info.faultsFixed, 0);
  assert.ok(info.inProgress > 0);
  assert.ok(info.recentIncidents.some(event => event.type === 'KITCHEN_FAULT'));
});

test('fully advanced night uses only completed orders as punctuality denominator', () => {
  const state = advanceLive(createLive(2026, 'busy'), 60);
  const info = buildDaySummary(state);
  const delivered = state.orders.filter(order => order.deliveredAt !== null);
  assert.equal(info.delivered, delivered.length);
  assert.equal(info.delivered + info.inProgress, info.received);
  assert.equal(info.onTime + info.late, delivered.length);
  assert.equal(info.onTimePercent, delivered.length ? Math.round(info.onTime / delivered.length * 100) : null);
  assert.equal(info.faults, 1);
  assert.equal(info.faultsFixed, 1);
  assert.equal(info.incidentCount, info.faults + info.reworks + info.courierDelays);
  assert.ok(info.reworks > 0);
  assert.ok(info.courierDelays > 0);
  assert.equal(info.recentIncidents.length, Math.min(6, info.incidentCount));
  assert.equal(info.recentIncidents[0]?.minute >= info.recentIncidents.at(-1)!.minute, true);
});

test('plain language reflects order state and does not invent a cause for lateness', () => {
  const state = advanceLive(createLive(), 1);
  const queued = state.orders[0];
  assert.ok(describeOrder(queued, state.minute, false));
  const busy = advanceLive(createLive(2026, 'busy'), 6);
  const preparing = busy.orders.find(order => order.status === 'PREPARING');
  if (preparing) assert.match(describeOrder(preparing, busy.minute, true), /parado|reparo/);
  const ended = advanceLive(createLive(), 60);
  const done = ended.orders.find(order => order.status === 'DELIVERED');
  assert.ok(done);
  assert.match(describeOrder(done, ended.minute, false), /entreg|chegou/);
});
