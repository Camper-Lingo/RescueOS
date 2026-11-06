#!/usr/bin/env node
/** Exporta exemplos prospectivos diretamente do simulador Stage 7G/7H.
 *  Requer Node 22+ com --experimental-strip-types; nenhuma API/Ollama é chamada.
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { createLive, advanceLive, LAST_ORDER_MINUTE } from '../frontend/src/simulation/live.ts';

const args = process.argv.slice(2);
function arg(flag, defaultValue) {
  const at = args.indexOf(flag);
  if (at < 0) return defaultValue;
  if (at === args.length - 1) throw Error(`${flag} precisa de valor`);
  return args[at + 1];
}
const seeds = Number(arg('--seeds', '150'));
const seedStart = Number(arg('--seed-start', '1000'));
const output = resolve(arg('--out', 'ai_lab/data/delivery_risk.jsonl'));
if (!Number.isSafeInteger(seeds) || seeds < 20 || seeds > 3000 || !Number.isSafeInteger(seedStart) || seedStart < 0) {
  throw Error('Use --seeds entre 20 e 3000 e --seed-start inteiro não negativo.');
}
mkdirSync(dirname(output), { recursive: true });
const stream = createWriteStream(output, { encoding: 'utf8' });
let total = 0, completed = 0, late = 0, pending = 0;
for (let seed = seedStart; seed < seedStart + seeds; seed++) {
  for (const scenario of ['quiet', 'medium', 'busy']) {
    let state = createLive(seed, scenario);
    const atCreation = [];
    for (let minute = 1; minute <= 60; minute++) {
      const before = state;
      state = advanceLive(state, 1);
      const newOrders = state.orders.filter(o => o.createdAt === minute);
      // Apenas dados disponíveis ANTES da entrada do pedido.
      const kitchen = before.orders.filter(o => ['QUEUED','PREPARING'].includes(o.status));
      const kitchenBacklog = kitchen.reduce((sum, o) => sum + Math.max(0, o.prepMinutes - o.workedMinutes), 0);
      for (const order of newOrders) {
        atCreation.push({
          seed, scenario, order_id: order.id,
          features: {
            created_minute: minute,
            kitchen_queue: kitchen.filter(o => o.status === 'QUEUED').length,
            kitchen_backlog_minutes: kitchenBacklog,
            kitchen_fault_active: before.incidents.some(x => x.resolvedAt === null) ? 1 : 0,
            prep_minutes: order.prepMinutes,
            courier_due_in: order.courierDueAt - minute,
            delivery_minutes: order.deliveryMinutes,
            route_km: order.routeKm,
            courier_speed_kmh: order.courierSpeedKmh,
            promised_in: order.promisedAt - minute,
          }
        });
      }
    }
    for (const example of atCreation) {
      const final = state.orders.find(o => o.id === example.order_id);
      if (!final) throw Error('Pedido criado desapareceu na simulação');
      const label = final.deliveredAt === null ? null : Number(final.deliveredAt > final.promisedAt);
      const row = { schema: 'rescueos.delivery_risk.v1', ...example,
        label_late: label, outcome: label === null ? 'PENDING' : label ? 'LATE' : 'ON_TIME',
        // Resultado futuro APENAS no alvo; não aparece no objeto features.
      };
      if (!stream.write(JSON.stringify(row) + '\n')) await once(stream, 'drain');
      total++; if (label === null) pending++; else { completed++; late += label; }
    }
  }
}
stream.end(); await once(stream, 'finish');
console.log(`Dataset escrito: ${output}`);
console.log(`${seeds * 3} noites, ${total} pedidos, ${completed} entregues (${late} atrasados), ${pending} pendentes.`);
console.log(`Somente pedidos ENTREGUES entram no treino; pendentes são reportados separadamente.`);
console.log(`Novos pedidos são aceitos até minuto ${LAST_ORDER_MINUTE}; sem uso de Ollama.`);
