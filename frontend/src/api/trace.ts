import { ApiError, canonical, identifier, rational, source } from './validation.ts';
import type { Rational, Source } from '../types/api.ts';

export interface TraceScope { order_id: string; snapshot_id: string; frame_index: number }
export interface TraceFact { fact_id: string; kind: 'state' | 'event' | 'metric'; text: string; value: unknown; sources: Source[] }
export interface ToolRecord {
  name: string; arguments: { order_id: string }; started_ms: number; ended_ms?: number;
  result?: Record<string, unknown>; error_code?: string;
}
export interface TraceEvent extends TraceScope {
  schema_version: 'trace.1'; run_id: string; type: 'started' | 'generating' | 'tool_started' | 'tool_result' | 'completed' | 'error';
  elapsed_ms: number; provider: 'ollama' | 'test'; mode: 'llm' | 'test'; model: string;
  phase?: string; name?: string; arguments?: { order_id: string }; code?: string;
  started_ms?: number; ended_ms?: number; result?: { facts: TraceFact[]; unknowns: string[] };
  facts?: TraceFact[]; hypotheses?: { code: string; fact_id: string; text: string }[];
  unknowns?: string[]; tool_history?: ToolRecord[];
}
const tools = ['get_order_timeline', 'get_order_metrics', 'get_order_evidence', 'get_order_diagnostics'];
const hypothesisMetrics: Record<string, string> = { kitchen_timing: 'metric.kitchen_delay', courier_wait: 'metric.courier_waiting_time' };
const error = () => new ApiError('schema', 'Resposta de Trace inválida ou incompleta. Tente novamente.');
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error();
}
const text = (value: unknown) => { if (typeof value !== 'string') throw error(); };
const natural = (value: unknown) => { if (!Number.isSafeInteger(value) || (value as number) < 0) throw error(); };
function fact(value: unknown, eventIds: Set<string>) {
  object(value); text(value.fact_id); text(value.text);
  if (!['state', 'event', 'metric'].includes(String(value.kind)) || !Array.isArray(value.sources) || !value.sources.length) throw error();
  if (value.kind === 'metric') {
    rational(value.value); object(value.value);
    if (Object.keys(value.value).length !== 2 || !String(value.fact_id).startsWith('metric.')) throw error();
  } else if (value.kind === 'state') {
    if (value.fact_id !== 'state' || !(value.value === null || typeof value.value === 'string')) throw error();
  } else identifier(value.value);
  for (const ref of value.sources) {
    source(ref); object(ref); if (!eventIds.has(ref.event_id as string) || !(ref.origins as unknown[]).length) throw error();
  }
}
function record(value: unknown, scope: TraceScope) {
  object(value); object(value.arguments);
  if (!tools.includes(String(value.name)) || value.arguments.order_id !== scope.order_id || Object.keys(value.arguments).length !== 1) throw error();
  natural(value.started_ms);
  if (value.ended_ms !== undefined) { natural(value.ended_ms); if ((value.ended_ms as number) < (value.started_ms as number)) throw error(); }
  if (value.result !== undefined) object(value.result);
  if (value.error_code !== undefined) text(value.error_code);
}

export function validateTraceEvent(value: unknown, scope: TraceScope, eventIds: Set<string>): TraceEvent {
  object(value); identifier(value.order_id); text(value.model); text(value.run_id); natural(value.elapsed_ms);
  if (value.schema_version !== 'trace.1' || !/^[a-f0-9-]{36}$/.test(value.run_id as string)
    || value.order_id !== scope.order_id || value.snapshot_id !== scope.snapshot_id || value.frame_index !== scope.frame_index
    || !['started', 'generating', 'tool_started', 'tool_result', 'completed', 'error'].includes(String(value.type))
    || !((value.provider === 'ollama' && value.mode === 'llm') || (value.provider === 'test' && value.mode === 'test'))) throw error();
  if (value.type === 'generating' && !['checking_provider', 'planning', 'answer'].includes(String(value.phase))) throw error();
  if (value.type === 'tool_started') {
    record({ ...value, started_ms: value.elapsed_ms }, scope);
  }
  if (value.type === 'tool_result') {
    record(value, scope); object(value.result);
    natural(value.ended_ms);
    if ((value.ended_ms as number) > (value.elapsed_ms as number) || value.error_code !== undefined
      || !Array.isArray(value.result.facts) || !Array.isArray(value.result.unknowns)) throw error();
    value.result.unknowns.forEach(text);
    for (const item of value.result.facts) fact(item, eventIds);
    if (value.result.facts.some(item => value.name === tools[0] ? item.kind === 'metric'
      : value.name === tools[1] ? item.kind !== 'metric' : true)) throw error();
  }
  if (value.type === 'completed' || value.type === 'error') {
    if (!Array.isArray(value.tool_history) || value.tool_history.length > 4) throw error();
    value.tool_history.forEach(item => record(item, scope));
  }
  if (value.type === 'completed') {
    if (!Array.isArray(value.facts) || !value.facts.length || !Array.isArray(value.hypotheses)
      || !Array.isArray(value.unknowns)) throw error();
    value.facts.forEach(item => fact(item, eventIds)); value.unknowns.forEach(text);
    const ids = value.facts.map(item => item.fact_id);
    if (new Set(ids).size !== ids.length || !ids.includes('state')) throw error();
    for (const item of value.hypotheses) {
      object(item); text(item.text);
      const metric = value.facts.find(f => f.fact_id === item.fact_id);
      if (!Object.hasOwn(hypothesisMetrics, String(item.code)) || hypothesisMetrics[String(item.code)] !== item.fact_id
        || metric?.kind !== 'metric' || BigInt((metric.value as Rational).numerator) <= 0n) throw error();
    }
  }
  if (value.type === 'error') text(value.code);
  return value as unknown as TraceEvent;
}

