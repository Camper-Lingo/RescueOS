import type { CSSProperties } from 'react';
import { MONSTERS } from '../scene/characters/roster.ts';
import type { LiveEvent, LiveEventType, LiveState } from '../simulation/live.ts';
import { LAST_ORDER_MINUTE, NIGHT_SCENARIOS } from '../simulation/live.ts';
import { buildDaySummary } from '../simulation/daySummary.ts';

interface DaySummaryProps {
  sim: LiveState;
  onInspect: () => void;
  onNewNight: () => void;
}

const MILESTONE_COPY: Partial<Record<LiveEventType, { icon: string; title: string }>> = {
  ORDER_CREATED: { icon: '📦', title: 'Chegou o primeiro pedido' },
  KITCHEN_FAULT: { icon: '⚡', title: 'A cozinha precisou parar' },
  KITCHEN_REPAIRED: { icon: '🔧', title: 'Fixer concluiu o reparo' },
  KITCHEN_REWORK: { icon: '🍳', title: 'A cozinha refez um pedido' },
  COURIER_DELAYED: { icon: '🛵', title: 'Um motoboy atrasou' },
  DELIVERED: { icon: '✅', title: 'Uma entrega foi concluída' },
};

const INCIDENT_COPY: Partial<Record<LiveEventType, string>> = {
  KITCHEN_FAULT: 'Equipamento da cozinha parou',
  KITCHEN_REWORK: 'Pedido preparado novamente',
  COURIER_DELAYED: 'Motoboy chegou depois do previsto',
};

function keyMoments(events: LiveEvent[]): LiveEvent[] {
  // Um acontecimento representativo por tipo, ordenado pelo minuto do evento.
  const seen = new Set<LiveEventType>();
  return events.filter(event => {
    if (!MILESTONE_COPY[event.type] || seen.has(event.type)) return false;
    seen.add(event.type);
    return true;
  }).slice(0, 6);
}

