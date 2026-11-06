/** Navegação cinemática 2D da cena (XZ). Não é um motor de dinâmica rígida.
 * Obstáculos são a projeção das bancadas/mesas/estante; a área caminhável é a do piso.
 */
import type { MonsterId } from '../scene/characters/roster.ts';

export type Point = { x: number; z: number };
export type Rectangle = { minX: number; maxX: number; minZ: number; maxZ: number };
const box = (x: number, z: number, w: number, d: number): Rectangle =>
  ({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

// Mesmas medidas horizontais das superfícies que ocupam o piso em Restaurant.tsx.
export const FURNITURE: readonly Rectangle[] = [
  box(-2.6, -2.75, 4.3, 1.02), box(-4.25, -1.9, .98, 1.2), // cozinha
  box(2.3, -1.1, 3.4, 1.1), box(2.7, -3.05, 2.45, .68), // retirada e estantes
  box(-3.1, 2.3, 2.62, 1.3), box(2.5, 2.45, 2.45, 1.25), // mesas
  box(0, 3.25, 3.04, .66), // estante de pedidos na entrada
  box(-4.35, -1.5, .5, .5), box(4.4, 2.65, .45, .45), // plantas
  box(4.65, 1.0, .2, 1.54), // estrutura da saída
];
export const ACTOR_RADIUS = .35;
const LIMIT = { minX: -4.86, maxX: 4.86, minZ: -3.46, maxZ: 3.62 };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const expand = (r: Rectangle, margin: number): Rectangle => ({
  minX: r.minX - margin, maxX: r.maxX + margin, minZ: r.minZ - margin, maxZ: r.maxZ + margin,
});

export function canOccupy(point: Point, radius = ACTOR_RADIUS): boolean {
  if (point.x < LIMIT.minX + radius || point.x > LIMIT.maxX - radius ||
    point.z < LIMIT.minZ + radius || point.z > LIMIT.maxZ - radius) return false;
  return FURNITURE.every(r => {
    const b = expand(r, radius + .015);
    return point.x < b.minX || point.x > b.maxX || point.z < b.minZ || point.z > b.maxZ;
  });
}

/** Segmento inteiro livre: impede atravessar móveis entre dois frames. */
export function clearSegment(from: Point, to: Point, radius = ACTOR_RADIUS): boolean {
  if (!canOccupy(from, radius) || !canOccupy(to, radius)) return false;
  const dx = to.x - from.x, dz = to.z - from.z;
  for (const rect of FURNITURE) {
    const b = expand(rect, radius + .012);
    let lower = 0, upper = 1;
    for (const [p, d, min, max] of [[from.x, dx, b.minX, b.maxX], [from.z, dz, b.minZ, b.maxZ]]) {
      if (Math.abs(d) < 1e-10) {
        if (p < min || p > max) { lower = Infinity; break; }
      } else {
        const t1 = (min - p) / d, t2 = (max - p) / d;
        lower = Math.max(lower, Math.min(t1, t2));
        upper = Math.min(upper, Math.max(t1, t2));
      }
    }
    if (lower <= upper) return false;
  }
  return true;
}

/** Se uma tarefa antiga aponta para dentro de uma bancada, encontra um ponto de acesso. */
export function nearestWalkable(p: Point, radius = ACTOR_RADIUS): Point {
  if (canOccupy(p, radius)) return { ...p };
  for (let range = .1; range <= 3.2; range += .1) {
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI * 2 / 24;
      const candidate = { x: p.x + Math.cos(a) * range, z: p.z + Math.sin(a) * range };
      if (canOccupy(candidate, radius)) return candidate;
    }
  }
  return { x: 0, z: 0 };
}

/** Grafo de visibilidade das quinas expandidas dos móveis, com busca de menor caminho. */
export function findRoute(origin: Point, destination: Point, radius = ACTOR_RADIUS): Point[] {
  const start = nearestWalkable(origin, radius), end = nearestWalkable(destination, radius);
  if (distance(start, end) < .02) return [end];
  if (clearSegment(start, end, radius)) return [end];
  const points = [start, end];
  for (const r of FURNITURE) {
    const inflated = expand(r, radius + .045);
    for (const x of [inflated.minX, inflated.maxX]) for (const z of [inflated.minZ, inflated.maxZ]) {
      if (canOccupy({ x, z }, radius)) points.push({ x, z });
    }
  }
  const cost = points.map(() => Infinity), prev = points.map(() => -1), visited = new Set<number>();
  cost[0] = 0;
  while (visited.size < points.length) {
    let u = -1;
    for (let i = 0; i < points.length; i++) if (!visited.has(i) && (u < 0 || cost[i] < cost[u])) u = i;
    if (u < 0 || !Number.isFinite(cost[u]) || u === 1) break;
    visited.add(u);
    for (let v = 1; v < points.length; v++) {
      if (v === u || visited.has(v) || !clearSegment(points[u], points[v], radius)) continue;
      const next = cost[u] + distance(points[u], points[v]);
      if (next < cost[v]) { cost[v] = next; prev[v] = u; }
    }
  }
  if (!Number.isFinite(cost[1])) return [start]; // Sem corredor: não atravessa a bancada.
  const result: Point[] = [];
  let idx = 1;
  while (idx > 0) { result.unshift(points[idx]); idx = prev[idx]; }
  return result;
}

const MONSTER_IDS: MonsterId[] = ['coordinator', 'runner', 'scout', 'fixer', 'trace'];
export type Destinations = Record<MonsterId, [number, number, number]>;

export class CrewNavigator {
  readonly positions: Record<MonsterId, Point>;
  private goals: Record<MonsterId, Point>;
  private paths: Record<MonsterId, Point[]>;
  constructor(initial: Destinations) {
    this.positions = {} as Record<MonsterId, Point>;
    this.goals = {} as Record<MonsterId, Point>;
    this.paths = {} as Record<MonsterId, Point[]>;
    for (const id of MONSTER_IDS) {
      const p = nearestWalkable({ x: initial[id][0], z: initial[id][2] });
      // Deterministic spawn separation (no overlapping monsters at time zero).
      let free = p;
      if (MONSTER_IDS.some(other => this.positions[other] && distance(free, this.positions[other]) < ACTOR_RADIUS * 2 + .025)) {
        for (let r = .1; r <= 2.1; r += .1) {
          const open = Array.from({ length: 16 }, (_, i) => ({ x: p.x + Math.cos(i * Math.PI / 8) * r, z: p.z + Math.sin(i * Math.PI / 8) * r }))
            .find(q => canOccupy(q) && MONSTER_IDS.every(other => !this.positions[other] || distance(q, this.positions[other]) >= ACTOR_RADIUS * 2 + .025));
          if (open) { free = open; break; }
        }
      }
      this.positions[id] = free;
      this.goals[id] = free;
      this.paths[id] = [];
    }
  }
  tick(destinations: Destinations, delta: number, reducedMotion: boolean, frozen = false) {
    for (const id of MONSTER_IDS) {
      const raw = { x: destinations[id][0], z: destinations[id][2] };
      const goal = nearestWalkable(raw);
      if (distance(this.goals[id], goal) > .07) {
        this.goals[id] = goal;
        this.paths[id] = findRoute(this.positions[id], goal);
      }
    }
    if (frozen) return;
    if (reducedMotion) {
      for (const id of MONSTER_IDS) {
        const goal = this.goals[id];
        if (MONSTER_IDS.every(other => other === id || distance(goal, this.positions[other]) >= ACTOR_RADIUS * 2 + .025)) {
          this.positions[id] = goal;
        }
      }
      return;
    }
    const dt = Math.min(delta, .07);
    for (const id of MONSTER_IDS) {
      const current = this.positions[id];
      let goal = this.paths[id][0];
      if (!goal) continue;
      const remaining = distance(current, goal);
      if (remaining < .045) { this.paths[id].shift(); goal = this.paths[id][0]; if (!goal) continue; }
      const length = distance(current, goal);
      const step = Math.min(length, dt * 1.6);
      if (length < 1e-7) continue;
      const next = { x: current.x + (goal.x - current.x) / length * step, z: current.z + (goal.z - current.z) / length * step };
      if (!clearSegment(current, next)) {
        this.paths[id] = findRoute(current, this.goals[id]);
        continue;
      }
      if (MONSTER_IDS.some(other => other !== id && distance(next, this.positions[other]) < ACTOR_RADIUS * 2 + .025)) continue;
      this.positions[id] = next;
    }
  }
}
