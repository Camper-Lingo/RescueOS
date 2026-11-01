import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { investigateTrace } from './trace.ts';
import type { TraceScope } from './trace.ts';

const scope: TraceScope = { order_id: '\ufeff /🍲', snapshot_id: 'a'.repeat(64), frame_index: 20 };
const names = ['get_order_timeline', 'get_order_metrics', 'get_order_evidence', 'get_order_diagnostics'];
function events() {
  const base = { ...scope, schema_version: 'trace.1', run_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    provider: 'test', mode: 'test', model: 'explicit-stub', elapsed_ms: 1 };
  const fact = { fact_id: 'state', kind: 'state', text: 'Estado reconstruído: DELIVERED.', value: 'DELIVERED', sources: [
    { event_id: 'evt-020', event_type: 'DELIVERED', field: 'occurred_at', timestamp: '2026-10-29T19:05:00-03:00',
      origins: [{ source: 'demo_events.jsonl', line: 20, raw_text_sha256: '0'.repeat(64) }] },
  ] };
  const history = names.map((name, i) => ({ name, arguments: { order_id: scope.order_id }, started_ms: 1, ended_ms: 1,
    result: { facts: i === 0 ? [fact] : [], unknowns: [] } }));
  return [{ ...base, type: 'started' }, ...history.flatMap(record => [
    { ...base, type: 'tool_started', name: record.name, arguments: record.arguments }, { ...base, type: 'tool_result', ...record },
  ]), { ...base, type: 'completed', facts: [fact], hypotheses: [], unknowns: ['Causa desconhecida.'], tool_history: history }];
}
const controller = () => new AbortController().signal;
function fetcher(data: unknown[], chunkSize = 31): typeof fetch {
  const raw = new TextEncoder().encode(data.map(e => JSON.stringify(e)).join('\n') + '\n');
  return async (_url, options) => {
    assert.deepEqual(JSON.parse(options!.body as string), scope);
    return new Response(new ReadableStream<Uint8Array>({ start(stream) {
      for (let i = 0; i < raw.length; i += chunkSize) stream.enqueue(raw.slice(i, i + chunkSize));
      stream.close();
    } }), { headers: { 'content-type': 'application/x-ndjson' } });
  };
}

test('Trace streams chunked Unicode, preserves scope and identifies stub mode', async () => {
  const seen: string[] = [];
  await investigateTrace(scope, new Set(['evt-020']), e => { seen.push(e.type); assert.equal(e.mode, 'test'); }, controller(), fetcher(events(), 1));
  assert.equal(seen.at(-1), 'completed'); assert.equal(seen.filter(t => t === 'tool_result').length, 4);
});

test('Trace rejects invented evidence, changed claims, metadata and truncated streams', async () => {
  for (const fault of ['reference', 'claim', 'scope', 'mode', 'missing-start', 'truncated', 'repeated-tool', 'extra-after-completion']) {
    const data = events() as Record<string, any>[];
    if (fault === 'reference') data[2].result.facts[0].sources[0].event_id = 'fabricated';
    if (fault === 'claim') data[data.length - 1].facts = [{ ...data[data.length - 1].facts[0], text: 'Unsupported claim.' }];
    if (fault === 'scope') data[3].order_id = 'another-order';
    if (fault === 'mode') { data[3].provider = 'ollama'; data[3].mode = 'llm'; }
    if (fault === 'missing-start') data.shift();
    if (fault === 'truncated') data.pop();
    if (fault === 'repeated-tool') data.splice(3, 0, data[1]);
    if (fault === 'extra-after-completion') data.push(data.at(-1)!);
    await assert.rejects(investigateTrace(scope, new Set(['evt-020']), () => {}, controller(), fetcher(data)), error => error instanceof Error, fault);
  }
});

