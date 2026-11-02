import { ApiError, canonical } from './validation.ts';

export interface AgentRecord {
  name: string; arguments: Record<string, unknown>; started_ms: number; ended_ms?: number;
  result?: Record<string, unknown>; error_code?: string;
}
export interface AgentEvent {
  type: string; run_id: string; elapsed_ms: number; provider: 'ollama' | 'test'; mode: 'llm' | 'test'; model: string;
  name?: string; arguments?: Record<string, unknown>; started_ms?: number; ended_ms?: number;
  result?: Record<string, unknown>; tool_history?: AgentRecord[]; code?: string;
}
export const invalidAgent = () => new ApiError('schema', 'Resposta do agente inválida ou incompleta. Tente novamente.');
export function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidAgent();
}
export const text = (v: unknown) => { if (typeof v !== 'string') throw invalidAgent(); };
export const natural = (v: unknown) => { if (!Number.isSafeInteger(v) || (v as number) < 0) throw invalidAgent(); };

export function envelope(value: unknown, scope: object, version: string, tools: string[], args: object): asserts value is Record<string, unknown> {
  object(value); text(value.model); text(value.run_id); natural(value.elapsed_ms);
  if (value.schema_version !== version || !/^[a-f0-9-]{36}$/.test(value.run_id as string)
    || Object.entries(scope).some(([k, v]) => value[k] !== v)
    || !['started', 'generating', 'tool_started', 'tool_result', 'completed', 'error'].includes(String(value.type))
    || !((value.provider === 'ollama' && value.mode === 'llm') || (value.provider === 'test' && value.mode === 'test'))) throw invalidAgent();
  const record = (r: unknown) => {
    object(r); object(r.arguments);
    if (!tools.includes(String(r.name)) || canonical(r.arguments) !== canonical(args)) throw invalidAgent();
    natural(r.started_ms);
    if (r.ended_ms !== undefined) { natural(r.ended_ms); if ((r.ended_ms as number) < (r.started_ms as number)) throw invalidAgent(); }
    if (r.result !== undefined) object(r.result);
    if (r.error_code !== undefined) text(r.error_code);
  };
  if (value.type === 'generating' && !['checking_provider', 'planning', 'answer'].includes(String(value.phase))) throw invalidAgent();
  if (value.type === 'tool_started') record({ ...value, started_ms: value.elapsed_ms });
  if (value.type === 'tool_result') {
    record(value); object(value.result); natural(value.ended_ms);
    if ((value.ended_ms as number) > (value.elapsed_ms as number) || value.error_code !== undefined) throw invalidAgent();
  }
  if (value.type === 'completed' || value.type === 'error') {
    if (!Array.isArray(value.tool_history) || value.tool_history.length > tools.length) throw invalidAgent();
    value.tool_history.forEach(record);
  }
  if (value.type === 'error') text(value.code);
}

export function streamAudit(toolCount: number) {
  let count = 0, run = '', identity = '', lastElapsed = -1, active: AgentRecord | null = null;
  const observed: AgentRecord[] = [], used = new Set<string>();
  return (event: AgentEvent) => {
    const current = canonical([event.provider, event.mode, event.model]);
    if ((++count === 1 && event.type !== 'started') || (count > 1 && (event.run_id !== run || event.type === 'started' || current !== identity))
      || event.elapsed_ms < lastElapsed) throw invalidAgent();
    run = event.run_id; identity = current; lastElapsed = event.elapsed_ms;
    if (event.type === 'tool_started') {
      if (active || used.has(event.name!)) throw invalidAgent();
      used.add(event.name!);
      active = { name: event.name!, arguments: structuredClone(event.arguments!), started_ms: event.elapsed_ms };
    }
    if (event.type === 'tool_result') {
      if (!active || active.name !== event.name || active.started_ms !== event.started_ms
        || canonical(active.arguments) !== canonical(event.arguments)) throw invalidAgent();
      observed.push({ ...active, ended_ms: event.ended_ms, result: structuredClone(event.result) }); active = null;
    }
    if (event.type === 'completed' && (active || observed.length !== toolCount)) throw invalidAgent();
    if (event.type === 'completed' || event.type === 'error') {
      const expected = [...observed];
      if (active) {
        const last = event.tool_history!.at(-1);
        if (event.type !== 'error' || last?.ended_ms === undefined || last.ended_ms > event.elapsed_ms) throw invalidAgent();
        expected.push({ ...active, ended_ms: last.ended_ms, error_code: event.code });
      }
      if (canonical(expected) !== canonical(event.tool_history)) throw invalidAgent();
    }
  };
}

export async function readAgentStream(path: string, scope: object, consume: (raw: unknown) => boolean,
  signal: AbortSignal, fetcher: typeof fetch) {
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 125_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetcher(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scope), signal: AbortSignal.any([signal, deadline.signal]) });
    if (!response.ok) throw new ApiError('http', `Agente respondeu HTTP ${response.status}.`);
    if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) throw invalidAgent();
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let pending = '', bytes = 0, count = 0, terminal = false;
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted || deadline.signal.aborted) throw new Error('Execução interrompida.');
      if (done) break;
      bytes += value.byteLength; if (bytes > 1_048_576) throw invalidAgent();
      pending += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        if (signal.aborted || deadline.signal.aborted) throw new Error('Execução interrompida.');
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (!line || terminal || ++count > 32 || line.length > 262144) throw invalidAgent();
        terminal = consume(JSON.parse(line));
      }
      if (pending.length > 262144) throw invalidAgent();
    }
    pending += decoder.decode();
    if (pending.trim() || !terminal) throw invalidAgent();
  } catch (failure) {
    if (signal.aborted) throw failure;
    if (deadline.signal.aborted) throw new Error('A análise excedeu o tempo de espera. Tente novamente.');
    if (failure instanceof ApiError) throw failure;
    throw new Error('Não foi possível concluir a análise. Verifique o provedor local e tente novamente.');
  } finally {
    clearTimeout(timer); await reader?.cancel().catch(() => {}); reader?.releaseLock();
  }
}
