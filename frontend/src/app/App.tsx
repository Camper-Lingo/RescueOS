import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { ApiError, loadBundle } from '../api/client.ts';
import type { Bundle } from '../types/api.ts';
import { ZONE_NAMES, eventZone, rationalText, visualOrder } from '../simulation/replay.ts';
import type { Zone } from '../simulation/replay.ts';
import { useReplay } from '../simulation/useReplay.ts';
import { MONSTERS } from '../scene/characters/roster.ts';
import type { MonsterId } from '../scene/characters/roster.ts';
import OrderDetails from '../components/OrderDetails.tsx';
import Timeline from '../components/Timeline.tsx';
import FallbackWorld from '../components/FallbackWorld.tsx';
import ErrorBoundary from '../components/ErrorBoundary.tsx';

const RestaurantScene = lazy(() => import('../scene/RestaurantScene.tsx'));
let webgl: boolean | undefined;
function supportsWebGL() {
  if (webgl !== undefined) return webgl;
  try {
    const canvas = document.createElement('canvas'), context = canvas.getContext('webgl2');
    webgl = !!context;
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webgl = false; }
  return webgl;
}
function Brand() {
  return <header className="topbar"><a className="brand" href="/" aria-label="RescueOS início"><span className="brand-mark">R<span>•</span></span>
    <span>Rescue<span className="brand-os">OS</span></span></a><span className="brand-divider" /><div className="experience">The Living Restaurant<span>CONTROL TOWER / 5A</span></div>
    <div className="topbar-tags"><span className="demo-badge"><i /> Demo Mode</span><span className="synthetic">Cenário sintético</span></div></header>;
}
function Experience({ bundle }: { bundle: Bundle }) {
  const { replay } = bundle;
  const controller = useReplay(replay), { frame, cursor, jump } = controller;
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get('order') ?? (bundle.orders.orders.some(order => order.order_id === 'ord-1002') ? 'ord-1002' : bundle.orders.orders[0]?.order_id ?? ''));
  const [monster, setMonster] = useState<MonsterId | null>(null), [focus, setFocus] = useState<Zone | null>(null);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [mode2d, setMode2d] = useState(() => new URLSearchParams(location.search).get('view') === '2d');
  const [lostContext, setLostContext] = useState(false);
  const [sceneFailed, setSceneFailed] = useState(false), [resetRequest, setResetRequest] = useState(0);
  const available3d = supportsWebGL();
  const contextLost = useCallback(() => setLostContext(true), []);
  const sceneError = useCallback(() => setSceneFailed(true), []);
  const use2d = mode2d || !available3d || lostContext || sceneFailed;
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(preference.matches);
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);
  const order = frame.orders.find(candidate => candidate.order_id === selected);
  const selectOrder = (id: string) => {
    setSelected(id); setMonster(null);
    const current = frame.orders.find(candidate => candidate.order_id === id);
    if (current) setFocus(visualOrder(current).zone);
  };
  const showEvent = (id: string) => {
    const index = replay.events.findIndex(event => event.event_id === id);
    if (index >= 0) { jump(index + 1); setFocus(eventZone(replay.events[index].type)); }
  };
  const fallback = <FallbackWorld orders={frame.orders} selected={selected} onOrder={selectOrder}
    reason={sceneFailed ? 'Não foi possível carregar a cena 3D. Continue usando os dados e controles abaixo.'
      : !available3d || lostContext ? 'WebGL indisponível neste dispositivo. A navegação e as evidências continuam disponíveis.' : 'Alternativa acessível selecionada.'} />;
  const roles = MONSTERS.find(candidate => candidate.id === monster);
  return <>
    <section className="page-heading"><div><span className="eyebrow">Uma operação. Cada evento conta.</span><h1>Seu restaurante, <em>vivo.</em></h1>
      <p>Explore o percurso dos pedidos. Encontre a evidência por trás de cada número.</p></div>
      <span className="live-status"><i /> API conectada <small>Snapshot {replay.snapshot_id.slice(0, 8)}</small></span></section>
    <section className="kpis" aria-label="Indicadores do instante selecionado">{[
      ['total_created', 'Pedidos criados', '▣'], ['total_delivered', 'Entregues', '↗'],
      ['total_cancelled', 'Cancelados', '⊘'], ['delay_rate', 'Taxa de atraso', '◷'],
    ].map(([key, label, symbol]) => {
      const aggregate = frame.overview.aggregates[key];
      return <article key={key} data-testid={`kpi-${key}`}><span className="kpi-icon">{symbol}</span><div><span>{label}</span>
        <strong>{rationalText(aggregate?.value ?? null)}</strong><small>{aggregate?.evidence_quality ?? 'Sem evidência'}{aggregate?.denominator !== null && aggregate?.denominator !== undefined ? ` · ${aggregate.numerator}/${aggregate.denominator}` : ''}</small></div></article>;
    })}</section>
    {!replay.events.length && <div className="empty-state" role="status"><strong>Nenhum evento disponível</strong><span>O snapshot está vazio. Nenhum pedido ou métrica foi criado artificialmente.</span></div>}
    <div className="workspace"><main className="world-column">
      <section className="world-card" aria-label="Mundo do restaurante"><div className="world-header"><div><span className="eyebrow">The Living Restaurant</span>
        <span className="world-subtitle">Visão isométrica · operação demonstrativa</span></div><span className="scene-badge">{use2d ? '2D' : '3D'} WORLD</span></div>
        <nav className="zone-nav" aria-label="Focar câmera"><button className={focus === null ? 'active' : ''} onClick={() => { setFocus(null); setResetRequest(request => request + 1); }}>Visão geral</button>
          {(['kitchen', 'pickup', 'incident', 'command'] as Zone[]).map(zone => <button key={zone} className={focus === zone ? 'active' : ''}
            onClick={() => setFocus(zone)}>{ZONE_NAMES[zone]}</button>)}</nav>
        <div className={`scene-container ${use2d ? 'fallback-active' : ''}`}>{use2d ? fallback : <ErrorBoundary fallback={fallback} onError={sceneError}><Suspense fallback={<div className="scene-loading">Preparando o mundo 3D…</div>}>
          <RestaurantScene orders={frame.orders} selected={selected} selectedMonster={monster} onOrder={selectOrder} onMonster={setMonster}
            focus={focus} onFocus={setFocus} reduced={reduced} events={replay.events} diagnostics={bundle.diagnostics.diagnostics.length}
            resetRequest={resetRequest} onContextLost={contextLost} /></Suspense></ErrorBoundary>}
          <div className="world-caption"><span className="world-dot" /> {frame.orders.length} pedidos neste instante <span>Arraste para orbitar · scroll para aproximar</span></div>
        </div>
        <div className="world-options"><label><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)} /> Reduzir movimento</label>
          {sceneFailed || lostContext ? <button onClick={() => location.reload()}>Recarregar cena 3D</button>
            : <button onClick={() => setMode2d(!mode2d)}>{mode2d ? 'Voltar à vista 3D' : 'Usar vista 2D'}</button>}</div>
      </section>
      <section className="crew"><div className="section-heading"><span className="eyebrow">Conheça a equipe</span><span className="tiny">Mascotes demonstrativos · sem execução de IA</span></div>
        <div className="crew-list">{MONSTERS.map(character => <button key={character.id} className={monster === character.id ? 'active' : ''}
          onClick={() => { setMonster(monster === character.id ? null : character.id); setFocus(character.id === 'trace' ? 'incident' : character.id === 'fixer' ? 'kitchen' : character.id === 'runner' ? 'pickup' : 'command'); }}>
          <span className={`mini-monster ${character.id}`} style={{ background: character.color }}><i /><i /></span><strong>{character.name}</strong><small>{character.role}</small></button>)}</div>
        {roles && <div className="crew-description" role="status"><strong>{roles.name}</strong><span>{roles.description}</span><button aria-label="Fechar papel do mascote" onClick={() => setMonster(null)}>×</button></div>}
      </section>
      <Timeline replay={replay} {...controller} />
    </main><aside className="detail-column" aria-label="Pedidos e evidências">
      <div className="orders-heading"><span className="eyebrow">Seus pedidos</span><span className="count">{bundle.orders.orders.length}</span></div>
      <nav className="order-tabs" aria-label="Selecionar pedido">{bundle.orders.orders.map(candidate => <button key={candidate.order_id}
        aria-pressed={selected === candidate.order_id} className={selected === candidate.order_id ? 'active' : ''} onClick={() => selectOrder(candidate.order_id)}>{candidate.order_id}</button>)}</nav>
      <OrderDetails key={selected} order={order} selected={selected} known={bundle.orders.orders.some(candidate => candidate.order_id === selected)} events={replay.events} onEvent={showEvent} />
    </aside></div>
    <section className="audit"><details><summary>Diagnósticos do snapshot <span>{bundle.diagnostics.diagnostics.length}</span></summary>
      <p className="micro muted">Auditoria do arquivo completo, conhecida desde o início do replay. Conflitos excluídos não são reinseridos em quadros anteriores.</p>
      {!bundle.diagnostics.diagnostics.length && <p>Nenhum diagnóstico registrado neste arquivo.</p>}
      {bundle.diagnostics.diagnostics.map((diagnostic, index) => <details key={`${diagnostic.code}-${index}`}><summary>{diagnostic.code} · {diagnostic.event_id ?? diagnostic.order_id ?? 'Arquivo'}</summary><pre>{JSON.stringify(diagnostic, null, 2)}</pre></details>)}
    </details></section>
    <footer><span>RescueOS <b>/</b> The Living Restaurant</span><p>Dados sintéticos. Movimentos de idle e patrulha são decorativos; estados e métricas vêm dos eventos. Nenhuma previsão, aprovação ou ação de IA é executada.</p>
      <span className="tiny">READ ONLY · STAGE 5A</span></footer>
    <span className="sr-only" aria-live="polite">{cursor.index} eventos exibidos. {order ? `${order.order_id}: ${order.status ?? 'indeterminado'}` : 'Sem projeção de pedido'}</span>
  </>;
}

