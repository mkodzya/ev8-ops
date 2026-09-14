import type { RentalStatus, VehicleEventKind, VehicleState } from './types.js';

/**
 * Which state an event leaves a vehicle in (spec FLT-03). `manual` is the
 * exception: the target state comes with the reason, so it is not here.
 */
export const EVENT_TARGET_STATE: Record<Exclude<VehicleEventKind, 'manual'>, VehicleState> = {
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
): RentalStatus {
  if (stored !== 'active' && stored !== 'overdue') return stored;
  if (!pickedUpOn) return 'booked';
  const covered = paidThrough ?? '';
  return covered < today ? 'overdue' : 'active';
}
