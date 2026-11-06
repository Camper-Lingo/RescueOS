/** Resumo de uma simulação sintética ENCERRADA. Nenhum valor é estimado por LLM. */
import type { LiveEvent, LiveOrder, LiveState } from './live.ts';
import { lateMinutes, waitMinutes } from './live.ts';

export interface DaySummaryData {
  received: number;
  delivered: number;
  inProgress: number;
  queued: number;
  preparing: number;
  ready: number;
  onTime: number;
  late: number;
  onTimePercent: number | null;
  averageCourierWait: number | null;
  waitingCouriers: number;
  faults: number;
  faultsFixed: number;
  reworks: number;
  courierDelays: number;
  incidentCount: number;
  recentIncidents: LiveEvent[];
}

const INCIDENT_TYPES = new Set<LiveEvent['type']>(['KITCHEN_FAULT', 'KITCHEN_REWORK', 'COURIER_DELAYED']);

export function buildDaySummary(state: LiveState): DaySummaryData {
  const completed = state.orders.filter(order => order.status === 'DELIVERED');
  const late = completed.filter(order => (lateMinutes(order) ?? 0) > 0).length;
  const waits = state.orders.map(waitMinutes).filter((duration): duration is number => duration !== null);
  const incidentEvents = state.events.filter(event => INCIDENT_TYPES.has(event.type));
  return {
    received: state.orders.length,
    delivered: completed.length,
    inProgress: state.orders.length - completed.length,
    queued: state.orders.filter(order => order.status === 'QUEUED').length,
    preparing: state.orders.filter(order => order.status === 'PREPARING').length,
    ready: state.orders.filter(order => order.status === 'READY').length,
    onTime: completed.length - late,
    late,
    onTimePercent: completed.length ? Math.round(100 * (completed.length - late) / completed.length) : null,
    averageCourierWait: waits.length ? Math.round(waits.reduce((sum, wait) => sum + wait, 0) / waits.length) : null,
    waitingCouriers: state.orders.filter(order => order.courierArrivedAt !== null && order.pickedUpAt === null).length,
    faults: state.incidents.length,
    faultsFixed: state.incidents.filter(incident => incident.resolvedAt !== null).length,
    reworks: state.events.filter(event => event.type === 'KITCHEN_REWORK').length,
    courierDelays: state.events.filter(event => event.type === 'COURIER_DELAYED').length,
    incidentCount: incidentEvents.length,
    recentIncidents: incidentEvents.slice(-6).reverse(),
  };
}

export function describeOrder(order: LiveOrder, minute: number, kitchenStopped: boolean): string {
  switch (order.status) {
    case 'QUEUED': return 'O pedido chegou, mas ainda está esperando a cozinha começar.';
    case 'PREPARING': return kitchenStopped
      ? 'O preparo está parado por uma falha na cozinha. O Fixer está fazendo um reparo simulado.'
      : 'A cozinha está preparando a comida.';
    case 'READY': return order.courierArrivedAt === null
      ? 'A comida está pronta. Estamos esperando o motoboy chegar.'
      : 'A comida está pronta e o motoboy já chegou. Falta entregar o pacote para ele.';
    case 'PICKED_UP': return minute > order.promisedAt
      ? 'O motoboy está levando o pedido. O prazo prometido já passou.'
      : 'O motoboy retirou o pedido e está fazendo a entrega.';
    case 'DELIVERED': {
      const delay = lateMinutes(order) ?? 0;
      return delay ? `A comida foi entregue ${delay} min depois do prazo prometido.` : 'A comida chegou dentro do prazo prometido.';
    }
  }
}
