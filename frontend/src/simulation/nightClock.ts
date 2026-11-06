/** Relógio da noite SINTÉTICA. 60 minutos da operação = 10 minutos reais em 1×. */
import { advanceLive } from './live.ts';
import type { LiveState } from './live.ts';

export const NIGHT_END_MINUTE = 60;
export const REAL_MS_PER_SIMULATED_MINUTE = 10_000;

/** Acelera somente o tempo da simulação, sem usar relógio real no reducer. */
export function nightClockStep(elapsedRealMs: number, speed: number, pendingMs: number): { minutes: number; pendingMs: number } {
  if (!Number.isFinite(elapsedRealMs) || elapsedRealMs < 0 || ![1, 2, 4].includes(speed) ||
      !Number.isFinite(pendingMs) || pendingMs < 0) throw new Error('Relógio inválido');
  const total = pendingMs + elapsedRealMs * speed;
  const minutes = Math.floor(total / REAL_MS_PER_SIMULATED_MINUTE);
  return { minutes, pendingMs: total - minutes * REAL_MS_PER_SIMULATED_MINUTE };
}

/** Nunca gera pedidos ou eventos depois do fechamento. */
export function advanceNight(state: LiveState, minutes: number): LiveState {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error('Avanço inválido');
  const remaining = Math.max(0, NIGHT_END_MINUTE - state.minute);
  const allowed = Math.min(remaining, minutes);
  return allowed ? advanceLive(state, allowed) : state;
}

export function clockLabel(remainingRealSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(remainingRealSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
