/** Simulador SINTÉTICO com cenários e incidentes reproduzíveis.
 * Não altera eventos auditados, nem executa ferramentas/LLM.
 */
export type NightScenario = 'quiet' | 'medium' | 'busy';
export const NIGHT_SCENARIOS: Record<NightScenario, { title: string; description: string; arrival: number; rework: number; courierDelay: number }> = {
  quiet: { title: 'Noite vazia', description: 'Poucos pedidos, quase nenhum contratempo.', arrival: .16, rework: 0, courierDelay: 0 },
  medium: { title: 'Noite média', description: 'Movimento equilibrado e alguns imprevistos.', arrival: .27, rework: .06, courierDelay: .08 },
  busy: { title: 'Noite cheia', description: 'Muitos pedidos, atrasos, retrabalho e equipamento com defeito.', arrival: .50, rework: .25, courierDelay: .30 },
};
export type LiveStatus = 'QUEUED' | 'PREPARING' | 'READY' | 'PICKED_UP' | 'DELIVERED';
export type LiveEventType = 'ORDER_CREATED' | 'KITCHEN_STARTED' | 'KITCHEN_READY' | 'COURIER_ARRIVED'
  | 'PICKED_UP' | 'DELIVERED' | 'COURIER_DELAYED' | 'KITCHEN_REWORK'
  | 'KITCHEN_FAULT' | 'KITCHEN_REPAIRED';
