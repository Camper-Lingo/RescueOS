import { useEffect, useRef, useState } from 'react';
import type { Bundle } from '../types/api.ts';
import { analyzeScout } from '../api/scout.ts';
import type { ScoutAlert, ScoutEvent } from '../api/scout.ts';
import { canonical } from '../api/validation.ts';
import { EVENT_LABELS, rationalText, ZONE_NAMES } from '../simulation/replay.ts';

const phases: Record<string, string> = {
  checking_provider: 'Preparando análise: verificando modelo local…', planning: 'Consultando dados do quadro…',
  answer: 'Gerando explicação com IA…',
};
const errors: Record<string, string> = {
  MODEL_UNAVAILABLE: 'Modelo local indisponível. Verifique o Ollama e tente novamente.',
  BUSY: 'Outro agente está em execução. Aguarde ou cancele a análise anterior.',
  TIMEOUT: 'A análise excedeu o limite de tempo. Tente novamente.',
};

export default function ScoutPanel({ bundle, frameIndex, selectedOrder, active, onExplore, onNavigate, onTrace }: {
  bundle: Bundle; frameIndex: number; selectedOrder: string; active: boolean;
  onExplore: (a: ScoutAlert | null) => void; onNavigate: (a: ScoutAlert, eventId: string) => void;
  onTrace: (a: ScoutAlert, frame: number) => void;
}) {
  const [open, setOpen] = useState(false), [running, setRunning] = useState(false), [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('Escolha um quadro e solicite uma análise.');
  const [events, setEvents] = useState<ScoutEvent[]>([]), [result, setResult] = useState<ScoutEvent | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const key = canonical([bundle.replay.snapshot_id, frameIndex, selectedOrder]);
  const context = useRef(key); context.current = key;
  const pending = useRef<{ controller: AbortController; key: string } | null>(null);
  useEffect(() => { if (active) setOpen(true); }, [active]);
  useEffect(() => {
    if (pending.current && pending.current.key !== key) {
      pending.current.controller.abort(); pending.current = null; setRunning(false);
      setMessage('O contexto mudou. A análise pendente foi cancelada; solicite uma nova análise.');
    }
  }, [key]);
  useEffect(() => () => pending.current?.controller.abort(), []);

  const cancel = () => {
    pending.current?.controller.abort(); pending.current = null; setRunning(false);
    setMessage('Análise cancelada pelo usuário.');
  };
  const analyze = async () => {
    if (pending.current) return;
    const request = { controller: new AbortController(), key }; pending.current = request;
    setRunning(true); setFailed(false); setResult(null); setEvents([]); setExpanded(null); onExplore(null);
    setMessage('Aguardando início da execução…');
    let candidate: ScoutEvent | null = null;
    try {
      await analyzeScout({ snapshot_id: bundle.replay.snapshot_id, frame_index: frameIndex }, bundle, event => {
        if (request.controller.signal.aborted || context.current !== key || pending.current !== request) return;
        setEvents(previous => [...previous, event]);
        if (event.type === 'started') setMessage('Execução iniciada.');
        if (event.type === 'generating') setMessage(phases[event.phase!] ?? 'Consultando dados…');
        if (event.type === 'tool_started') setMessage(`Executando ferramenta: ${event.name}`);
        if (event.type === 'completed') { candidate = event; setMessage('Verificando evidências e histórico…'); }
        if (event.type === 'error') { setFailed(true); setMessage(errors[event.code!] ?? `Análise não concluída (${event.code}). Tente novamente.`); }
      }, request.controller.signal);
      if (pending.current === request && context.current === key && !request.controller.signal.aborted && candidate) {
        setResult(candidate); setMessage('Análise concluída.');
      }
    } catch (error) {
      if (pending.current === request && !request.controller.signal.aborted && context.current === key) {
        setFailed(true); setResult(null); setMessage(error instanceof Error ? error.message : 'Falha ao analisar. Tente novamente.');
      }
    } finally {
      if (pending.current === request) { pending.current = null; setRunning(false); }
    }
  };
  const highlights = new Set(result?.highlighted_alert_ids);
  return <section className="scout-panel" aria-label="Análise Scout">
    <button className="scout-toggle" aria-expanded={open} onClick={() => { if (open && running) cancel(); setOpen(!open); }}>
      ◈ {open ? 'Fechar painel Scout' : 'Abrir painel Scout'}</button>
    {open && <div className="scout-content">
      <div><span className="eyebrow">Scout · inteligência operacional</span><h2>O que merece atenção?</h2>
        <p>Um retrato do quadro selecionado. Regras verificáveis, sem previsões ou ações automáticas.</p></div>
      <div className="agent-actions"><button className="primary" disabled={running} onClick={analyze}>Analisar restaurante</button>
        {running && <button onClick={cancel}>Cancelar análise</button>}</div>
      <p data-testid="scout-status" aria-live="polite" className={failed ? 'trace-error' : ''}>{message}</p>
      {events[0] && <p className="micro muted">{events[0].mode === 'test' ? 'STUB DE TESTE — não é IA real' : `Modelo local: ${events[0].model}`} · Quadro analisado: {events[0].frame_index}</p>}
      {result && <div data-testid="scout-result">
        <div className="scout-result-heading"><h3>{result.alerts!.length} ocorrências observadas</h3>
          <span>Quadro {result.frame_index} / {bundle.replay.events.length}</span></div>
        {result.frame_index !== frameIndex && <p className="context-notice" data-testid="scout-pinned-context">
          Análise fixada no quadro {result.frame_index}. O replay agora mostra o quadro {frameIndex}; estes alertas não descrevem um novo cálculo do instante atual.</p>}
        <p>{result.explanation}</p>
        <p className="micro muted">Regras determinísticas produziram o catálogo. {result.mode === 'test' ? 'O stub selecionou' : 'A IA selecionou'} os destaques e o foco da explicação controlada.
          Limite demonstrativo de espera: {result.thresholds!.courier_wait_minutes} min, sem calibração estatística.</p>
        {!result.alerts!.length && <p>Nenhum alerta comprovado pelas regras neste quadro. Isso não garante ausência de problemas.</p>}
        <div className="scout-alerts">{result.alerts!.map(alert => {
          const steps = [...new Set(alert.sources.map(s => s.event_id))].map(id => ({ id,
            index: bundle.replay.events.findIndex(e => e.event_id === id) })).sort((a, b) => a.index - b.index);
          const selected = expanded === alert.alert_id;
          return <article className={`scout-alert ${alert.category} ${selected ? 'expanded' : ''}`} key={alert.alert_id} data-testid={`scout-alert-${alert.code}`}>
            <button className="scout-alert-heading" aria-expanded={selected} onClick={() => { setExpanded(selected ? null : alert.alert_id); onExplore(selected ? null : alert); }}>
              <span className="alert-category">{({ attention: 'Atenção', information: 'Informação', evidence: 'Evidência' })[alert.category]}</span>
              <strong>{alert.title}</strong><span>{alert.order_id ?? 'Auditoria do arquivo'}</span>
              {alert.value !== null && <b>{rationalText(alert.value)} min</b>}
              {highlights.has(alert.alert_id) && <small>{result.mode === 'test' ? 'Destaque do stub' : 'Destaque da IA'}</small>}
            </button>
            {selected && <div className="scout-alert-detail">
              <p>{alert.explanation}</p>
              <p className="micro muted">{alert.zone ? `Zona lógica relacionada: ${ZONE_NAMES[alert.zone]}.` : 'Sem localização espacial atribuída ao evento.'}</p>
              {alert.anchor_event_id && <button onClick={() => onNavigate(alert, alert.anchor_event_id!)}>Ver o que aconteceu</button>}
              {!!steps.length && <div className="incident-steps" aria-label="Passos verificados do alerta">{steps.map(step => <button key={step.id}
                data-testid={`scout-step-${step.id}`} onClick={() => onNavigate(alert, step.id)}>
                Quadro {step.index + 1} · {EVENT_LABELS[bundle.replay.events[step.index].type]} <small>{step.id} · {bundle.replay.events[step.index].occurred_at}</small>
              </button>)}</div>}
              {alert.order_id !== null && <><button onClick={() => onTrace(alert, result.frame_index)}>Abrir investigação no Trace</button>
                <p className="micro muted">Abre {alert.order_id} no quadro {result.frame_index}. A investigação só começa após sua confirmação no painel Trace.</p></>}
              <details><summary>Inspecionar evidências e regra</summary><pre>{JSON.stringify(alert, null, 2)}</pre></details>
            </div>}
          </article>;
        })}</div>
        <p className="micro muted">{result.unknowns!.join(' ')}</p>
      </div>}
      {!!events.length && <details><summary>Inspecionar execução Scout</summary><p>{events.filter(e => e.type === 'tool_result').length} ferramentas concluídas.</p>
        <pre>{JSON.stringify(events, null, 2)}</pre></details>}
    </div>}
  </section>;
}
