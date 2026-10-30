import type { Order } from '../types/api.ts';
import type { Zone } from '../simulation/replay.ts';
import { STATUS_LABELS, ZONE_NAMES, visualOrder } from '../simulation/replay.ts';

export default function FallbackWorld({ orders, selected, onOrder, reason }: {
  orders: Order[]; selected: string; onOrder: (id: string) => void; reason: string;
}) {
  return <div className="fallback-world" data-testid="fallback-world"><div className="fallback-note"><strong>Vista operacional 2D</strong><span>{reason}</span></div>
    <div className="zone-grid">{(['kitchen', 'pickup', 'incident', 'exit'] as Zone[]).map(zone => <section className={`zone-cell ${zone}`} key={zone}>
      <span className="zone-symbol">{({ kitchen: '♨', pickup: '▣', incident: '⌕', exit: '↗' })[zone as 'kitchen' | 'pickup' | 'incident' | 'exit']}</span>
      <h3>{ZONE_NAMES[zone]}</h3>
      {orders.filter(order => visualOrder(order).zone === zone || zone === 'pickup' && visualOrder(order).zone === 'entrance').map(order => <button
        className={selected === order.order_id ? 'selected' : ''} key={order.order_id} onClick={() => onOrder(order.order_id)}>
        {order.order_id}<small>{STATUS_LABELS[order.status ?? ''] ?? 'Indeterminado'} · {order.evidence_quality}</small></button>)}
    </section>)}</div><p className="micro muted">Mesmos eventos, métricas e controles do modo 3D. Nenhum estado é inferido pela animação.</p></div>;
}
