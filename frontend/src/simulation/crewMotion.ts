/** FSM VISUAL dos ajudantes. Não representa raciocínio/autonomia de IA. */
import type { MonsterId } from '../scene/characters/roster.ts';
import type { CrewAction } from './crew.ts';

export type CrewMotionMode = 'still' | 'idle' | 'walk' | 'work' | 'react';

export function chooseMotionMode(action: CrewAction, busy: boolean, moving: boolean, reduced: boolean): CrewMotionMode {
  if (reduced) return 'still';
  if (moving) return 'walk';
  if (!busy || action === 'idle') return 'idle';
  if (action === 'repair' || action === 'scan') return 'react';
  return 'work';
}

/** Interpolação independente da taxa de FPS, inclusive em transições idle → walk → work. */
export function smoothMotionWeight(current: number, goal: number, delta: number, responsiveness = 7): number {
  const value = current + (goal - current) * (1 - Math.exp(-Math.max(0, delta) * responsiveness));
  return Math.min(1, Math.max(0, value));
}

/** Gestos pequenos e escalonados para evitar que os cinco NPCs pareçam sincronizados. */
export function idleMicroGesture(id: MonsterId, elapsed: number): { glance: number; sway: number; wave: number; toe: number } {
  const offset: Record<MonsterId, number> = { coordinator: 0, runner: 2.1, scout: 4.3, fixer: 6.7, trace: 8.9 };
  const t = elapsed + offset[id];
  const moment = Math.max(0, Math.sin(t * .46));
  return {
    glance: Math.sin(t * .42) * .14 + Math.pow(moment, 10) * .15,
    sway: Math.sin(t * .73) * .025,
    wave: Math.pow(moment, 12) * .22,
    toe: Math.pow(Math.max(0, Math.sin(t * .9)), 16) * .16,
  };
}
