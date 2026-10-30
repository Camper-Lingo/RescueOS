import type { Cursor } from '../simulation/replay.ts';
import { EVENT_LABELS } from '../simulation/replay.ts';
import type { ReplayResponse } from '../types/api.ts';

export default function Timeline({ replay, cursor, jump, speed, toggle }: {
  replay: ReplayResponse; cursor: Cursor; jump: (index: number) => void; speed: (value: number) => void; toggle: () => void;
}) {
  const current = replay.events[cursor.index - 1];
  return <section className="timeline" aria-label="Replay temporal">
    <div className="timeline-heading"><div><span className="eyebrow">Replay de eventos</span>
      <h2>{current ? EVENT_LABELS[current.type] ?? current.type : 'Antes do primeiro evento'}</h2></div>
      <div className="event-time"><strong>{current?.occurred_at.slice(11, 19) ?? '—'}</strong><span>{current?.occurred_at.slice(0, 10)} {current?.occurred_at.slice(19)}</span></div></div>
    <label className="sr-only" htmlFor="replay-position">Posição na timeline</label>
    <input id="replay-position" type="range" min="0" max={replay.events.length} step="1" value={cursor.index}
      onChange={event => jump(Number(event.target.value))} aria-valuetext={`${cursor.index} de ${replay.events.length} eventos`} />
    <div className="timeline-controls"><div className="transport">
      <button aria-label="Reiniciar replay" title="Reiniciar" onClick={() => jump(0)}>↺</button>
      <button aria-label="Evento anterior" disabled={cursor.index === 0} onClick={() => jump(cursor.index - 1)}>❮</button>
      <button className="play" disabled={!replay.events.length} aria-label={cursor.playing ? 'Pausar replay' : 'Reproduzir replay'} onClick={toggle}>{cursor.playing ? 'Ⅱ' : '▶'}<span>{cursor.playing ? 'Pausar' : 'Reproduzir'}</span></button>
      <button aria-label="Próximo evento" disabled={cursor.index === replay.events.length} onClick={() => jump(cursor.index + 1)}>❯</button>
      <label className="speed">Velocidade <select aria-label="Velocidade do replay" value={cursor.speed} onChange={event => speed(Number(event.target.value))}>
        <option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
    </div><span className="micro muted" data-testid="frame-index">{cursor.index} / {replay.events.length} eventos · {replay.compression}</span></div>
    <details className="all-events"><summary>Explorar os {replay.events.length} eventos registrados</summary>
      <div className="event-strip">{replay.events.map((event, index) => <button className={cursor.index === index + 1 ? 'active' : ''}
        key={event.event_id} onClick={() => jump(index + 1)} aria-label={`Ir para evento ${event.event_id}`}>
        <time>{event.occurred_at.slice(11, 19)}</time><strong>{EVENT_LABELS[event.type] ?? event.type}</strong>
        <small>{event.event_id} · {event.order_id ?? 'Contexto operacional'}</small></button>)}</div></details>
  </section>;
}
