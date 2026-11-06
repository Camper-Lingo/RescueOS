/** Rotinas VISUAIS baseadas apenas no simulador sintético; nenhuma IA é chamada. */
import type { MonsterId } from '../scene/characters/roster.ts';
import type { LiveOrder, LiveState } from './live.ts';
import { activeKitchenFault } from './live.ts';

export type CrewAction = 'idle' | 'assign' | 'carry' | 'scan' | 'repair' | 'inspect';
export interface CrewActivity {
  title: string;
  message: string;
  orderId: string | null;
  position: [number, number, number];
  busy: boolean;
  carrying: boolean;
  action: CrewAction;
}
export type CrewActivities = Record<MonsterId, CrewActivity>;
const place = (x: number, z: number): [number, number, number] => [x, .16, z];
const first = (orders: LiveOrder[], status: LiveOrder['status']) => orders.find(o => o.status === status);
const INCIDENT_EVENTS = new Set(['KITCHEN_FAULT', 'KITCHEN_REWORK', 'COURIER_DELAYED']);

export function crewActivities(sim: LiveState, running: boolean): CrewActivities {
  const queue = sim.orders.filter(o => o.status === 'QUEUED');
  const preparing = sim.orders.filter(o => o.status === 'PREPARING');
  const ready = first(sim.orders, 'READY');
  const newest = sim.orders.at(-1);
  const fault = activeKitchenFault(sim);
  const lastIncident = sim.events.slice().reverse().find(event => INCIDENT_EVENTS.has(event.type));
  const latestProblem = lastIncident && sim.minute - lastIncident.minute <= 9 ? lastIncident : undefined;
  const paused = !running && sim.minute > 0;
  const rest = (message: string) => paused ? `Simulação pausada. ${message}` : message;
  const patrol = sim.minute % 8 < 4;

  return {
    coordinator: {
      title: queue.length >= 3 ? 'Redistribuindo tarefas na fila' : preparing.length ? 'Organizando os preparos' : 'Recebendo pedidos',
      message: rest(queue.length ? `${queue.length} pedidos aguardam a cozinha. Estou organizando a sequência FIFO; não altero os prazos.`
        : preparing.length ? `${preparing.length} pedidos ocupam as bancadas; acompanho o fluxo de entrada.`
          : 'Vou encaminhar os novos pedidos à fila quando começarem a chegar.'),
      orderId: queue[0]?.id ?? preparing[0]?.id ?? newest?.id ?? null,
      position: sim.minute ? patrol ? place(.15, 1.55) : place(2.1, 2.7) : place(.8, 2.9),
      busy: running && sim.orders.length > 0, carrying: false, action: running && sim.orders.length ? 'assign' : 'idle',
    },
    runner: {
      title: ready ? 'Levando pedido à expedição' : preparing.length ? 'Aguardando saída da cozinha' : 'Expedição de prontidão',
      message: rest(ready ? `Vou deixar ${ready.id} na área de retirada para o motoboy buscar.`
        : preparing.length ? `Estou acompanhando ${preparing[0].id} até ficar pronto. A entrega externa é feita pelos motoboys.`
          : 'Faço a ponte entre a cozinha e a retirada. Não sou o motoboy.'),
      orderId: ready?.id ?? preparing[0]?.id ?? null,
      position: ready ? place(2.4, .25) : preparing.length ? place(-.65, -.75) : place(4, 2.2),
      busy: running && !!(ready || preparing.length), carrying: running && !!ready,
      action: running && ready ? 'carry' : 'idle',
    },
    scout: {
      title: fault ? 'Alerta! Cozinha parada' : latestProblem ? 'Sinalizando contratempo' : running ? 'Patrulhando a operação' : 'Aguardando movimento',
      message: rest(fault ? `Detectei falha na cozinha no minuto ${fault.openedAt}. O Fixer está realizando um reparo simulado.`
        : latestProblem ? `Observei ${latestProblem.type} no log do pedido ${latestProblem.orderId}. Clique no Trace para ver os registros.`
          : 'Estou percorrendo a operação. Meus alertas aqui são regras do simulador, não inferências de IA.'),
      orderId: fault?.orderId ?? latestProblem?.orderId ?? null,
      position: fault ? place(-1.55, -.55) : sim.minute ? patrol ? place(2.9, .35) : place(-.6, .7) : place(-.1, -.3),
      busy: running && sim.orders.length > 0, carrying: false,
      action: running && (fault || latestProblem) ? 'scan' : 'idle',
    },
    fixer: {
      title: fault ? 'Reparando equipamento da cozinha' : preparing.length ? 'Verificando equipamentos' : 'Ferramentas prontas',
      message: rest(fault ? `Equipamento indisponível desde o minuto ${fault.openedAt}. Meu reparo por regras terminará no minuto ${fault.openedAt + 4}.`
        : preparing.length ? 'Inspeciono a bancada. Se ocorrer falha do equipamento, o simulador aplicará uma reparação automática de 4 minutos.'
          : 'Aguardando falhas para começar uma manutenção simulada.'),
      orderId: fault?.orderId ?? preparing[0]?.id ?? null,
      position: fault ? place(-1.5, -.65) : preparing.length ? place(-2.5, .25) : place(-2.1, -1.7),
      busy: running && (!!fault || preparing.length > 0), carrying: false,
      action: running && fault ? 'repair' : 'idle',
    },
    trace: {
      title: latestProblem ? 'Conferindo registros do incidente' : 'Monitorando histórico sintético',
      message: rest(latestProblem ? `No minuto ${latestProblem.minute}, o log registrou ${latestProblem.type} em ${latestProblem.orderId}. Veja o registro abaixo; não foi executado LLM.`
        : 'Acompanho eventos do simulador para mostrar o que realmente foi registrado. Investigação de IA não está ativa neste modo.'),
      orderId: latestProblem?.orderId ?? null,
      position: latestProblem ? place(-2.05, 1.7) : place(-1.65, 2.1),
      busy: running && !!latestProblem, carrying: false,
      action: running && latestProblem ? 'inspect' : 'idle',
    },
  };
}
