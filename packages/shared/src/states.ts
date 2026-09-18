import type { RentalStatus, VehicleEventKind, VehiclePool, VehicleState } from './types.js';

/** Moving a moped between parks is its own event, and changes no state. */
export const POOL_EVENT: Record<VehiclePool, Extract<VehicleEventKind, 'to_rent' | 'to_sale'>> = {
  rent: 'to_rent',
  sale: 'to_sale',
};

export function isPoolEvent(kind: VehicleEventKind): kind is 'to_rent' | 'to_sale' {
  return kind === 'to_rent' || kind === 'to_sale';
}

/**
 * Which state an event leaves a vehicle in (spec FLT-03). `manual` is the
 * exception: the target state comes with the reason, so it is not here.
 * Neither are the two park moves, which leave the state alone.
 */
export const EVENT_TARGET_STATE: Record<Exclude<VehicleEventKind, 'manual' | 'to_rent' | 'to_sale'>, VehicleState> = {
  arrived: 'available',
  pickup: 'rented',
  return: 'available',
  service_in: 'service',
  service_out: 'available',
  sold: 'sold',
  bought_back: 'available',
  written_off: 'out',
};

/** A vehicle can be handed over only when it is free (FLT-03 acceptance). */
export function canPickUp(state: VehicleState): boolean {
  return state === 'available';
}

/**
 * The status a rental shows, from facts rather than a hand-set field.
 * `overdue` is a signal computed from "paid through" (RNT-03); `paused`,
 * `disputed`, `returned` and `booked` are decisions and stay as stored.
 */
export function effectiveRentalStatus(
  stored: RentalStatus,
  paidThrough: string | null,
  pickedUpOn: string | null,
  today: string,
  /** Nothing at all paid on it yet — no week, no deposit. */
  nothingPaid = false,
): RentalStatus {
  if (stored !== 'active' && stored !== 'overdue') return stored;
  if (!pickedUpOn) return 'booked';
  // Handed over today and waiting for its first payment is not a debt yet —
  // the false "overdue" of B4-01; from tomorrow it is (Q7).
  if (nothingPaid && pickedUpOn >= today) return 'awaiting_payment';
  const covered = paidThrough ?? '';
  return covered < today ? 'overdue' : 'active';
}
