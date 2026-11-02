import { ApiError, canonical, identifier, rational, source } from './validation.ts';
import type { Rational, Source } from '../types/api.ts';
import { envelope, object, text, streamAudit, readAgentStream } from './agentStream.ts';

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
export function validateTraceEvent(value: unknown, scope: TraceScope, eventIds: Set<string>): TraceEvent {
  envelope(value, scope, 'trace.1', tools, { order_id: scope.order_id }); identifier(value.order_id);
  if (value.type === 'tool_result') {
    object(value.result);
    if (!Array.isArray(value.result.facts) || !Array.isArray(value.result.unknowns)) throw error();
    value.result.unknowns.forEach(text);
    for (const item of value.result.facts) fact(item, eventIds);
    if (value.result.facts.some(item => value.name === tools[0] ? item.kind === 'metric'
      : value.name === tools[1] ? item.kind !== 'metric' : true)) throw error();
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
  return value as unknown as TraceEvent;
}

export async function investigateTrace(scope: TraceScope, eventIds: Set<string>, onEvent: (event: TraceEvent) => void,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<void> {
  const audit = streamAudit(tools.length), seenFacts = new Map<string, string>();
  await readAgentStream('/api/v1/trace/investigate', scope, raw => {
    const event = validateTraceEvent(raw, scope, eventIds);
    audit(event);
    if (event.type === 'tool_result') event.result!.facts.forEach(f => {
      if (seenFacts.has(f.fact_id)) throw error(); seenFacts.set(f.fact_id, canonical(f));
    });
    if (event.type === 'completed' && event.facts!.some(f => seenFacts.get(f.fact_id) !== canonical(f))) throw error();
    onEvent(event);
    return event.type === 'completed' || event.type === 'error';
  }, signal, fetcher);
}