export async function investigateTrace(scope: TraceScope, eventIds: Set<string>, onEvent: (event: TraceEvent) => void,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<void> {
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 125_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetcher('/api/v1/trace/investigate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scope), signal: AbortSignal.any([signal, deadline.signal]) });
    if (!response.ok) throw new ApiError('http', `Trace respondeu HTTP ${response.status}.`);
    if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) throw error();
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let pending = '', count = 0, bytes = 0, terminal = false, run = '', identity = '', lastElapsed = -1;
    const seenFacts = new Map<string, string>(), finishedTools = new Set<string>(), startedTools = new Set<string>();
    const observed: ToolRecord[] = [];
    let active: ToolRecord | null = null;
    const consume = (line: string) => {
      if (!line || terminal || ++count > 32) throw error();
      const event = validateTraceEvent(JSON.parse(line), scope, eventIds);
      const currentIdentity = canonical([event.provider, event.mode, event.model]);
      if ((count === 1 && event.type !== 'started') || (count > 1 && (event.run_id !== run || event.type === 'started' || identity !== currentIdentity))
        || event.elapsed_ms < lastElapsed) throw error();
      run = event.run_id; identity = currentIdentity; lastElapsed = event.elapsed_ms;
      if (event.type === 'tool_started') {
        if (active || startedTools.has(event.name!)) throw error(); startedTools.add(event.name!);
        active = { name: event.name!, arguments: event.arguments!, started_ms: event.elapsed_ms };
      }
      if (event.type === 'tool_result') {
        if (!active || event.name !== active.name || event.started_ms !== active.started_ms
          || canonical(event.arguments) !== canonical(active.arguments)) throw error();
        finishedTools.add(event.name!);
        observed.push({ ...active, ended_ms: event.ended_ms, result: event.result }); active = null;
        event.result!.facts.forEach(f => { if (seenFacts.has(f.fact_id)) throw error(); seenFacts.set(f.fact_id, canonical(f)); });
      }
      if (event.type === 'completed') {
        if (finishedTools.size !== 4 || event.tool_history!.length !== 4 || event.facts!.some(f => seenFacts.get(f.fact_id) !== canonical(f))) throw error();
      }
      if (event.type === 'completed' || event.type === 'error') {
        const expected = [...observed];
        if (active) {
          if (event.type !== 'error') throw error();
          const last = event.tool_history!.at(-1);
          if (last?.ended_ms === undefined || last.ended_ms > event.elapsed_ms) throw error();
          expected.push({ ...active, ended_ms: last.ended_ms, error_code: event.code });
        }
        if (canonical(expected) !== canonical(event.tool_history)) throw error();
      }
      terminal = event.type === 'completed' || event.type === 'error'; onEvent(event);
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength; if (bytes > 1_048_576) throw error();
      pending += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) { consume(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
      if (pending.length > 262144) throw error();
    }
    pending += decoder.decode();
    if (pending.trim() || !terminal) throw error();
  } catch (failure) {
    if (signal.aborted) throw failure;
    if (deadline.signal.aborted) throw new Error('Trace excedeu o tempo de espera. Tente novamente.');
    if (failure instanceof ApiError) throw failure;
    throw new Error('Não foi possível concluir a investigação de Trace. Verifique o provedor local e tente novamente.');
  } finally {
    clearTimeout(timer); await reader?.cancel().catch(() => {}); reader?.releaseLock();
  }
}
