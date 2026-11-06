/** Identidade visual SINTÉTICA da operação. Não interfere no replay ou nos cálculos. */
import type { LiveStatus } from './live.ts';

export type OrderVisual = 'ticket' | 'pan' | 'bag' | 'none';
export const ORDER_VISUALS: Record<LiveStatus, OrderVisual> = {
  QUEUED: 'ticket',
  PREPARING: 'pan',
  READY: 'bag',
  PICKED_UP: 'none', // O motoboy transporta o pedido, sem pacote duplicado na bancada.
  DELIVERED: 'bag', // A embalagem entregue permanece apenas na área ilustrativa de conclusão.
};

export function orderVisual(status: LiveStatus): OrderVisual {
  return ORDER_VISUALS[status];
}

export type CookMode = 'idle' | 'cooking' | 'fault';
export interface CookState { mode: CookMode; title: string; message: string }

/** Estado calculado APENAS a partir do simulador, sem LLM e sem animações que mudem pedidos. */
export function cookState(preparingCount: number, kitchenFault: boolean): CookState {
  if (kitchenFault) return {
    mode: 'fault', title: 'A cozinha parou!',
    message: 'O equipamento falhou. O cozinheiro interrompeu o preparo e aguarda o reparo do Fixer.',
  };
  if (preparingCount > 0) return {
    mode: 'cooking', title: `Preparando ${preparingCount} ${preparingCount === 1 ? 'pedido' : 'pedidos'}`,
    message: `O cozinheiro está trabalhando ${preparingCount === 1 ? 'na comida que está na bancada' : 'nos pedidos que estão nas bancadas'}. O progresso vem das regras da simulação.`,
  };
  return {
    mode: 'idle', title: 'Aguardando pedidos',
    message: 'Nenhum pedido está sendo preparado agora. O cozinheiro está de prontidão na cozinha.',
  };
}