test('Trace tolerates object key reordering and exposes real provider errors', async () => {
  const data = events() as Record<string, any>[];
  data[data.length - 1].facts = data[data.length - 1].facts.map((f: Record<string, unknown>) => Object.fromEntries(Object.entries(f).reverse()));
  await investigateTrace(scope, new Set(['evt-020']), () => {}, controller(), fetcher(data));
  const first = data[0]; let code = '';
  await investigateTrace(scope, new Set(['evt-020']), e => { code = e.code ?? code; }, controller(), fetcher([
    first, { ...first, type: 'error', code: 'MODEL_UNAVAILABLE', tool_history: [] },
  ]));
  assert.equal(code, 'MODEL_UNAVAILABLE');
});

test('Trace contains HTTP, malformed JSON and bad media errors', async () => {
  for (const response of [new Response('unavailable', { status: 503 }), new Response('{}'),
    new Response('not-json\n', { headers: { 'content-type': 'application/x-ndjson' } })]) {
    await assert.rejects(investigateTrace(scope, new Set(), () => {}, controller(), async () => response));
  }
});

test('Trace passes cancellation to fetch and releases the response reader', async () => {
  const abort = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode('not-json\n')); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'application/x-ndjson' } });
  await assert.rejects(investigateTrace(scope, new Set(), () => {}, abort.signal, async (_url, options) => {
    assert.equal(options!.signal!.aborted, false); abort.abort();
    assert.equal(options!.signal!.aborted, true); return response;
  }));
  assert.equal(cancelled, true); assert.equal(response.body!.locked, false);
});

for (const fault of ['duplicates', 'omission', 'invented-result', 'arguments', 'tool-name', 'swapped-history',
  'swapped-stream-result', 'start-time', 'missing-end', 'extra-argument']) {
  test(`review007 rejects incompatible history: ${fault}`, async () => {
    const data = events() as Record<string, any>[];
    // JSON recebido não compartilha objetos entre eventos.
    const wire = JSON.parse(JSON.stringify(data)) as Record<string, any>[];
    const history = wire.at(-1)!.tool_history;
    if (fault === 'duplicates') wire.at(-1)!.tool_history = Array(4).fill(history[0]);
    if (fault === 'omission') history.splice(1, 1);
    if (fault === 'invented-result') history[0].result.facts[0].text = 'Invented history';
    if (fault === 'arguments') history[0].arguments.order_id = 'other';
    if (fault === 'tool-name') history[0].name = names[1];
    if (fault === 'swapped-history') [history[0], history[1]] = [history[1], history[0]];
    if (fault === 'swapped-stream-result') [wire[2].name, wire[4].name] = [wire[4].name, wire[2].name];
    if (fault === 'start-time') { wire[2].started_ms = 0; history[0].started_ms = 0; }
    if (fault === 'missing-end') { delete wire[2].ended_ms; delete history[0].ended_ms; }
    if (fault === 'extra-argument') { wire[1].arguments.extra = true; wire[2].arguments.extra = true; history[0].arguments.extra = true; }
    await assert.rejects(investigateTrace(scope, new Set(['evt-020']), () => {}, controller(), fetcher(wire)));
  });
}

function metricEvents(value: unknown = { numerator: '1', denominator: '3' }) {
  const data = JSON.parse(JSON.stringify(events())) as Record<string, any>[];
  const metric = { ...structuredClone(data.at(-1)!.facts[0]), fact_id: 'metric.courier_waiting_time', kind: 'metric', value };
  data[4].result.facts = [structuredClone(metric)];
  data.at(-1)!.tool_history[1].result.facts = [structuredClone(metric)];
  data.at(-1)!.facts.push(metric);
  return data;
}

for (const value of [999, null, { numerator: 1, denominator: '3' }, { numerator: '1', denominator: '0' },
  { numerator: '1', denominator: '-3' }, { numerator: '1.5', denominator: '3' },
  { numerator: '1', denominator: '3', extra: true }]) {
  test(`review007 rejects invalid rational ${JSON.stringify(value)}`, async () => {
    await assert.rejects(investigateTrace(scope, new Set(['evt-020']), () => {}, controller(), fetcher(metricEvents(value))));
  });
}

