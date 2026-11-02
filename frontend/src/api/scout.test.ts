import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import type { Bundle } from '../types/api.ts';
import { analyzeScout } from './scout.ts';

const fixture = JSON.parse(execFileSync('.venv\\Scripts\\python.exe', ['-B', '-c', `
import asyncio,json,tempfile
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from rescueos.tower.api import create_app
from rescueos.tower.scout import ScoutAgent,ScoutTools,ScoutRequest,TOOL_NAMES
from rescueos.tower.snapshot import load_snapshot
from tests.test_metrics import history,conflict
from tests.test_scout import ScoutStub
from tests.test_trace import StubProvider
with TestClient(create_app(trace_provider=StubProvider(),scout_provider=ScoutStub())) as c:
 bundle={key:c.get('/api/v1/'+key).json() for key in ('replay','orders','overview','diagnostics')}
 sid=bundle['replay']['snapshot_id'];cases=[];catalogs={}
 for frame in (0,15,20):
  tools=ScoutTools(c.app.state.snapshot,ScoutRequest(snapshot_id=sid,frame_index=frame))
  catalogs[str(frame)]={'schema_version':'scout.1','snapshot_id':sid,'frame_index':frame,**json.loads(tools._canonical_results[TOOL_NAMES[2]])}
  r=c.post('/api/v1/scout/analyze',json={'snapshot_id':sid,'frame_index':frame})
  cases.append([json.loads(line) for line in r.text.splitlines()])
 original=ScoutTools.call
 for timing in ('immediate','late'):
  held=[]
  async def mutated(self,name,args):
   for previous in held: previous['frame_index']=0
   held.append(args);result=await original(self,name,args)
   if timing=='immediate': args.clear()
   return result
  with patch.object(ScoutTools,'call',mutated):
   r=c.post('/api/v1/scout/analyze',json={'snapshot_id':sid,'frame_index':20})
  cases.append([json.loads(line) for line in r.text.splitlines()])
async def extra_cases():
 result=[]
 data=history('limited');data.append(conflict(data[2]))
 data+=history('open')[:2]
 capacity={'event_id':'capacity','order_id':None,'restaurant_id':'r','occurred_at':'2026-10-29T18:00:00-03:00','type':'RESTAURANT_CAPACITY_UPDATED','data':{'capacity_per_15min':5}}
 data += [capacity,conflict(capacity)]
 for events in (data,history('/?#%\\ufeff\\ud800')):
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'events.jsonl';path.write_text(''.join(json.dumps(e,ensure_ascii=True)+'\\n' for e in events),encoding='utf8')
   s=load_snapshot(path)
   with TestClient(create_app(path,trace_provider=StubProvider(),scout_provider=ScoutStub())) as c:
    b={key:c.get('/api/v1/'+key).json() for key in ('replay','orders','overview','diagnostics')}
   t=ScoutTools(s,ScoutRequest(snapshot_id=s.snapshot_id,frame_index=len(b['replay']['events'])))
   stream=[e async for e in ScoutAgent(ScoutStub()).stream(t)]
   result.append({'bundle':b,'stream':stream,'reference':{'schema_version':'scout.1',**t.arguments,**t.canonical_catalog}})
 return result
print(json.dumps({'bundle':bundle,'cases':cases,'catalogs':catalogs,'extra':asyncio.run(extra_cases())},ensure_ascii=True))
`], { cwd: '..', encoding: 'utf8', maxBuffer: 2_000_000 })) as { bundle: Bundle; cases: Record<string, any>[][]; catalogs: Record<string, any>; extra: any[] };

const baseline = () => structuredClone(fixture.cases[2]);
function fetcher(events: unknown[], size = 47, reference?: unknown): typeof fetch {
  const bytes = new TextEncoder().encode(events.map(e => JSON.stringify(e)).join('\n') + '\n');
  return async url => String(url).includes('/scout/catalog?')
    ? Response.json(reference ?? fixture.catalogs[new URL(String(url), 'http://localhost').searchParams.get('frame_index')!])
    : new Response(new ReadableStream({ start(c) {
    for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size)); c.close();
  } }), { headers: { 'content-type': 'application/x-ndjson' } });
}
async function run(data = baseline(), signal = new AbortController().signal, onEvent = (_e: unknown) => {}) {
  const scope = { snapshot_id: data[0].snapshot_id, frame_index: data[0].frame_index };
  await analyzeScout(scope, fixture.bundle, onEvent, signal, fetcher(data));
}

test('Scout validates real Python HTTP streams including prior frames and mutated tool arguments', async () => {
  for (const data of fixture.cases) {
    let terminal = '';
    await run(data, undefined, e => { terminal = (e as { type: string }).type; });
    assert.equal(terminal, 'completed');
  }
  assert.equal(fixture.cases[0].at(-1)!.alerts.length, 0);
  const wait = fixture.cases[2].at(-1)!.alerts.find((a: any) => a.code === 'COURIER_WAIT');
  assert.equal(wait.anchor_frame, 15);
  assert.deepEqual(wait.sources.map((s: any) => s.event_id), ['evt-015', 'evt-018']);
});