export default function DaySummary({ sim, onInspect, onNewNight }: DaySummaryProps) {
  const info = buildDaySummary(sim);
  const milestones = keyMoments(sim.events);
  const withProblems = info.incidentCount > 0 || info.late > 0;
  const calm = !withProblems;
  const headline = info.received === 0 ? 'Tudo pronto para a próxima noite.'
    : info.faults > 0 ? 'A cozinha parou, mas a noite continuou.'
      : withProblems ? 'Uma noite cheia de acontecimentos.'
        : info.inProgress > 0 ? 'A equipe continua com pedidos pelo caminho.'
          : 'Expediente concluído!';
  const intro = `${info.received} pedidos chegaram, ${info.delivered} foram entregues e ${info.inProgress} ainda estavam em andamento no fechamento.`;
  const work = {
    coordinator: `Acompanhou a entrada de ${info.received} pedidos.`,
    runner: `${sim.orders.filter(order => order.readyAt !== null).length} pedidos ficaram prontos para a retirada.`,
    scout: `${info.incidentCount} imprevistos constam nos registros da simulação.`,
    trace: `${sim.events.length} acontecimentos ficaram registrados para consulta.`,
    fixer: `${info.faultsFixed} reparos de cozinha foram concluídos por regras.`,
  };

  return <main className="day-summary day-results" aria-labelledby="day-summary-title">
    <header className="day-results-hero">
      <div className="day-hero-copy">
        <span className="day-results-kicker"><span className="day-kicker-dot"/> TURNO FINALIZADO · SIMULAÇÃO</span>
        <p className="day-hero-overline">O RESGATE DA NOITE</p>
        <h1 id="day-summary-title">🌙 Resumo da noite</h1>
        <p className="day-hero-headline">{headline}</p>
        <p className="day-summary-lead">{intro}</p>
        <div className="day-hero-tags"><span>🎮 {NIGHT_SCENARIOS[sim.scenario].title}</span>
          <span>⏱️ {sim.minute} minutos de operação simulada</span><span>{calm ? '✨ Sem imprevistos ou atrasos registrados' : info.incidentCount > 0 ? `⚠️ ${info.incidentCount} imprevistos registrados` : `🕒 ${info.late} entregas atrasadas`}</span></div>
        <div className="day-summary-actions">
          <button className="primary" onClick={onNewNight}>▶ Jogar outra noite</button>
          <button onClick={onInspect}>↩ Rever restaurante</button>
        </div>
      </div>
      <div className="day-night-art" aria-hidden="true">
        <span className="day-night-moon"/>
        <span className="day-night-star star-a">✦</span><span className="day-night-star star-b">✧</span>
        <span className="day-night-star star-c">✦</span>
        <div className="day-night-building">
          <div className="day-night-sign">RESCUE<span>OS</span></div>
          <div className="day-night-awning"/>
          <div className="day-night-windows"><i/><i/><i/></div>
          <div className="day-night-door"/>
        </div>
        <div className="day-night-mascots"><span>👾</span><span>👾</span><span>👾</span></div>
        <span className="day-night-ground"/>
      </div>
    </header>

    <section className="day-results-score" aria-label="Resultados da noite">
      <h2>Como terminou o expediente?</h2>
      <p>Os quatro números mais importantes, sem complicação.</p>
      <div className="day-summary-metrics">
        <article className="metric-orders"><span className="day-metric-icon">📦</span><small>Pedidos que chegaram</small><strong>{info.received}</strong><span>Todos os pedidos desta noite</span></article>
        <article className="metric-delivered"><span className="day-metric-icon">✅</span><small>Já entregues</small><strong>{info.delivered}</strong><span>Chegaram ao destino</span></article>
        <article className="metric-pending"><span className="day-metric-icon">⏳</span><small>Ainda em andamento</small><strong>{info.inProgress}</strong><span>Não foram entregues até fechar</span></article>
        <article className="metric-late"><span className="day-metric-icon">🕒</span><small>Chegaram atrasados</small><strong>{info.late}</strong><span>Somente os já entregues</span></article>
      </div>
    </section>

    <div className="day-results-columns">
      <section className="day-results-panel day-delivery-feature">
        <div className="day-panel-header"><span className="day-panel-icon">🎯</span><div><h2>As entregas chegaram na hora?</h2><p>Consideramos apenas os pedidos que chegaram ao destino.</p></div></div>
        <div className="day-delivery-overview">
          <div className={`day-punctuality-ring ${info.delivered === 0 ? 'empty' : ''}`} style={{ '--punctuality': `${info.onTimePercent ?? 0}%` } as CSSProperties}
            role="img" aria-label={info.onTimePercent === null ? 'Sem entregas concluídas' : `${info.onTimePercent}% das entregas concluídas chegaram no prazo`}>
            <div><strong>{info.onTimePercent === null ? '—' : `${info.onTimePercent}%`}</strong><span>no prazo</span></div>
          </div>
          <div className="day-delivery-story">
            <p>{info.delivered === 0 ? 'Ainda não houve entregas concluídas. Não é possível avaliar a pontualidade.' :
              `${info.onTime} chegaram no prazo e ${info.late} chegaram depois do combinado.`}</p>
            <div className="day-delivery-count"><span>🟢 No prazo</span><strong>{info.onTime}</strong></div>
            <div className="day-delivery-count"><span>🟠 Atrasadas</span><strong>{info.late}</strong></div>
          </div>
        </div>
      </section>
      <section className="day-results-panel day-pending-feature">
        <div className="day-panel-header"><span className="day-panel-icon">📍</span><div><h2>Onde ficaram os pedidos?</h2><p>Foto da operação no momento do fechamento.</p></div></div>
        <div className="day-pending-rows">
          <span><span>📋 Esperando a cozinha</span><strong>{info.queued}</strong></span>
          <span><span>🍳 Sendo preparados</span><strong>{info.preparing}</strong></span>
          <span><span>📦 Prontos para retirada</span><strong>{info.ready}</strong></span>
          <span><span>🛵 Com o motoboy</span><strong>{info.inProgress - info.queued - info.preparing - info.ready}</strong></span>
        </div>
        <p className="day-summary-footnote">{sim.minute >= LAST_ORDER_MINUTE ? `Os pedidos pararam de chegar no minuto ${LAST_ORDER_MINUTE}. A equipe teve tempo para finalizar; os restantes continuam pendentes, sem contar como atraso de entrega.` : 'O expediente foi encerrado antes da etapa final. Pedidos em andamento continuam pendentes, sem contar como atraso de entrega.'}</p>
      </section>
    </div>

    <div className="day-results-columns">
      <section className="day-results-panel">
        <div className="day-panel-header"><span className="day-panel-icon">⚡</span><div><h2>O que deu errado?</h2><p>{withProblems ? 'Os imprevistos registrados durante a operação.' : 'Nenhum imprevisto registrado nesta noite.'}</p></div></div>
        <div className="day-incident-counters">
          <div><strong>{info.faults}</strong><span>Paradas na cozinha</span><small>{info.faultsFixed} reparadas</small></div>
          <div><strong>{info.reworks}</strong><span>Pedidos refeitos</span></div>
          <div><strong>{info.courierDelays}</strong><span>Motoboys atrasados</span></div>
        </div>
        {info.recentIncidents.length ? <div className="day-incident-list" aria-label="Últimos imprevistos">
          {info.recentIncidents.slice(0, 4).map(event => {
            const repair = event.type === 'KITCHEN_FAULT' ? sim.incidents.find(i => i.orderId === event.orderId && i.openedAt === event.minute) : undefined;
            return <div className="day-incident-row" key={event.seq}>
              <span className="day-incident-time">Min {event.minute}</span><div><strong>{INCIDENT_COPY[event.type] ?? 'Imprevisto registrado'}</strong>
                <small>{event.orderId}{repair ? ` · ${repair.resolvedAt === null ? 'Ainda sem reparo' : `Reparado no minuto ${repair.resolvedAt}`}` : ''}</small></div>
            </div>;
          })}
        </div> : <p className="day-empty-state">✨ Nenhuma falha de equipamento, retrabalho ou atraso de motoboy foi registrado.</p>}
        <p className="day-summary-footnote">Um atraso não prova, por si só, qual foi sua causa.</p>
      </section>
      <section className="day-results-panel">
        <div className="day-panel-header"><span className="day-panel-icon">🗓️</span><div><h2>Os momentos da noite</h2><p>Uma pequena história baseada nos acontecimentos registrados.</p></div></div>
        <ol className="day-moments">
          {milestones.map(event => <li key={event.seq}><span className="day-moment-icon">{MILESTONE_COPY[event.type]?.icon}</span>
            <div><strong>{MILESTONE_COPY[event.type]?.title}</strong><small>Minuto {event.minute} · Pedido {event.orderId}</small></div></li>)}
          <li className="day-moment-close"><span className="day-moment-icon">🌙</span><div><strong>Expediente encerrado</strong><small>Minuto {sim.minute} · {sim.minute >= 60 ? 'Fim automático' : 'Encerrado pelo jogador'}</small></div></li>
        </ol>
      </section>
    </div>

    <section className="day-results-panel day-crew-feature">
      <div className="day-panel-header"><span className="day-panel-icon">👾</span><div><h2>A equipe conta como foi</h2><p>Conheça os cinco ajudantes e o que foi registrado na simulação.</p></div></div>
      <div className="day-crew-recap">
        {MONSTERS.map(item => <article key={item.id} className="day-crew-card">
          <span className="day-crew-portrait" style={{ backgroundColor: item.color }} aria-hidden="true"><i/><i/><b/></span>
          <strong>{item.name}</strong><p>{work[item.id]}</p>
        </article>)}
      </div>
      <p className="day-crew-truth">Nenhum agente de IA foi executado nesta noite. As ações dos monstrinhos foram simuladas por regras, não por um LLM.</p>
    </section>

    <footer className="day-summary-footer">
      <div><strong>Uma noite fictícia, números reais da simulação.</strong>
        <p>Nenhum pedido real, faturamento ou decisão autônoma de IA está representado aqui. {info.averageCourierWait === null
          ? 'Ainda não houve coletas suficientes para calcular a espera dos motoboys.'
          : `Os motoboys esperaram em média ${info.averageCourierWait} minutos até a coleta, entre os pedidos coletados.`}</p></div>
      <div className="day-summary-actions"><button onClick={onInspect}>↩ Rever restaurante</button><button className="primary" onClick={onNewNight}>▶ Jogar outra noite</button></div>
    </footer>
  </main>;
}
