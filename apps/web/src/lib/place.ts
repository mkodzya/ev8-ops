import type { VehicleState } from '@ev8/shared';

export type Place = { kind: 'point'; name: string } | { kind: 'customer' } | { kind: 'unset' };

/**
 * Where a moped is, as one rule the list and the card both read. A point is
 * stored only while the moped stands on company ground; out on rent it is at
 * its customer, and that answer is worked out rather than typed. "Nobody has
 * said" stays a visible answer instead of an empty cell.
 */
export function placeOf(v: { state: VehicleState; location: { name: string } | null }): Place {
  if (v.location) return { kind: 'point', name: v.location.name };
  if (v.state === 'rented') return { kind: 'customer' };
  return { kind: 'unset' };
}