function coordinate(data: Record<string, any>[], change: (alerts: any[]) => void) {
  const output = data.find(e => e.type === 'tool_result' && e.name === 'get_operations_alerts')!;
  change(output.result.alerts);
  const final = data.at(-1)!;
  final.alerts = structuredClone(output.result.alerts);
  final.highlighted_alert_ids = final.highlighted_alert_ids.filter((id: string) => final.alerts.some((a: any) => a.alert_id === id));
  final.tool_history.find((r: any) => r.name === output.name).result = structuredClone(output.result);
}

function falseCancellation(alerts: any[]) {
  const a = structuredClone(alerts.find(a => a.code === 'CANCELLED'));
  const e = fixture.bundle.replay.events.find(e => e.event_id === 'evt-019')!;
  Object.assign(a, { alert_id: 'a'.repeat(64), order_id: 'ord-1001', anchor_event_id: e.event_id, anchor_frame: 19,
    sources: [{ event_id: e.event_id, event_type: e.type, field: 'occurred_at', timestamp: e.occurred_at, origins: e.origins }], origins: e.origins });
  alerts.push(a);
}

const attacks: Record<string, (alerts: any[]) => void> = {
  'false CANCELLED supported by delivered evt-019': falseCancellation,
  'changed code': a => Object.assign(a.find(a => a.code === 'COURIER_WAIT'), { code: 'PENDING_DATA', category: 'information', zone: null, value: null, metric_name: null }),
  'changed category': a => { a[0].category = 'information'; },
  'invented severity': a => { a[0].severity = 'critical'; },
  'false factual text': a => { a[0].explanation = 'O entregador causou 999 minutos de atraso.'; },
  'false title': a => { a[0].title = 'Culpa confirmada'; },
  'omitted canonical alert': a => { a.splice(0, 1); },
  'invented duplicate rule': a => { a.push({ ...structuredClone(a[0]), alert_id: 'b'.repeat(64) }); },
  'duplicate identity': a => { a.push(structuredClone(a[0])); },
  'other order reference': a => { a[0].order_id = 'ord-1001'; },
  'future reference': a => { a[0].anchor_frame = 21; },
  'incompatible existing evidence': a => { a.find(a => a.code === 'CANCELLED').sources[0].event_type = 'DELIVERED'; },
};
for (const [name, change] of Object.entries(attacks)) test(`Scout rejects coordinated ${name}`, async () => {
  const data = baseline(); coordinate(data, change);
  await assert.rejects(run(data));
});

for (const explanation of ['O restaurante foi culpado.', 'Atraso confirmado de 999 minutos.']) {
  test(`Scout rejects free final explanation: ${explanation}`, async () => {
    const data = baseline(); data.at(-1)!.explanation = explanation;
    await assert.rejects(run(data));
  });
}

test('Scout rejects an operationally false independent catalog too', async () => {
  const data = baseline(); coordinate(data, falseCancellation);
  const reference = structuredClone(fixture.catalogs['20']); reference.alerts = data.at(-1)!.alerts;
  await assert.rejects(analyzeScout({ snapshot_id: data[0].snapshot_id, frame_index: 20 }, fixture.bundle,
    () => {}, new AbortController().signal, fetcher(data, 47, reference)));
});

test('Scout requires the independent catalog before starting the model stream', async () => {
  let posts = 0;
  const mock: typeof fetch = async (url, init) => {
    if (String(url).includes('/scout/catalog?')) return new Response('offline', { status: 503 });
    posts++; return fetcher(baseline())(url, init);
  };
  await assert.rejects(analyzeScout({ snapshot_id: fixture.bundle.replay.snapshot_id, frame_index: 20 }, fixture.bundle,
    () => {}, new AbortController().signal, mock));
  assert.equal(posts, 0);
});

test('Scout accepts canonical incomplete, pending, unprojected and Unicode cases without inventing data', async () => {
  for (const c of fixture.extra) {
    const scope = { snapshot_id: c.reference.snapshot_id, frame_index: c.reference.frame_index };
    let terminal = '';
    await analyzeScout(scope, c.bundle, e => { terminal = e.type; }, new AbortController().signal, fetcher(c.stream, 47, c.reference));
    assert.equal(terminal, 'completed');
  }
  assert.ok(fixture.extra[0].reference.alerts.some((a: any) => a.code === 'EVIDENCE_LIMITED'));
  assert.ok(fixture.extra[0].reference.alerts.some((a: any) => a.code === 'PENDING_DATA'));
  assert.ok(fixture.extra[0].reference.alerts.some((a: any) => a.code.startsWith('UNPROJECTED_CONFLICT:')));
});