export interface LiveOrder {
  id: string;
  createdAt: number;
  prepMinutes: number;
  /** Previsão original da chegada do motoboy; courierAt é a chegada efetiva planejada. */
  courierDueAt: number;
  courierAt: number;
  courierArrivedAt: number | null;
  courierDelayMinutes: number;
  deliveryMinutes: number;
  routeKm: number;
  courierSpeedKmh: number;
  promisedAt: number;
  startedAt: number | null;
  workedMinutes: number;
  reworkMinutes: number;
  reworkReported: boolean;
  readyAt: number | null;
  pickedUpAt: number | null;
  deliveredAt: number | null;
  status: LiveStatus;
}
export interface LiveEvent { seq: number; minute: number; orderId: string; type: LiveEventType }
export interface KitchenIncident { id: string; orderId: string; openedAt: number; resolvedAt: number | null }
export interface LiveState {
  minute: number; seed: number; nextId: number; scenario: NightScenario;
  orders: LiveOrder[]; events: LiveEvent[]; incidents: KitchenIncident[];
}
export const LIVE_CAPACITY = 2;
export const LIVE_MAX_ORDERS = 60;
/** Aos 43 minutos deixam de entrar novos pedidos; os últimos 17 min são de fechamento gradual. */
export const LAST_ORDER_MINUTE = 43;
const NEXT = 1664525;
const OFFSET = 1013904223;
function draw(seed: number): [number, number] {
  const next = (Math.imul(seed, NEXT) + OFFSET) >>> 0;
  return [next, next / 0x100000000];
}
export function createLive(seed = 2026, scenario: NightScenario = 'medium'): LiveState {
  if (!Number.isSafeInteger(seed)) throw new Error('Semente inválida.');
  if (!Object.hasOwn(NIGHT_SCENARIOS, scenario)) throw new Error('Cenário inválido.');
  return { minute: 0, seed: seed >>> 0, nextId: 1, scenario, orders: [], events: [], incidents: [] };
}
export function waitMinutes(order: LiveOrder): number | null {
  return order.pickedUpAt === null || order.courierArrivedAt === null
    ? null : Math.max(0, order.pickedUpAt - order.courierArrivedAt);
}
export function lateMinutes(order: LiveOrder): number | null {
  return order.deliveredAt === null ? null : Math.max(0, order.deliveredAt - order.promisedAt);
}
export function activeKitchenFault(state: LiveState): KitchenIncident | undefined {
  return state.incidents.find(incident => incident.resolvedAt === null);
}
function oneMinute(current: LiveState): LiveState {
  const minute = current.minute + 1;
  let seed = current.seed;
  const orders = current.orders.map(order => ({ ...order }));
  const events = current.events.slice();
  const incidents = current.incidents.map(incident => ({ ...incident }));
  const record = (orderId: string, type: LiveEventType) => events.push({ seq: events.length + 1, minute, orderId, type });
  const settings = NIGHT_SCENARIOS[current.scenario];
  let chance: number;
  [seed, chance] = draw(seed);
  if (minute <= LAST_ORDER_MINUTE && current.nextId <= LIVE_MAX_ORDERS && (minute === 1 || chance < settings.arrival)) {
    let p: number, c: number, d: number, deadline: number, reworkRoll: number, courierRoll: number;
    [seed, p] = draw(seed); [seed, c] = draw(seed); [seed, d] = draw(seed);
    [seed, deadline] = draw(seed); [seed, reworkRoll] = draw(seed); [seed, courierRoll] = draw(seed);
    const reworkMinutes = current.scenario === 'busy' && current.nextId === 2 ? 3 : reworkRoll < settings.rework ? 3 : 0;
    const courierDelayMinutes = current.scenario === 'busy' && current.nextId === 1 ? 5 : courierRoll < settings.courierDelay ? 4 : 0;
    const prepMinutes = 3 + Math.floor(p * 6);
    // Distância e velocidade são inteiramente sintéticas, mas a duração sai de unidades reais.
    const routeKm = Math.round((1.1 + d * 1.9) * 10) / 10;
    const courierSpeedKmh = current.scenario === 'busy' ? 28 : current.scenario === 'medium' ? 32 : 36;
    const deliveryMinutes = Math.max(3, Math.ceil(routeKm / courierSpeedKmh * 60) + 1);
    const courierDueAt = minute + Math.max(3, prepMinutes - 2) + Math.floor(c * 5);
    // Estimativa da fila conhecida no momento do pedido: prazo realista, não retroativo.
    const pendingKitchenWork = orders.filter(o => o.status === 'QUEUED' || o.status === 'PREPARING')
      .reduce((total, o) => total + Math.max(0, o.prepMinutes + o.reworkMinutes - o.workedMinutes), 0);
    const estimatedWait = Math.max(0, Math.ceil(pendingKitchenWork / LIVE_CAPACITY) - 2);
    const order: LiveOrder = {
      id: `sim-${String(current.nextId).padStart(3, '0')}`, createdAt: minute,
      prepMinutes, courierDueAt, courierAt: courierDueAt + courierDelayMinutes,
      courierArrivedAt: null, courierDelayMinutes,
      deliveryMinutes, routeKm, courierSpeedKmh, promisedAt: minute + prepMinutes + deliveryMinutes + 4 + Math.floor(deadline * 9) + Math.round(estimatedWait * .55),
      startedAt: null, workedMinutes: 0, reworkMinutes, reworkReported: false,
      readyAt: null, pickedUpAt: null, deliveredAt: null, status: 'QUEUED',
    };
    orders.push(order); record(order.id, 'ORDER_CREATED');
  }

  // Em noites cheias a cozinha sofre uma falha previsível; Fixer a repara em quatro minutos.
  // Durante a falha o preparo realmente para (não é só uma animação).
  const currentFault = incidents.find(incident => incident.resolvedAt === null);
  if (currentFault && minute >= currentFault.openedAt + 4) {
    currentFault.resolvedAt = minute;
    record(currentFault.orderId, 'KITCHEN_REPAIRED');
  }
  if (current.scenario === 'busy' && minute === 6 && !incidents.some(i => i.resolvedAt === null)) {
    const related = orders.find(order => order.status === 'PREPARING') ?? orders[0];
    if (related) {
      incidents.push({ id: `fault-${minute}`, orderId: related.id, openedAt: minute, resolvedAt: null });
      record(related.id, 'KITCHEN_FAULT');
    }
  }
  const blocked = incidents.some(incident => incident.resolvedAt === null);
  let kitchen = orders.filter(order => order.status === 'PREPARING').length;
  for (const order of orders) {
    if (order.status === 'QUEUED' && kitchen < LIVE_CAPACITY && !blocked) {
      order.startedAt = minute; order.status = 'PREPARING'; kitchen++;
      record(order.id, 'KITCHEN_STARTED');
    }
    if (order.status === 'PREPARING' && order.startedAt !== null && !blocked && minute > order.startedAt) {
      order.workedMinutes++;
      if (!order.reworkReported && order.reworkMinutes > 0 && order.workedMinutes >= order.prepMinutes) {
        order.reworkReported = true;
        record(order.id, 'KITCHEN_REWORK');
      }
      if (order.workedMinutes >= order.prepMinutes + order.reworkMinutes) {
        order.readyAt = minute; order.status = 'READY'; kitchen--;
        record(order.id, 'KITCHEN_READY');
      }
    }
    if (order.courierDueAt === minute && order.courierDelayMinutes > 0) record(order.id, 'COURIER_DELAYED');
    if (order.courierAt === minute) { order.courierArrivedAt = minute; record(order.id, 'COURIER_ARRIVED'); }
    // Motoboy fica ao menos 3 minutos simulados na retirada: chegada, espera e coleta.
    if (order.status === 'READY' && order.readyAt !== null && order.courierArrivedAt !== null &&
      minute >= Math.max(order.readyAt, order.courierArrivedAt) + 3) {
      order.pickedUpAt = minute; order.status = 'PICKED_UP'; record(order.id, 'PICKED_UP');
    }
    if (order.status === 'PICKED_UP' && order.pickedUpAt !== null && minute >= order.pickedUpAt + order.deliveryMinutes) {
      order.deliveredAt = minute; order.status = 'DELIVERED'; record(order.id, 'DELIVERED');
    }
  }
  return { minute, seed, scenario: current.scenario, orders, events, incidents,
    nextId: current.nextId + (orders.length - current.orders.length) };
}
export function advanceLive(state: LiveState, minutes = 1): LiveState {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 60) throw new Error('Avanço inválido.');
  let next = state;
  for (let i = 0; i < minutes; i++) next = oneMinute(next);
  return next;
}
export const LIVE_STATUS_LABELS: Record<LiveStatus, string> = {
  QUEUED: 'Na fila', PREPARING: 'Preparando', READY: 'Pronto para coleta',
  PICKED_UP: 'Saiu para entrega', DELIVERED: 'Entregue',
};