test('review007 preserves exact thirds and validates the hypothesis metric association', async () => {
  const data = metricEvents();
  data.at(-1)!.hypotheses = [{ code: 'courier_wait', fact_id: 'metric.courier_waiting_time', text: 'Question for review, not a cause.' }];
  await investigateTrace(scope, new Set(['evt-020']), () => {}, controller(), fetcher(data));
  for (const bad of [{ code: 'courier_wait', fact_id: 'state' }, { code: 'kitchen_timing', fact_id: 'metric.courier_waiting_time' }]) {
    data.at(-1)!.hypotheses = [{ ...bad, text: 'Question for review.' }];
    await assert.rejects(investigateTrace(scope, new Set(['evt-020']), () => {}, controller(), fetcher(data)));
  }
  for (const numerator of ['0', '-1']) {
    const bad = metricEvents({ numerator, denominator: '1' });
    bad.at(-1)!.hypotheses = [{ code: 'courier_wait', fact_id: 'metric.courier_waiting_time', text: 'Question for review.' }];
    await assert.rejects(investigateTrace(scope, new Set(['evt-020']), () => {}, controller(), fetcher(bad)));
  }
});

test('review007 validates audited errors for an unfinished call', async () => {
  const data = events() as Record<string, any>[];
  const partial = data.slice(0, 2);
  const record = { name: names[0], arguments: { order_id: scope.order_id }, started_ms: 1, ended_ms: 2, error_code: 'TOOL_RESULT_MISMATCH' };
  partial.push({ ...data[0], elapsed_ms: 2, type: 'error', code: record.error_code, tool_history: [record] });
  await investigateTrace(scope, new Set(['evt-020']), () => {}, controller(), fetcher(partial));
  partial.at(-1)!.tool_history[0].error_code = 'different';
  await assert.rejects(investigateTrace(scope, new Set(['evt-020']), () => {}, controller(), fetcher(partial)));
});

test('round2 accepts actual HTTP streams despite tool argument mutations and rejects contradictory history', async () => {
  const cases = JSON.parse(execFileSync('.venv\\Scripts\\python.exe', ['-B', '-c', `
import json
from unittest.mock import patch
from fastapi.testclient import TestClient
from rescueos.tower.api import create_app
from rescueos.tower.trace import OrderTools
from tests.test_trace import StubProvider
original = OrderTools.call
cases = []
with TestClient(create_app(trace_provider=StubProvider())) as client:
 sid = client.get('/api/v1/health').json()['snapshot_id']
 for timing in ('immediate', 'late'):
  retained = []
  async def mutated(self, name, args):
   if timing == 'late':
    for earlier in retained: earlier['order_id'] = 'ord-1001'
   retained.append(args)
   result = await original(self, name, args)
   if timing == 'immediate': args['order_id'] = 'ord-1001'
   return result
  with patch.object(OrderTools, 'call', mutated):
   response = client.post('/api/v1/trace/investigate', json={'order_id':'ord-1002','snapshot_id':sid,'frame_index':20})
  assert response.status_code == 200
  cases.append([json.loads(line) for line in response.text.splitlines()])
print(json.dumps(cases, ensure_ascii=True))
`], { cwd: '..', encoding: 'utf8' })) as Record<string, any>[][];
  for (const data of cases) {
    const current = { order_id: data[0].order_id, snapshot_id: data[0].snapshot_id, frame_index: data[0].frame_index };
    const ids = new Set<string>(data.filter(e => e.type === 'tool_result')
      .flatMap(e => e.result.facts.flatMap((f: Record<string, any>) => f.sources.map((s: Record<string, any>) => s.event_id))));
    const response = (events: unknown[]) => async () => new Response(events.map(e => JSON.stringify(e)).join('\n') + '\n',
      { headers: { 'content-type': 'application/x-ndjson' } });
    const seen: string[] = [];
    await investigateTrace(current, ids, e => seen.push(e.type), controller(), response(data));
    assert.equal(seen.at(-1), 'completed');
    assert.equal(seen.filter(type => type === 'tool_result').length, 4);
    const bad = structuredClone(data);
    bad.at(-1)!.tool_history[0].arguments.order_id = 'ord-1001';
    await assert.rejects(investigateTrace(current, ids, () => {}, controller(), response(bad)));
  }
});
