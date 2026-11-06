import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTOR_RADIUS, canOccupy, clearSegment, CrewNavigator, findRoute } from './navigation.ts';
import { PARCEL_SLOTS, parcelPosition } from './parcelPlacement.ts';

const initial = {
  scout: [-.1, .16, -.3], fixer: [-2.1, .16, -1.7], trace: [-1.65, .16, 2.1],
  runner: [4, .16, 2.2], coordinator: [.8, .16, 2.9],
} as const;

test('mesas e balcões bloqueiam passagem direta; rota segue corredor livre', () => {
  const start = { x: 2.4, z: .25 }, goal = { x: 3.9, z: 2.25 };
  assert.equal(clearSegment(start, goal), false, 'mesa de operações está entre os dois pontos');
  const path = findRoute(start, goal);
  assert.ok(path.length > 1, 'usa pelo menos um desvio ao redor da mesa');
  let current = start;
  for (const waypoint of path) {
    assert.equal(canOccupy(waypoint), true);
    assert.equal(clearSegment(current, waypoint), true);
    current = waypoint;
  }
});

test('caminho nunca sai do piso ou atravessa mesas, inclusive frames longos', () => {
  const nav = new CrewNavigator(initial as unknown as Record<keyof typeof initial, [number, number, number]>);
  const destinations = { ...initial, runner: [2.4, .16, .25], coordinator: [2.1, .16, 2.7], fixer: [-2.5, .16, .25] } as unknown as Record<keyof typeof initial, [number, number, number]>;
  for (let i = 0; i < 1200; i++) {
    const last = structuredClone(nav.positions);
    nav.tick(destinations, i % 3 === 0 ? .15 : 1 / 60, false);
    for (const [id, point] of Object.entries(nav.positions)) {
      assert.ok(canOccupy(point), `${id} está livre de móveis`);
      assert.ok(clearSegment(last[id as keyof typeof initial], point), `${id} não atravessou móvel`);
      for (const [otherId, other] of Object.entries(nav.positions)) {
        if (otherId === id) continue;
        assert.ok(Math.hypot(point.x - other.x, point.z - other.z) >= ACTOR_RADIUS * 2, `${id} não atravessa ${otherId}`);
      }
    }
  }
});

test('pausar congela os personagens, sem mudar o estado do simulador', () => {
  const nav = new CrewNavigator(initial as unknown as Record<keyof typeof initial, [number, number, number]>);
  const destinations = { ...initial, runner: [2.4, .16, .25] } as unknown as Record<keyof typeof initial, [number, number, number]>;
  nav.tick(destinations, .02, false);
  const before = structuredClone(nav.positions);
  nav.tick(destinations, .1, false, true);
  assert.deepEqual(nav.positions, before);
});

test('pacotes têm slots separados e apoiados nas mesas e prateleiras', () => {
  for (const status of ['QUEUED', 'PREPARING', 'READY', 'DELIVERED'] as const) {
    const slots = Array.from({ length: PARCEL_SLOTS[status] }, (_, i) => parcelPosition(status, i)!);
    for (let i = 0; i < slots.length; i++) {
      assert.ok(slots[i][1] >= .29, 'pacote acima do piso');
      for (let j = i + 1; j < slots.length; j++) {
        const horizontal = Math.hypot(slots[i][0] - slots[j][0], slots[i][2] - slots[j][2]);
        const vertical = Math.abs(slots[i][1] - slots[j][1]);
        assert.ok(horizontal >= .42 || vertical >= .34, `caixas ${status} ${i}/${j} não se sobrepõem`);
      }
    }
    assert.equal(parcelPosition(status, PARCEL_SLOTS[status]), null);
  }
  assert.equal(parcelPosition('PICKED_UP', 0), null, 'pedidos em trânsito ficam com o Runner');
});
