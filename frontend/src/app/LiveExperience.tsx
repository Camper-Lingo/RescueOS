import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary.tsx';
import DaySummary from '../components/DaySummary.tsx';
import { describeOrder } from '../simulation/daySummary.ts';
import { advanceNight, clockLabel, NIGHT_END_MINUTE, nightClockStep, REAL_MS_PER_SIMULATED_MINUTE } from '../simulation/nightClock.ts';
import { MONSTERS } from '../scene/characters/roster.ts';
import type { MonsterId } from '../scene/characters/roster.ts';
import type { Zone } from '../simulation/replay.ts';
import { ZONE_NAMES } from '../simulation/replay.ts';
import { activeKitchenFault, createLive, lateMinutes, LAST_ORDER_MINUTE, LIVE_CAPACITY, LIVE_STATUS_LABELS, NIGHT_SCENARIOS, waitMinutes } from '../simulation/live.ts';
import type { LiveEventType, NightScenario } from '../simulation/live.ts';
import { liveZone } from '../scene/orders/LiveOrderParcel.tsx';
import { crewActivities } from '../simulation/crew.ts';
import { cookState } from '../simulation/visualRoles.ts';

const RestaurantScene = lazy(() => import('../scene/RestaurantScene.tsx'));
const EVENT_COPY: Record<LiveEventType, string> = {
  ORDER_CREATED: 'Novo pedido', KITCHEN_STARTED: 'Preparo iniciado', KITCHEN_READY: 'Comida pronta',
  COURIER_ARRIVED: 'Motoboy chegou à retirada', PICKED_UP: 'Motoboy coletou o pacote', DELIVERED: 'Pedido entregue',
  COURIER_DELAYED: 'Motoboy se atrasou', KITCHEN_REWORK: 'Pedido precisou de retrabalho',
  KITCHEN_FAULT: 'Falha na cozinha — preparo interrompido', KITCHEN_REPAIRED: 'Fixer reparou o equipamento',
};
export default function LiveExperience() {
  const [sim, setSim] = useState(() => createLive());
  const [running, setRunning] = useState(false);
  const [ended, setEnded] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [speed, setSpeed] = useState(1);
  const elapsedRemainder = useRef(0);
  const [selected, setSelected] = useState('');
  const [monster, setMonster] = useState<MonsterId | null>('coordinator');
  const [selectedCook, setSelectedCook] = useState(false);
  const [focus, setFocus] = useState<Zone | null>(null);
  const [resetRequest, setResetRequest] = useState(0);
  const [rotationRequest, setRotationRequest] = useState(0);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [mode2d, setMode2d] = useState(() => {
    try { return !document.createElement('canvas').getContext('webgl2'); } catch { return true; }
  });
  const [sceneFailed, setSceneFailed] = useState(false);
  const [lostContext, setLostContext] = useState(false);
  const onContextLost = useCallback(() => setLostContext(true), []);
  useEffect(() => {
    if (!running || ended) return;
    let lastTick = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const step = nightClockStep(Math.max(0, now - lastTick), speed, elapsedRemainder.current);
      lastTick = now;
      elapsedRemainder.current = step.pendingMs;
      if (step.minutes) setSim(previous => advanceNight(previous, step.minutes));
    }, 250);
    return () => clearInterval(timer);
  }, [running, speed, ended]);
  useEffect(() => {
    if (sim.minute >= NIGHT_END_MINUTE && !ended) {
      setRunning(false);
      setEnded(true);
      setShowSummary(true);
    }
  }, [sim.minute, ended]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const reset = () => { elapsedRemainder.current = 0; setEnded(false); setShowSummary(false); setRunning(false); setSim(createLive(2026, sim.scenario)); setSelected(''); setMonster('coordinator'); setSelectedCook(false); setFocus(null); setResetRequest(x => x + 1); };
  const chooseScenario = (scenario: NightScenario) => {
    elapsedRemainder.current = 0; setEnded(false); setShowSummary(false); setRunning(false); setSim(createLive(2026, scenario)); setSelected(''); setMonster('coordinator'); setSelectedCook(false);
    setFocus(null); setResetRequest(x => x + 1);
  };
  const endDay = () => {
    if (sim.minute === 0 || ended) return;
    setRunning(false); setEnded(true); setShowSummary(true);
  };
  const selectedOrder = sim.orders.find(order => order.id === selected);
  const fault = activeKitchenFault(sim);
  const ridersWaiting = sim.orders.filter(order => order.courierArrivedAt !== null && order.pickedUpAt === null).length;
  const incidents = sim.events.filter(event => ['KITCHEN_FAULT', 'KITCHEN_REWORK', 'COURIER_DELAYED'].includes(event.type));
  const latestIncident = incidents.at(-1);
  const selectedMonster = MONSTERS.find(item => item.id === monster);
  const cook = cookState(sim.orders.filter(order => order.status === 'PREPARING').length, !!fault);
  const crew = crewActivities(sim, running);
  const job = monster ? crew[monster] : null;
  const active = sim.orders.filter(order => order.status !== 'DELIVERED').length;
  const delivered = sim.orders.filter(order => order.status === 'DELIVERED').length;
  const late = sim.orders.filter(order => (lateMinutes(order) ?? 0) > 0).length;
  const selectOrder = (id: string) => { setSelected(id); setMonster(null); setSelectedCook(false); const order = sim.orders.find(o => o.id === id); if (order) setFocus(liveZone(order.status)); };
  const selectMonster = (id: MonsterId) => {
    setMonster(id); setSelected(''); setSelectedCook(false);
    setFocus(id === 'runner' ? 'pickup' : id === 'coordinator' ? 'command' : id === 'fixer' ? 'kitchen' : id === 'trace' ? 'incident' : null);
  };
  const selectCook = () => { setSelectedCook(true); setMonster(null); setSelected(''); setFocus('kitchen'); };
  const fallback = <div className="live-fallback"><p>Vista 2D — simulação sintética</p><div className="live-order-grid">
    {sim.orders.filter(order => order.status !== 'DELIVERED').slice(0, 24).map(order =>
      <button key={order.id} className={selected === order.id ? 'active' : ''} onClick={() => selectOrder(order.id)}>{order.status === 'QUEUED' ? '📋' : order.status === 'PREPARING' ? '🍳' : order.status === 'READY' ? '📦' : '🛵'} {order.id} · {LIVE_STATUS_LABELS[order.status]}</button>)}
    {!sim.orders.length && <span>Nenhum pedido. Clique em Começar simulação.</span>}
  </div></div>;
  const use2d = mode2d || sceneFailed || lostContext;
  if (ended && showSummary) return <DaySummary sim={sim} onInspect={() => setShowSummary(false)} onNewNight={reset}/>;
  return <>
    <section className="page-heading"><div><span className="eyebrow">Seu restaurante de brinquedo, com pedidos fictícios</span><h1>Restaurante <em>vivo.</em></h1>
      <p>Veja pedidos fictícios chegando e acompanhe o trabalho simulado dos personagens.</p></div>
      <span className="live-status"><i /> {ended ? 'Noite encerrada' : running ? 'Restaurante aberto' : 'Simulação pausada'}<small>Simulação fictícia · sem IA automática</small></span></section>
    <section className="live-controls" aria-label="Controles da simulação">
      <label>Simular <select aria-label="Intensidade da noite" value={sim.scenario}
        onChange={e => chooseScenario(e.target.value as NightScenario)}>
        {(Object.keys(NIGHT_SCENARIOS) as NightScenario[]).map(id => <option key={id} value={id}>{NIGHT_SCENARIOS[id].title}</option>)}
      </select></label>
      <button className="primary" disabled={ended} onClick={() => setRunning(prev => !prev)}>{running ? '⏸ Pausar' : ended ? 'Noite encerrada' : '▶ Começar simulação'}</button>
      <button onClick={reset}>↺ {ended ? 'Começar outra noite' : 'Reiniciar'}</button>
      <label>Velocidade <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
        <option value="1">1×</option><option value="2">2×</option><option value="4">4×</option>
      </select></label>
      <button className="live-end-day" disabled={sim.minute === 0 || ended} onClick={endDay}>🌙 Encerrar dia</button>
      {ended && <button className="live-open-summary" onClick={() => setShowSummary(true)}>📊 Ver resumo do dia</button>}
      <span className="live-time">Minuto simulado: {sim.minute} / {NIGHT_END_MINUTE}</span>
      <span className="live-time-help" aria-label="Tempo restante da noite">🌙 Restam cerca de {clockLabel((NIGHT_END_MINUTE - sim.minute) * REAL_MS_PER_SIMULATED_MINUTE / speed / 1000)} na velocidade atual</span>
      <span className="tiny">{NIGHT_SCENARIOS[sim.scenario].description} · Novos pedidos até o minuto {LAST_ORDER_MINUTE} · {LIVE_CAPACITY} bancadas</span>
    </section>
    <div className="night-progress" role="progressbar" aria-label="Progresso da noite" aria-valuemin={0} aria-valuemax={NIGHT_END_MINUTE} aria-valuenow={sim.minute}>
      <span style={{ width: `${100 * sim.minute / NIGHT_END_MINUTE}%` }} />
    </div>
    <p className="night-progress-note">A noite termina automaticamente após 60 minutos simulados. Em 1×: 10 minutos reais; 2×: 5 min; 4×: 2 min e 30 s. Nos últimos 17 minutos não chegam novos pedidos: a equipe termina o que já recebeu. Pendências são mostradas separadamente.</p>
    <div className="live-now-heading"><h2>Como está o restaurante?</h2><p>Entenda a noite em um olhar. Clique num pedido ou monstrinho para saber mais.</p></div>
    <section className="live-stats" aria-label="Indicadores da simulação">
      <article><small>📦 Pedidos que chegaram</small><strong>{sim.orders.length}</strong><span>Desde o início desta noite</span></article>
      <article><small>⏳ Pedidos ainda a caminho</small><strong>{active}</strong><span>Na fila, cozinha ou entrega</span></article>
      <article><small>✅ Já entregues</small><strong>{delivered}</strong><span>Chegaram ao destino</span></article>
      <article><small>🕒 Chegaram atrasados</small><strong>{late}</strong><span>Apenas os já entregues</span></article>
      <article><small>🛵 Motoboys esperando</small><strong>{ridersWaiting}</strong><span>Já chegaram, mas não retiraram</span></article>
      <article><small>⚠️ Problemas registrados</small><strong>{incidents.length}</strong><span>Quebras, retrabalho e atrasos de motoboys</span></article>
    </section>
    <div className="live-workspace"><main className="live-world">
      {sim.minute >= LAST_ORDER_MINUTE && !ended && <div className="live-incident-banner subtle" role="status">
        🌙 Estamos finalizando a noite! Não chegam pedidos novos; a equipe continua preparando e entregando os que já recebeu.
      </div>}
      {fault && <div className="live-incident-banner" role="status">⚠️ Cozinha parada · Fixer está consertando o equipamento
        <button onClick={() => selectMonster('fixer')}>Ver Fixer trabalhando</button></div>}
      {!fault && latestIncident && sim.minute - latestIncident.minute < 5 &&
        <div className="live-incident-banner subtle" role="status">🔎 {EVENT_COPY[latestIncident.type]} · {latestIncident.orderId}
          <button onClick={() => selectMonster('trace')}>Ver registros com Trace</button></div>}
      <section className="world-card" aria-label="Restaurante em simulação"><div className="world-header"><div><span className="eyebrow">Simulação viva</span>
        <span className="world-subtitle">Arraste para girar 360° · role para zoom · clique nos pedidos e monstrinhos</span></div><span className="scene-badge">{use2d ? '2D' : '3D'} SIM</span></div>
        <nav className="zone-nav" aria-label="Foco da câmera"><button title="Girar a câmera 90 graus; também é possível arrastar para girar 360 graus" onClick={() => setRotationRequest(n => n + 1)}>↻ Girar 90°</button><button onClick={() => { setFocus(null); setResetRequest(x => x + 1); }}>Visão geral</button>
          {(['kitchen','pickup','command'] as Zone[]).map(zone => <button key={zone} onClick={() => setFocus(zone)}>{ZONE_NAMES[zone]}</button>)}</nav>
        <div className={`scene-container ${use2d ? 'fallback-active' : ''}`}>{use2d ? fallback : <ErrorBoundary onError={() => setSceneFailed(true)} fallback={fallback}>
          <Suspense fallback={<p className="scene-loading">Carregando restaurante…</p>}><RestaurantScene orders={[]} selected="" selectedMonster={monster}
            onOrder={() => {}} onMonster={selectMonster} focus={focus} onFocus={setFocus} reduced={reduced}
            events={[]} diagnostics={0} resetRequest={resetRequest} rotationRequest={rotationRequest} onContextLost={onContextLost} alerted={null}
            selectedCook={selectedCook} onCook={selectCook}
            liveOrders={sim.orders} liveMinute={sim.minute} kitchenFault={!!fault} crew={crew} simulationRunning={running} motionSpeed={speed} selectedLive={selected} onLiveOrder={selectOrder}/></Suspense></ErrorBoundary>}
          <div className="world-caption"><span className="world-dot"/>{active} pedidos ativos · {ridersWaiting} motoboys aguardando<span>Movimento operacional dirigido por regras simuladas</span></div></div>
        <div className="live-visual-legend" aria-label="Como reconhecer os pedidos"><span>📋 Comandas: aguardando</span><span>🍳 Panelas: preparando</span><span>📦 Sacolas: prontas</span></div>
        <div className="world-options"><label><input type="checkbox" checked={reduced} onChange={e=>setReduced(e.target.checked)}/> Reduzir movimento</label>
          <button onClick={()=>setMode2d(v=>!v)}>{mode2d ? 'Voltar ao 3D' : 'Usar vista 2D'}</button></div></section>
      <section className="live-crew"><h2>👾 Quem está fazendo o quê?</h2><p>Clique em cada ajudante para ver sua tarefa. O cozinheiro é um funcionário visual, não um agente de IA.</p>
        <div className="crew-list">{MONSTERS.map(item => <button key={item.id} className={monster === item.id ? 'active' : ''}
          onClick={() => selectMonster(item.id)}><span className={`mini-monster ${item.id}`} style={{ background: item.color }}><i/><i/></span>
          <strong>{item.name}</strong><small>{crew[item.id].title}</small><span className={`crew-chip ${crew[item.id].busy ? 'working' : 'idle'}`}>{crew[item.id].busy ? 'Em atividade' : 'Em espera'}</span></button>)}
          <button className={selectedCook ? 'active' : ''} onClick={selectCook}><span className="mini-monster chef" style={{ background: '#e7a36d' }}><i/><i/></span>
            <strong>Cozinheiro</strong><small>{cook.title}</small><span className={`crew-chip ${cook.mode !== 'idle' ? 'working' : 'idle'}`}>{cook.mode === 'fault' ? 'Aguardando reparo' : cook.mode === 'cooking' ? 'Cozinhando' : 'Em espera'}</span></button></div></section>
      <section className="live-log"><h2>📣 Últimas novidades</h2><p className="live-explain">Toque em um acontecimento para encontrar o pedido.</p><div className="live-feed" role="log" aria-label="Eventos sintéticos recentes">
        {sim.events.slice(-10).reverse().map(event => <button key={event.seq} onClick={() => selectOrder(event.orderId)}>
          <span>Min {event.minute}</span> <strong>{event.orderId}</strong> — {EVENT_COPY[event.type]}</button>)}
        {!sim.events.length && <p>Inicie a simulação para acompanhar o primeiro pedido.</p>}</div></section>
    </main><aside className="live-details">
      <section className="live-detail-card live-worker-detail" aria-live="polite">
        <span className="eyebrow">Conheça seu ajudante</span><h2>{selectedCook ? 'Cozinheiro' : selectedMonster?.name ?? 'Escolha um ajudante'}</h2>
        <div className="live-speech"><strong>{selectedCook ? cook.title : job?.title ?? 'Escolha um ajudante para descobrir sua tarefa.'}</strong>
          <p>{selectedCook ? cook.message : job?.message ?? 'Eu mostro aqui o que está acontecendo comigo na simulação.'}</p></div>
        {job?.orderId && <button className="primary" onClick={() => selectOrder(job.orderId!)}>📦 Ver pedido {job.orderId}</button>}
        {monster === 'trace' && <div className="live-trace-evidence"><strong>Últimos eventos registrados</strong>
          {sim.events.filter(e => !job?.orderId || e.orderId === job.orderId).slice(-6).reverse()
            .map(e => <p key={e.seq}>Min {e.minute} · {e.orderId}: {EVENT_COPY[e.type]}</p>)}
          {!sim.events.length && <p>Nenhum evento registrado ainda.</p>}</div>}
        {selectedMonster && <p className="live-role-note">{selectedMonster.role} · Trabalho simulado por regras, sem uso de IA nesta tela.</p>}
        {selectedCook && <p className="live-role-note">Funcionário da cozinha · Personagem visual guiado pela simulação, sem agente de IA.</p>}
      </section>
      <section className="live-detail-card"><span className="eyebrow">📦 Entenda este pedido</span><h2>{selectedOrder?.id ?? 'Escolha um pedido'}</h2>
        {selectedOrder ? <div className="live-order-info"><p className="live-order-story">{describeOrder(selectedOrder, sim.minute, !!fault)}</p><p><strong>Agora: {LIVE_STATUS_LABELS[selectedOrder.status]}</strong></p>
          <p>O pedido chegou no minuto {selectedOrder.createdAt}. A entrega foi prometida até o minuto {selectedOrder.promisedAt}.</p>
          <p>Motoboy: {selectedOrder.courierArrivedAt === null ? `a chegada está prevista para o minuto ${selectedOrder.courierAt}` :
            selectedOrder.pickedUpAt === null ? 'já chegou e está aguardando a retirada' : 'já pegou o pedido'}</p>
          {selectedOrder.courierDelayMinutes > 0 && <p>O motoboy chegou {selectedOrder.courierDelayMinutes} min depois do previsto.</p>}
          <p>Rota fictícia de entrega: {selectedOrder.routeKm.toFixed(1)} km, velocidade média simulada de {selectedOrder.courierSpeedKmh} km/h.</p>
          {selectedOrder.reworkReported && <p>A cozinha precisou refazer a comida (+{selectedOrder.reworkMinutes} min).</p>}
          {waitMinutes(selectedOrder) !== null && <p>O motoboy esperou {waitMinutes(selectedOrder)} minutos até retirar o pedido.</p>}
          {lateMinutes(selectedOrder) !== null && <p>O atraso ao chegar foi de {lateMinutes(selectedOrder)} minutos.</p>}</div>
          : <p>Clique em uma comanda, panela ou sacola no restaurante — ou em algum pedido da lista — para acompanhar o caminho da comida.</p>}</section>
      <section className="live-detail-card"><h2>🧾 Acompanhe os pedidos</h2><p className="live-explain">Escolha um pedido para saber onde está a comida.</p><div className="live-order-list">
        {sim.orders.slice(-18).reverse().map(order => <button key={order.id} className={selected === order.id ? 'active' : ''}
          onClick={() => selectOrder(order.id)}><span>{order.id}</span><small>{LIVE_STATUS_LABELS[order.status]}</small></button>)}
        {!sim.orders.length && <p>Aguardando novos pedidos.</p>}</div></section>
    </aside></div>
    <p className="live-disclaimer">Simulação fictícia baseada em regras, sem conexão com iFood ou pedidos reais. Não altera as evidências históricas. Os cinco monstrinhos reagem por regras; Scout sinaliza ocorrências, Trace lê registros e Fixer faz reparos simulados. Nenhuma IA/LLM é executada neste modo; o histórico auditado continua preservado no código.</p>
  </>;
}
