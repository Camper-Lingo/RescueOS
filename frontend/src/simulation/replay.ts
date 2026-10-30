import type { Frame, Order, Rational, ReplayResponse } from '../types/api.ts';

export type Zone = 'kitchen' | 'pickup' | 'incident' | 'command' | 'entrance' | 'exit';
export const ZONE_NAMES: Record<Zone, string> = {
  kitchen: 'Cozinha', pickup: 'Retirada', incident: 'Evidências', command: 'Operações', entrance: 'Entrada', exit: 'Despacho',
};
export const ZONE_POSITIONS: Record<Zone, [number, number, number]> = {
  kitchen: [-2.7, 0, -1.7], pickup: [2.4, 0, -1.2], incident: [-2.9, 0, 2.2],
  command: [2.5, 0, 2.5], entrance: [0, 0, 2.2], exit: [3.6, 0, 0.8],
};
export const EVENT_LABELS: Record<string, string> = {
  ORDER_CREATED: 'Pedido criado', KITCHEN_STARTED: 'Preparo iniciado', KITCHEN_READY: 'Cozinha pronta',
  COURIER_ASSIGNED: 'Entregador associado', COURIER_ARRIVED: 'Entregador chegou', PICKED_UP: 'Pedido coletado',
  DELIVERED: 'Pedido entregue', ORDER_CANCELLED: 'Pedido cancelado',
  RESTAURANT_CAPACITY_UPDATED: 'Capacidade registrada', PROMOTION_STARTED: 'Promoção registrada',
};
export const STATUS_LABELS: Record<string, string> = {
  CREATED: 'Criado', PREPARING: 'Em preparo', READY: 'Pronto', PICKED_UP: 'Coletado',
  DELIVERED: 'Entregue', CANCELLED: 'Cancelado',
};
export const METRIC_LABELS: Record<string, string> = {
  delivery_deviation: 'Desvio da entrega', delivery_delay: 'Atraso na entrega', delivery_earliness: 'Antecedência',
  kitchen_delay: 'Atraso na cozinha', courier_waiting_time: 'Espera do entregador',
};

export function rationalText(value: Rational | number | null): string {
  if (value === null) return 'Indisponível';
  if (typeof value === 'number') return String(value);
  const n = BigInt(value.numerator), d = BigInt(value.denominator);
  if (d <= 0n) throw new Error('Denominador inválido.');
  return d === 1n ? String(n) : `${n}/${d}`;
}
export function isPositive(value: Rational | null): boolean { return value !== null && BigInt(value.numerator) > 0n; }
export function eventZone(type: string): Zone {
  if (type.startsWith('KITCHEN')) return 'kitchen';
  if (['COURIER_ASSIGNED', 'COURIER_ARRIVED', 'PICKED_UP'].includes(type)) return 'pickup';
  if (type === 'DELIVERED') return 'exit';
  if (type === 'ORDER_CANCELLED') return 'incident';
  if (type === 'ORDER_CREATED') return 'entrance';
  return 'command';
}
export function visualOrder(order: Order): { zone: Zone; uncertain: boolean; color: string } {
  const uncertain = order.status === null || order.resolution === 'AMBIGUOUS' || order.evidence_quality === 'INCOMPLETE';
  if (order.status === null || order.resolution === 'AMBIGUOUS') return { zone: 'incident', uncertain: true, color: '#b8a0f4' };
  const zones: Record<string, Zone> = { CREATED: 'entrance', PREPARING: 'kitchen', READY: 'pickup', PICKED_UP: 'exit', DELIVERED: 'exit', CANCELLED: 'incident' };
  const color = uncertain ? '#efbd68' : order.status === 'CANCELLED' ? '#ee8a80'
    : isPositive(order.metrics.delivery_delay?.value ?? null) ? '#efbd68' : '#90d9ba';
  return { zone: zones[order.status] ?? 'command', uncertain, color };
}

export function frameAt(replay: ReplayResponse, elapsedUs: bigint): Frame {
  let lo = 0, hi = replay.events.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (BigInt(replay.events[mid].elapsed_us) <= elapsedUs) lo = mid + 1; else hi = mid; }
  return replay.frames[lo];
}
export interface Cursor { index: number; elapsedUs: bigint; playing: boolean; speed: number }
export function seek(replay: ReplayResponse, index: number, previous: Cursor): Cursor {
  const bounded = Math.max(0, Math.min(replay.events.length, index));
  return { ...previous, index: bounded, elapsedUs: bounded ? BigInt(replay.events[bounded - 1].elapsed_us) : 0n, playing: false };
}
export function advance(replay: ReplayResponse, cursor: Cursor, realMilliseconds: number): Cursor {
  if (!cursor.playing || !replay.events.length) return cursor;
  const duration = BigInt(replay.duration_us);
  const next = cursor.elapsedUs + BigInt(Math.max(0, Math.round(realMilliseconds * 300_000 * cursor.speed)));
  const elapsedUs = next > duration ? duration : next;
  return { ...cursor, elapsedUs, index: frameAt(replay, elapsedUs).index, playing: next < duration };
}
