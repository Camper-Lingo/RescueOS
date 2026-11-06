import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceLive, createLive, lateMinutes, LAST_ORDER_MINUTE, LIVE_CAPACITY, LIVE_MAX_ORDERS, waitMinutes } from './live.ts';

test('seed produces exactly the same orders and event history', () => {
  assert.deepEqual(advanceLive(createLive(42), 40), advanceLive(createLive(42), 40));
  assert.notDeepEqual(advanceLive(createLive(42), 20), advanceLive(createLive(43), 20));
});
test('starts empty, then generates synthetic orders and a monotonic event log', () => {
  const start = createLive();
  assert.deepEqual(start.orders, []);
  const next = advanceLive(start, 1);
  assert.equal(start.minute, 0); // reducer did not mutate the original
  assert.equal(next.orders[0].id, 'sim-001');
  assert.equal(next.events[0].type, 'ORDER_CREATED');
  assert.deepEqual(next.events.map(event => event.seq), next.events.map((_, i) => i + 1));
});
test('kitchen concurrency and status transitions respect time', () => {
  let state = createLive(5);
  for (let i = 0; i < 55; i++) {
    state = advanceLive(state);
    assert.ok(state.orders.filter(order => order.status === 'PREPARING').length <= LIVE_CAPACITY);
    for (const order of state.orders) {
      if (order.pickedUpAt !== null) assert.ok(order.readyAt !== null && order.pickedUpAt >= order.readyAt);
      if (order.deliveredAt !== null) assert.ok(order.pickedUpAt !== null && order.deliveredAt >= order.pickedUpAt);
      if (order.status === 'QUEUED') assert.equal(order.startedAt, null);
    }
  }
  assert.ok(state.orders.some(order => order.status === 'DELIVERED'));
  assert.ok(state.orders.filter(order => order.status === 'QUEUED').length <= 3, 'medium night should not create an unbounded kitchen backlog');
});
test('waiting and lateness unavailable before the supporting transitions', () => {
  const order = advanceLive(createLive(), 1).orders[0];
  assert.equal(waitMinutes(order), null);
  assert.equal(lateMinutes(order), null);
  const completed = advanceLive(createLive(), 60).orders.find(item => item.id === order.id)!;
  assert.equal(waitMinutes(completed), Math.max(0, completed.pickedUpAt! - completed.courierAt));
  assert.equal(lateMinutes(completed), Math.max(0, completed.deliveredAt! - completed.promisedAt));
});
test('reset, event cutoff and speed progression are deterministic and bounded', () => {
  let state = createLive(123);
  for (let i = 0; i < 12; i++) state = advanceLive(state, 10);
  assert.equal(state.minute, 120);
  assert.ok(state.orders.length <= Math.min(LIVE_MAX_ORDERS, LAST_ORDER_MINUTE));
  assert.ok(state.events.filter(event => event.type === 'ORDER_CREATED').every(event => event.minute <= LAST_ORDER_MINUTE));
  assert.deepEqual(advanceLive(createLive(123), 4), advanceLive(advanceLive(createLive(123), 2), 2));
  assert.throws(() => advanceLive(createLive(), -1));
  assert.throws(() => advanceLive(createLive(), 100));
});

test('scenario selection changes arrivals and reproducibly generates pressure', () => {
  const quiet = advanceLive(createLive(2026, 'quiet'), 40);
  const medium = advanceLive(createLive(2026, 'medium'), 40);
  const busy = advanceLive(createLive(2026, 'busy'), 40);
  assert.ok(quiet.orders.length < medium.orders.length);
  assert.ok(medium.orders.length < busy.orders.length);
  assert.deepEqual(busy, advanceLive(createLive(2026, 'busy'), 40));
  assert.throws(() => createLive(2026, 'unknown' as never));
});

test('kitchen outage freezes work and Fixer repair restores progression, with audit events', () => {
  const before = advanceLive(createLive(2026, 'busy'), 5);
  const broken = advanceLive(before);
  const fault = broken.incidents[0];
  assert.equal(fault.openedAt, 6);
  assert.equal(fault.resolvedAt, null);
  assert.equal(broken.events.at(-1)?.type, 'KITCHEN_FAULT');
  for (const order of before.orders.filter(o => o.status === 'PREPARING')) {
    assert.equal(broken.orders.find(o => o.id === order.id)!.workedMinutes, order.workedMinutes);
  }
  const repaired = advanceLive(broken, 4);
  assert.equal(repaired.incidents[0].resolvedAt, 10);
  assert.ok(repaired.events.some(e => e.type === 'KITCHEN_REPAIRED' && e.minute === 10));
  assert.ok(repaired.orders.some(o => o.workedMinutes > broken.orders.find(b => b.id === o.id)!.workedMinutes));
  assert.equal(before.incidents.length, 0); // immutable snapshots
});

test('motoboy can only collect after arrival and readiness and waits at least 3 minutes', () => {
  const sim = advanceLive(createLive(2026, 'busy'), 60);
  assert.ok(sim.events.some(e => e.type === 'COURIER_DELAYED'));
  assert.ok(sim.events.some(e => e.type === 'KITCHEN_REWORK'));
  for (const order of sim.orders) {
    if (order.pickedUpAt !== null) {
      assert.ok(order.courierArrivedAt !== null && order.readyAt !== null);
      assert.ok(order.pickedUpAt >= Math.max(order.courierArrivedAt!, order.readyAt!) + 3);
    }
    assert.equal(order.courierAt, order.courierDueAt + order.courierDelayMinutes);
  }
});
