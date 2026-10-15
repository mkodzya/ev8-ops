import { rentDueOn } from './periods.js';
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
 * `overdue` and `due_today` are signals computed from "paid through": the
 * rent is due on the first day of the oldest week not fully paid — or on the
 * rental's pay day within that week (ADR-0022) — the rental is `due_today` on
 * that day and `overdue` from the next (ADR-0017, which replaces RNT-03).
 * `paused`, `disputed`, `returned` and `booked` are decisions and stay as
 * stored.
 */
export function effectiveRentalStatus(
  stored: RentalStatus,
  paidThrough: string | null,
  pickedUpOn: string | null,
  today: string,
  payOffsetDays = 0,
): RentalStatus {
  if (stored !== 'active' && stored !== 'overdue') return stored;
  if (!pickedUpOn) return 'booked';
  const dueOn = rentDueOn(paidThrough, pickedUpOn, payOffsetDays);
  return dueOn < today ? 'overdue' : dueOn === today ? 'due_today' : 'active';
}
