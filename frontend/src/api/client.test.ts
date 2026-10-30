import test from 'node:test';
import assert from 'node:assert/strict';
import type { Bundle } from '../types/api.ts';
import { ApiError, loadBundle, validateBundle } from './client.ts';
import { emptyBundle } from './test-payloads.ts';

function bundle() {
  return emptyBundle();
}
test('HTTP client loads all four read-only resources and keeps same-snapshot metadata', async () => {
  const expected = bundle(), calls: string[] = [];
  const mock = (async (input: string) => {
    calls.push(input);
    const key = input.split('/').at(-1)! as keyof Bundle;
    return Response.json(expected[key]);
  }) as typeof fetch;
  assert.deepEqual(await loadBundle(undefined, mock), expected);
  assert.deepEqual(calls.sort(), ['/api/v1/diagnostics', '/api/v1/orders', '/api/v1/overview', '/api/v1/replay']);
});
test('network errors distinguished from HTTP and malformed JSON responses', async () => {
  for (const [mock, kind] of [
    [async () => { throw new TypeError('network'); }, 'offline'],
    [async () => new Response('', { status: 503 }), 'http'],
    [async () => new Response('not json'), 'schema'],
  ] as const) await assert.rejects(loadBundle(undefined, mock as typeof fetch), error => error instanceof ApiError && error.kind === kind);
});
test('abort is preserved for unmount cleanup', async () => {
  await assert.rejects(loadBundle(undefined, (async () => { throw new DOMException('aborted', 'AbortError'); }) as typeof fetch), { name: 'AbortError' });
});
test('mixed snapshots, non-demo data and wrong versions are rejected', () => {
  for (const change of [
    (data: Bundle) => { data.orders.snapshot_id = 'b'.repeat(64); },
    (data: Bundle) => { Reflect.set(data.orders, 'synthetic', false); },
    (data: Bundle) => { Reflect.set(data.replay, 'schema_version', '2.0'); },
  ]) { const data = bundle(); change(data); assert.throws(() => validateBundle(data), ApiError); }
});
test('missing frames and unordered elapsed timestamps are rejected', () => {
  const missing = bundle(); missing.replay.frames = [];
  assert.throws(() => validateBundle(missing), ApiError);
  const unordered = bundle();
  unordered.replay.events = ['3', '2'].map((elapsed_us, index) => ({ event_id: `e${index}`, order_id: null, restaurant_id: 'r', type: 'PROMOTION_STARTED',
    occurred_at: '2026-10-29T18:00:00Z', elapsed_us, applied_to_order: false, origins: [] }));
  unordered.replay.frames = [0, 1, 2].map(index => ({ index, orders: [], event_id: index ? `e${index - 1}` : null,
    elapsed_us: index ? unordered.replay.events[index - 1].elapsed_us : '0', overview: structuredClone(unordered.replay.frames[0].overview) }));
  assert.throws(() => validateBundle(unordered), ApiError);
});
