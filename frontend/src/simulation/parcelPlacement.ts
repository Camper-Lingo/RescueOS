/** Prateleiras e pontos de apoio físicos dos pacotes da simulação viva.
 * Cada slot ocupa uma posição diferente, sem interpenetrar outra caixa.
 */
import type { LiveOrder } from './live.ts';
export type ParcelPosition = [number, number, number];
export const PARCEL_SLOTS: Record<LiveOrder['status'], number> = {
  QUEUED: 12, PREPARING: 2, READY: 6, PICKED_UP: 0, DELIVERED: 2,
};
export function parcelPosition(status: LiveOrder['status'], slot: number): ParcelPosition | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PARCEL_SLOTS[status]) return null;
  switch (status) {
    case 'QUEUED': return [-1.25 + (slot % 6) * .5, slot < 6 ? .96 : 1.64, 3.25];
    case 'PREPARING': return [-2.08 + slot * .58, 1.36, -3.04];
    case 'READY': return [1.56 + (slot % 3) * .7, 1.36, -1.32 + Math.floor(slot / 3) * .44];
    case 'DELIVERED': return [3.65 + slot * .53, .3, 1.0];
    case 'PICKED_UP': return null; // A caixa passa a ser transportada pelo Runner.
  }
}
