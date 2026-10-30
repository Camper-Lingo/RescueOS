import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiError, loadBundle, loadOrder } from './client.ts';
import { emptyBundle } from './test-payloads.ts';

test('review005 validates actual HTTP JSON, rejects malformed structures and recovers', async () => {
  // Parsing HTTP JSON intentionally gives untrusted runtime values, never a forced Bundle.
  let data = JSON.parse(JSON.stringify(emptyBundle()));
  const server = createServer((request, response) => {
    const key = request.url!.split('/').at(-1)!;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(data[key]));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fetcher: typeof fetch = (url, options) => fetch(base + String(url), options);
  try {
    assert.deepEqual(await loadBundle(undefined, fetcher), emptyBundle());
    const faults: [string, (payload: typeof data) => void][] = [
      ['orders missing', value => { delete value.orders.orders; }],
      ['orders not array', value => { value.orders.orders = {}; }],
      ['fraction zero denominator', value => { value.overview.aggregates.delay_rate.value = { numerator: '1', denominator: '0' }; }],
      ['fraction missing numerator', value => { value.overview.aggregates.delay_rate.value = { denominator: '3' }; }],
      ['fraction nonnumeric', value => { value.overview.aggregates.delay_rate.value = { numerator: 'NaN', denominator: '3' }; }],
      ['invalid frame', value => { delete value.replay.frames[0].overview; }],
      ['invalid diagnostics', value => { value.diagnostics.diagnostics = [null]; }],
      ['empty evidence ID', value => { value.diagnostics.evidence_catalog = [{ event_id: ' ', order_id: null, restaurant_id: 'r', type: 'PROMOTION_STARTED', occurred_at: '2026-10-29T18:00:00Z', origins: [] }]; }],
      ['invalid origin', value => { value.diagnostics.evidence_catalog = [{ event_id: 'e', order_id: null, restaurant_id: 'r', type: 'PROMOTION_STARTED', occurred_at: '2026-10-29T18:00:00Z', origins: [{ source: 'a', line: '1', raw_text_sha256: 'a'.repeat(64) }] }]; }],
      ['inconsistent final overview', value => { value.overview.aggregates.total_created.value = 99; }],
      ['inconsistent availability', value => { value.overview.aggregates.total_created.available = false; }],
    ];
    for (const [name, corrupt] of faults) {
      data = JSON.parse(JSON.stringify(emptyBundle())); corrupt(data);
      await assert.rejects(loadBundle(undefined, fetcher), error => error instanceof ApiError && error.kind === 'schema', name);
      data = JSON.parse(JSON.stringify(emptyBundle()));
      assert.deepEqual(await loadBundle(undefined, fetcher), emptyBundle(), `${name}: recovery`);
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('review005 individual client transports every ID through the JSON query without changing it', async () => {
  const received: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    assert.equal(url.pathname, '/api/v1/order');
    assert.equal(url.searchParams.has('order_id'), false);
    received.push(JSON.parse(url.searchParams.get('order_id_json')!));
    response.writeHead(404, { 'content-type': 'application/json' }); response.end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fetcher: typeof fetch = (url, options) => fetch(base + String(url), options);
  const ids = ['normal', 'with/slash', 'with?query', 'with#hash', 'with spaces', 'João', '🍲', 'e\u0301', 'lone-\ud800'];
  try {
    for (const id of ids) await assert.rejects(loadOrder(id, undefined, fetcher), error => error instanceof ApiError && error.kind === 'http');
    assert.deepEqual(received, ids);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
