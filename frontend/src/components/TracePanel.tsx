import { useEffect, useRef, useState } from 'react';
import type { ReplayResponse } from '../types/api.ts';
import { investigateTrace } from '../api/trace.ts';
import type { TraceEvent } from '../api/trace.ts';

const phaseLabels: Record<string, string> = {
  checking_provider: 'Verificando modelo local…', planning: 'Gerando consulta às ferramentas…', answer: 'Gerando resposta verificável…',
};
const errors: Record<string, string> = {
  MODEL_UNAVAILABLE: 'Modelo local indisponível. Inicie o Ollama com qwen3:4b instalado e tente novamente.',
  TIMEOUT: 'A investigação excedeu o limite de tempo.', BUSY: 'Trace já está investigando outro pedido. Tente novamente em instantes.',
};

export default function TracePanel({ orderId, replay, frameIndex, available, active, onEvent }: {
  orderId: string; replay: ReplayResponse; frameIndex: number; available: boolean; active: boolean; onEvent: (id: string) => void;
}) {
  const [open, setOpen] = useState(false), [running, setRunning] = useState(false);
  const [events, setEvents] = useState<TraceEvent[]>([]), [message, setMessage] = useState('Aguardando solicitação.');
  const [result, setResult] = useState<TraceEvent | null>(null), [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { if (active) setOpen(true); }, [active]);
  useEffect(() => () => controller.current?.abort(), []);

  const investigate = async () => {
    const request = new AbortController(); controller.current = request;
    setRunning(true); setEvents([]); setResult(null); setFailed(false); setMessage('Aguardando início da execução…');
    const scope = { order_id: orderId, snapshot_id: replay.snapshot_id, frame_index: frameIndex };
    const ids = new Set(replay.events.slice(0, frameIndex).filter(e => e.order_id === orderId).map(e => e.event_id));
    try {
      await investigateTrace(scope, ids, event => {
        setEvents(previous => [...previous, event]);
        if (event.type === 'started') setMessage('Execução iniciada.');
        if (event.type === 'generating') setMessage(phaseLabels[event.phase!] ?? 'Gerando resposta…');
        if (event.type === 'tool_started') setMessage(`Consultando ferramenta: ${event.name}`);
        if (event.type === 'completed') { setResult(event); setMessage('Investigação concluída.'); }
        if (event.type === 'error') { setFailed(true); setMessage(errors[event.code!] ?? `Investigação não concluída (${event.code}). Nenhum fato do modelo foi aceito.`); }
      }, request.signal);
    } catch (error) {
      setResult(null);
      if (!request.signal.aborted) { setFailed(true); setMessage(error instanceof Error ? error.message : 'Falha ao investigar. Tente novamente.'); }
    } finally {
      setRunning(false); if (controller.current === request) controller.current = null;
    }
  };
  const first = events[0];
  return <section className="trace-panel" aria-label="Investigação Trace">
    <button className="trace-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>◇ {open ? 'Fechar painel Trace' : 'Abrir painel Trace'}</button>
    {open && <div className="trace-content">
      <h3>Trace · investigação de evidências</h3>
      <p>LLM local com ferramentas somente leitura. Nenhuma ação corretiva ou atribuição de culpa.</p>
      <button className="primary" onClick={investigate} disabled={running || !available}>Investigar com Trace</button>
      {running && <button onClick={() => { controller.current?.abort(); setResult(null); setMessage('Investigação cancelada pelo usuário.'); }}>Cancelar investigação</button>}
      {!available && <p>O pedido ainda não possui projeção neste quadro.</p>}
      <p aria-live="polite" className={failed ? 'trace-error' : ''} data-testid="trace-status">{message}</p>
      {first && <p className="trace-context">{first.mode === 'test' ? 'STUB DE TESTE — não é IA real' : `Modelo local: ${first.model}`}<br />
        Quadro investigado: {first.frame_index} / {replay.events.length} · Pedido: {first.order_id}
        {first.frame_index !== frameIndex && <strong> O replay mudou; esta investigação mantém o quadro indicado.</strong>}</p>}
      {result && <div data-testid="trace-result">
        <p>Seleção feita pelo modelo. Texto e fontes dos fatos conferidos pelo backend.</p>
        <h3>Fatos verificados</h3><ul>{result.facts!.map(fact => <li key={fact.fact_id}>
          <p>{fact.text}</p>{fact.sources.map((source, i) => <div className="trace-source" key={`${source.event_id}-${source.field}-${i}`}>
            <button onClick={() => onEvent(source.event_id)}>{source.event_id} ↗</button> <span>{source.field}</span>
            <time>{source.timestamp}</time>{source.origins.map(origin => <small key={`${origin.source}:${origin.line}`} title={origin.raw_text_sha256}>
              {origin.source}:{origin.line} · SHA-256 {origin.raw_text_sha256.slice(0, 10)}…</small>)}
          </div>)}
        </li>)}</ul>
        <h3>Hipóteses para revisão</h3>{result.hypotheses!.length ? result.hypotheses!.map(h => <p key={h.code}>{h.text} Base: {h.fact_id}</p>) : <p>Nenhuma hipótese de causa foi estabelecida.</p>}
        <h3>Informações insuficientes</h3><ul>{result.unknowns!.map((text, i) => <li key={i}>{text}</li>)}</ul>
      </div>}
      {!!events.length && <details><summary>Histórico de ferramentas e auditoria</summary>
        <p>{events.filter(event => event.type === 'tool_started').length} consultas iniciadas; {events.filter(event => event.type === 'tool_result').length} concluídas.</p>
        <pre>{JSON.stringify(events, null, 2)}</pre>
      </details>}
    </div>}
  </section>;
}