export default function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null), [error, setError] = useState<Error | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError(null); setBundle(null);
    loadBundle(controller.signal).then(setBundle).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure : new Error('Resposta desconhecida.'));
    });
    return () => controller.abort();
  }, [attempt]);
  const retry = () => setAttempt(value => value + 1);
  const unexpected = <main className="connection-state" role="alert"><h1>Não foi possível exibir o cenário</h1>
    <p>Ocorreu uma falha inesperada na interface. Tente carregar os dados novamente.</p><button className="primary" onClick={retry}>Tentar novamente</button></main>;
  return <div className="app-shell"><Brand />{bundle ? <ErrorBoundary key={attempt} fallback={unexpected}><Experience bundle={bundle} /></ErrorBoundary> : <main className="connection-state" aria-live="polite">
    <span className={`connection-orb ${error ? 'failed' : ''}`}>{error ? '!' : 'R'}</span>
    <span className="eyebrow">THE LIVING RESTAURANT</span><h1>{error ? error instanceof ApiError && error.kind === 'offline' ? 'API offline' : 'Não foi possível carregar o cenário' : 'Acendendo as luzes…'}</h1>
    <p>{error ? error.message : 'Carregando o snapshot de eventos, pedidos e evidências.'}</p>
    {error && <><p className="muted">Verifique o backend local em 127.0.0.1:8000.</p><button className="primary" onClick={retry}>Tentar novamente</button></>}
  </main>}</div>;
}
