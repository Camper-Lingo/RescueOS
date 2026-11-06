import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceLive, createLive, LAST_ORDER_MINUTE, lateMinutes, LIVE_CAPACITY } from './live.ts';
import { buildDaySummary } from './daySummary.ts';

const SEEDS = [2026, 11, 42, 500, 64, 86, 99, 105, 123, 456, 987, 654, 876, 777, 999];
const sample = (scenario: 'quiet' | 'medium' | 'busy') => {
  const nights = SEEDS.map(seed => advanceLive(createLive(seed, scenario), 60));
  const totals = nights.map(buildDaySummary);
  const delivered = totals.reduce((sum, row) => sum + row.delivered, 0);
  const onTime = totals.reduce((sum, row) => sum + row.onTime, 0);
  const pending = totals.reduce((sum, row) => sum + row.inProgress, 0);
  return { nights, delivered, percent: 100 * onTime / delivered, pending };
};

test('calm and average nights are playable while chaotic nights remain genuinely harder', () => {
  const quiet = sample('quiet'), medium = sample('medium'), busy = sample('busy');
  assert.ok(quiet.percent >= 80 && quiet.percent <= 97, `quiet on-time: ${quiet.percent}`);
  assert.ok(medium.percent >= 80 && medium.percent <= 97, `medium on-time: ${medium.percent}`);
  assert.ok(busy.percent < medium.percent - 15, 'pressure and incidents should be visible in busy nights');
  assert.ok(quiet.pending === 0 && medium.pending < 7, 'calm shifts should usually finish their work');
  assert.ok(busy.pending < busy.delivered, 'even a busy night should finish more orders than it leaves pending');
});

test('final stretch receives no new orders but keeps advancing existing ones', () => {
  for (const scenario of ['quiet', 'medium', 'busy'] as const) {
    const before = advanceLive(createLive(2026, scenario), LAST_ORDER_MINUTE);
    const after = advanceLive(before, 60 - LAST_ORDER_MINUTE);
    assert.equal(after.orders.length, before.orders.length);
    assert.ok(after.events.every((event, index) => event.seq === index + 1));
    assert.ok(after.events.filter(event => event.type === 'ORDER_CREATED').every(event => event.minute <= LAST_ORDER_MINUTE));
    assert.ok(after.orders.filter(order => order.status === 'PREPARING').length <= LIVE_CAPACITY);
    assert.ok(after.orders.some(order => order.status === 'DELIVERED'));
  }
});

test('promises are fixed at creation and lateness requires actual delivery evidence', () => {
  for (const scenario of ['quiet', 'medium', 'busy'] as const) {
    const first = advanceLive(createLive(2026, scenario), 1);
    const saved = first.orders[0];
    const final = advanceLive(first, 59);
    const order = final.orders.find(o => o.id === saved.id)!;
    assert.equal(order.promisedAt, saved.promisedAt);
    assert.ok(order.promisedAt >= order.createdAt + order.prepMinutes + order.deliveryMinutes + 4);
    assert.ok(order.routeKm >= 1.1 && order.routeKm <= 3.0);
    assert.ok(order.courierSpeedKmh > 0);
    assert.equal(order.deliveryMinutes, Math.max(3, Math.ceil(order.routeKm / order.courierSpeedKmh * 60) + 1));
    for (const current of final.orders) {
      assert.equal(lateMinutes(current), current.deliveredAt === null ? null : Math.max(0, current.deliveredAt - current.promisedAt));
      if (current.pickedUpAt !== null) {
        assert.ok(current.courierArrivedAt !== null && current.readyAt !== null);
        assert.ok(current.pickedUpAt >= current.courierArrivedAt! + 3);
        assert.ok(current.pickedUpAt >= current.readyAt! + 3);
      }
    }
  }
});

test('the published seed is no longer an impossible evening', () => {
  const states = Object.fromEntries((['quiet', 'medium', 'busy'] as const)
    .map(scenario => [scenario, buildDaySummary(advanceLive(createLive(2026, scenario), 60))]));
  assert.ok(states.quiet.delivered >= 3 && states.quiet.inProgress === 0);
  assert.ok(states.medium.delivered >= 6 && states.medium.onTimePercent! >= 80);
  assert.ok(states.busy.delivered >= 10 && states.busy.onTimePercent! >= 20);
  assert.ok(states.busy.inProgress < 20); // ainda há pressão real, mas não 38 pendências
});