test('Scout validates independent catalog metadata, policy and semantic fields against the bundle', async () => {
  const changes = [
    (r: any) => { r.frame_index = 19; }, (r: any) => { r.snapshot_id = '0'.repeat(64); },
    (r: any) => { r.schema_version = 'other'; }, (r: any) => { r.thresholds.courier_wait_minutes = 121; },
    (r: any) => { r.extra = true; }, (r: any) => { r.alerts[0].category = 'information'; },
    (r: any) => { r.thresholds.courier_wait_minutes = 13; },
  ];
  for (const change of changes) {
    const reference = structuredClone(fixture.catalogs['20']); change(reference);
    await assert.rejects(analyzeScout({ snapshot_id: reference.snapshot_id === '0'.repeat(64) ? fixture.bundle.replay.snapshot_id : reference.snapshot_id, frame_index: 20 },
      fixture.bundle, () => {}, new AbortController().signal, fetcher(baseline(), 47, reference)));
  }
});

test('Scout rejects contradictory histories, scopes, order and incomplete streams', async () => {
  const faults: Record<string, (d: Record<string, any>[]) => void> = {
    duplicate: d => { d.at(-1)!.tool_history = Array(3).fill(d.at(-1)!.tool_history[0]); },
    omitted: d => { d.at(-1)!.tool_history.pop(); },
    reordered: d => { d.at(-1)!.tool_history.reverse(); },
    arguments: d => { d.at(-1)!.tool_history[0].arguments.frame_index = 0; },
    time: d => { d.at(-1)!.tool_history[0].started_ms++; },
    invented: d => { d.at(-1)!.tool_history[0].result.secret = true; },
    scope: d => { d[2].frame_index = 0; },
    truncated: d => { d.pop(); },
    early: d => { d.splice(1, d.length - 2); },
    staleOrder: d => { d[2].order_id = 'other-order'; },
  };
  for (const [name, change] of Object.entries(faults)) {
    const data = baseline(); change(data); await assert.rejects(run(data), error => error instanceof Error, name);
  }
});

test('Scout rejects coordinated false values, sources, anchors and invalid rationals', async () => {
  const changes: Record<string, (a: Record<string, any>) => void> = {
    value: a => { a.value = { numerator: '999', denominator: '1' }; },
    scalar: a => { a.value = 999; },
    denominator: a => { a.value.denominator = '0'; },
    extraFraction: a => { a.value.extra = true; },
    source: a => { a.sources[0].event_id = 'evt-002'; },
    timestamp: a => { a.sources[0].timestamp = '2000-01-01T00:00:00Z'; },
    hash: a => { a.sources[0].origins[0].raw_text_sha256 = '0'.repeat(64); },
    anchor: a => { a.anchor_frame = 21; },
    zone: a => { a.zone = 'kitchen'; },
    extra: a => { a.model_claim = 'invented'; },
  };
  for (const [name, change] of Object.entries(changes)) {
    const data = baseline(), output = data.find(e => e.type === 'tool_result' && e.name === 'get_operations_alerts')!;
    change(output.result.alerts.find((a: any) => a.code === 'COURIER_WAIT'));
    data.at(-1)!.alerts = structuredClone(output.result.alerts);
    data.at(-1)!.tool_history.find((r: any) => r.name === output.name).result = structuredClone(output.result);
    await assert.rejects(run(data), error => error instanceof Error, name);
  }
});

test('Scout rejects invented model highlights and incompatible explanation focus', async () => {
  for (const kind of ['unknown', 'duplicate', 'incompatible', 'changed-text']) {
    const data = baseline(), final = data.at(-1)!;
    if (kind === 'unknown') final.highlighted_alert_ids = ['invented'];
    if (kind === 'duplicate') final.highlighted_alert_ids = [final.alerts[0].alert_id, final.alerts[0].alert_id];
    if (kind === 'incompatible') { final.highlighted_alert_ids = []; final.focus = 'timing'; }
    if (kind === 'changed-text') final.alerts[0].explanation = 'unverified final text';
    await assert.rejects(run(data));
  }
});

test('Scout cancellation prevents buffered late callbacks after context changes', async () => {
  const abort = new AbortController(); let count = 0;
  const data = baseline(), scope = { snapshot_id: data[0].snapshot_id, frame_index: 20 };
  await assert.rejects(analyzeScout(scope, fixture.bundle, () => { count++; abort.abort(); }, abort.signal, fetcher(data, 1_000_000)));
  assert.equal(count, 1);
});

test('Scout rejects HTTP errors and response schemas without clearing the failure', async () => {
  for (const response of [new Response('offline', { status: 503 }), new Response('{}'),
    new Response('bad-json\n', { headers: { 'content-type': 'application/x-ndjson' } })]) {
    await assert.rejects(analyzeScout({ snapshot_id: fixture.bundle.replay.snapshot_id, frame_index: 20 },
      fixture.bundle, () => {}, new AbortController().signal, async () => response));
  }
});
