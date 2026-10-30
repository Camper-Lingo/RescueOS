import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, eventZone, frameAt, rationalText, seek, visualOrder } from './replay.ts';
import type { Cursor } from './replay.ts';
import type { Order, ReplayResponse } from '../types/api.ts';

// Somente contrato visual; regras de negócio pertencem aos testes Python do núcleo.
const times = ['0', '60000000', '60000000', '120000001'];
const replay = { events: times.map((elapsed_us, index) => ({ event_id: `e${index}`, elapsed_us })),
  frames: Array.from({ length: 5 }, (_, index) => ({ index, orders: [] })), duration_us: times.at(-1)! } as unknown as ReplayResponse;
const paused: Cursor = { index: 4, elapsedUs: 120000001n, playing: false, speed: 1 };
const order = (status: string | null, more: Partial<Order> = {}) => ({ status, resolution: 'CONSISTENT', evidence_quality: 'NO_KNOWN_CONFLICTS', metrics: {}, ...more }) as Order;

test('rational display preserves null, zero, signs, 1/3 and integers beyond Number precision', () => {
  assert.equal(rationalText(null), 'Indisponível');
  assert.equal(rationalText(0), '0');
  assert.equal(rationalText({ numerator: '1', denominator: '3' }), '1/3');
  assert.equal(rationalText({ numerator: '-1', denominator: '2' }), '-1/2');
  assert.equal(rationalText({ numerator: '9007199254740993', denominator: '1' }), '9007199254740993');
  assert.throws(() => rationalText({ numerator: '1', denominator: '0' }));
});
test('timestamp lookup includes simultaneous events without reversing backend order', () => {
  assert.equal(frameAt(replay, -1n).index, 0);
  assert.equal(frameAt(replay, 0n).index, 1);
  assert.equal(frameAt(replay, 59999999n).index, 1);
  assert.equal(frameAt(replay, 60000000n).index, 3);
  assert.equal(frameAt(replay, 120000001n).index, 4);
});
test('manual seek can visit individual ties and initial state, independently of history', () => {
  const previous = seek(replay, 2, paused);
  assert.deepEqual(previous, { index: 2, elapsedUs: 60000000n, playing: false, speed: 1 });
  assert.deepEqual(seek(replay, 0, previous), seek(replay, 0, paused));
  assert.equal(seek(replay, -3, paused).index, 0);
  assert.equal(seek(replay, 99, paused).index, 4);
});
test('playback explicit 5 minute compression, pause, speed, cap and immutable inputs', () => {
  const playing = { ...seek(replay, 0, paused), playing: true };
  assert.equal(advance(replay, playing, 200).index, 3);
  assert.equal(advance(replay, playing, 200).elapsedUs, 60000000n);
  assert.equal(advance(replay, { ...playing, speed: 2 }, 200).elapsedUs, 120000000n);
  assert.equal(advance(replay, playing, 1000).playing, false);
  assert.equal(advance(replay, playing, 1000).elapsedUs, 120000001n);
  assert.equal(advance(replay, paused, 500), paused);
  assert.equal(playing.elapsedUs, 0n);
});
test('empty replay stays paused and has one real initial frame', () => {
  const empty = { events: [], frames: [{ index: 0 }], duration_us: '0' } as unknown as ReplayResponse;
  assert.equal(frameAt(empty, 0n).index, 0);
  assert.equal(advance(empty, paused, 100), paused);
});
test('event mapping follows real types and keeps unknown operational context neutral', () => {
  for (const [type, zone] of [['ORDER_CREATED', 'entrance'], ['KITCHEN_STARTED', 'kitchen'], ['KITCHEN_READY', 'kitchen'], ['COURIER_ARRIVED', 'pickup'], ['PICKED_UP', 'pickup'], ['DELIVERED', 'exit'], ['ORDER_CANCELLED', 'incident'], ['PROMOTION_STARTED', 'command'], ['FUTURE_EVENT', 'command']]) assert.equal(eventZone(type), zone);
});
test('order locations use applied states and do not manufacture lateness or certainty', () => {
  for (const [state, zone] of [['CREATED', 'entrance'], ['PREPARING', 'kitchen'], ['READY', 'pickup'], ['PICKED_UP', 'exit'], ['DELIVERED', 'exit'], ['CANCELLED', 'incident']]) assert.equal(visualOrder(order(state)).zone, zone);
  assert.equal(visualOrder(order('PREPARING')).color, '#90d9ba');
  assert.equal(visualOrder(order('DELIVERED', { evidence_quality: 'INCOMPLETE' })).uncertain, true);
  assert.equal(visualOrder(order('DELIVERED', { resolution: 'AMBIGUOUS' })).zone, 'incident');
  assert.equal(visualOrder(order(null)).uncertain, true);
  assert.equal(visualOrder(order('FUTURE_STATE')).zone, 'command');
});
