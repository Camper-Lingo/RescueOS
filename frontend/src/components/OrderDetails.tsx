import { useState } from 'react';
import type { Order, ReplayEvent } from '../types/api.ts';
import { EVENT_LABELS, METRIC_LABELS, STATUS_LABELS, rationalText } from '../simulation/replay.ts';

export default function OrderDetails({ order, selected, known, events, onEvent }: {
  order: Order | undefined; selected: string; known: boolean; events: ReplayEvent[]; onEvent: (id: string) => void;
}) {
  const [evidence, setEvidence] = useState(false);
  if (!known) return <section className="order-detail"><span className="eyebrow">Seleção</span><h2>Pedido não encontrado</h2>
    <p>O ID {selected || 'selecionado'} não está neste snapshot. Escolha um pedido da lista.</p></section>;
  if (!order) return <section className="order-detail"><span className="eyebrow">{selected}</span><h2>Ainda não criado</h2>
    <p>Este pedido não possui uma projeção neste ponto da timeline. Avance até o registro de criação.</p></section>;
  const metrics = ['delivery_delay', 'kitchen_delay', 'courier_waiting_time', 'delivery_earliness'];
  return <section className="order-detail">
    <div className="section-heading"><span className="eyebrow">Pedido selecionado</span><span className="tiny">Somente leitura</span></div>
    <h2 data-testid="selected-order">{order.order_id}</h2>
    <div className="order-status"><span className={`status-dot ${order.status?.toLowerCase() ?? 'unknown'}`} />
      <strong>{STATUS_LABELS[order.status ?? ''] ?? 'Estado indeterminado'}</strong>
      <span className="tiny">{order.restaurant_id ?? 'Restaurante desconhecido'}</span></div>
    <div className={`quality ${order.evidence_quality === 'INCOMPLETE' ? 'warning' : ''}`}>
      <span>{order.evidence_quality === 'INCOMPLETE' ? '◈ Evidência incompleta' : '◇ Evidências disponíveis'}</span>
      <small>{order.evidence_quality} · {order.resolution}</small></div>
    <p className="muted micro">Estado reconstruído dos eventos aceitos. A qualidade da evidência e a disponibilidade das métricas são avaliadas separadamente.</p>
    <div className="metric-grid">{metrics.map(name => {
      const metric = order.metrics[name];
      return <article className={`metric ${name === 'delivery_delay' ? 'featured' : ''}`} key={name} data-testid={`metric-${name}`}>
        <span>{METRIC_LABELS[name]}</span><strong>{rationalText(metric?.value ?? null)}{metric?.value !== null && metric?.value !== undefined && <small> min</small>}</strong>
        {metric?.reason && <small className="muted reason">{metric.reason}</small>}
      </article>;
    })}</div>
    <button className="evidence-toggle" aria-expanded={evidence} onClick={() => setEvidence(!evidence)}>
      <span>⌕ {evidence ? 'Fechar evidências' : 'Abrir evidências'}</span><span>{evidence ? '−' : '+'}</span></button>
    {evidence && <div className="evidence-panel" data-testid="evidence-panel">
      <p className="micro muted">Fontes dos cálculos deste instante, com horários originais e linhas do JSONL.</p>
      {metrics.map(name => {
        const metric = order.metrics[name];
        return <article className="metric-proof" key={name}><h3>{METRIC_LABELS[name]}</h3>
          <code>{metric?.formula ?? 'Sem fórmula disponível'}</code>
          {metric?.sources.map((source, index) => <div className="source" key={`${source.event_id}-${source.field}-${index}`}>
            <button onClick={() => onEvent(source.event_id)}>{source.event_id} ↗</button>
            <span>{source.field}</span><time>{source.timestamp}</time>
            {source.origins.map(origin => <small key={`${origin.source}:${origin.line}`} title={origin.raw_text_sha256}>{origin.source}:{origin.line} · SHA-256 {origin.raw_text_sha256.slice(0, 10)}…</small>)}
          </div>)}
          {!metric?.sources.length && <p className="micro muted">Sem fontes suficientes para este cálculo.</p>}
        </article>;
      })}
    </div>}
    {(order.inconsistencies.length > 0 || order.ingestion_conflicts.length > 0) && <div className="local-issues">
      <h3>Limites do histórico</h3>{[...order.inconsistencies, ...order.ingestion_conflicts].map((issue, index) => <details key={`${issue.code}-${index}`}>
        <summary>{issue.code}</summary><p>{issue.message}</p>
        <pre>{JSON.stringify(issue, null, 2)}</pre></details>)}
    </div>}
    <h3 className="subheading">Histórico do pedido <span>{order.timeline_event_ids.length}</span></h3>
    <ol className="order-history">{order.timeline_event_ids.map(id => {
      const event = events.find(candidate => candidate.event_id === id);
      return <li key={id}><button onClick={() => onEvent(id)}><span className="history-node" /><span>
        <strong>{EVENT_LABELS[event?.type ?? ''] ?? event?.type ?? id}</strong>
        <small>{id} · {event?.occurred_at.slice(11, 19)} {event?.occurred_at.slice(19)}</small>
        {!order.applied_event_ids.includes(id) && <small className="muted">Preservado como evidência; sem marco aplicado</small>}
      </span></button></li>;
    })}</ol>
  </section>;
}
