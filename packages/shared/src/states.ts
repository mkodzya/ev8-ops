import { rentDueOn } from './periods.js';
import { VEHICLE_STATES, type RentalStatus, type VehicleEventKind, type VehiclePool, type VehicleState } from './types.js';

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
 * Why a person may not set a moped's state by hand — the code the API
 * answers with. Every one has words in `errors.codes`.
 */
export type ManualMoveRefusal = 'vehicle_rented_move' | 'sold_by_sale' | 'owner_only' | 'use_rental' | 'same_state';

/** Who is moving the moped, and what it is tied to now. */
export interface ManualMoveWho {
  /** Writing off is the owners' (Q22, wave 4 §3.6): asked of `deposit.decide`, as everywhere. */
  mayWriteOff: boolean;
  /** The moped is out on a rental, not only marked rented. */
  hasRental: boolean;
}

/**
 * Whether a moped may go from `from` to `to` by hand (FLT-03, wave 4 §3.6),
 * and if not, why. One rule for the sheet on the moped card and for
 * `POST /api/fleet/:id/state`, so the sheet never offers what the server
 * refuses (21.10.2026). The checks run in the order the API has always
 * answered in, so every refusal keeps its code:
 *
 *   1. a moped out on a rental moves through the rental;
 *   2. sold is a sale's word, and only a buy-back brings a sold one back;
 *   3. anything but free and service is the owners' — so a manager keeps
 *      exactly what the API allowed before, bringing a written-off moped
 *      back included (Mika, 21.10.2026: who may do what does not change);
 *   4. rented comes from a hand-over;
 *   5. the state it is already in is no move: there is nothing to write in
 *      the history, so it is refused rather than journalled as X → X.
 */
export function manualMoveRefusal(from: VehicleState, to: VehicleState, who: ManualMoveWho): ManualMoveRefusal | null {
  if (from === 'rented' && who.hasRental) return 'vehicle_rented_move';
  if (to === 'sold' || from === 'sold') return 'sold_by_sale';
  if (!who.mayWriteOff && to !== 'available' && to !== 'service') return 'owner_only';
  if (to === 'rented') return 'use_rental';
  if (to === from) return 'same_state';
  return null;
}

/**
 * The states a person may set by hand from `from`, in the order of
 * VEHICLE_STATES — what the sheet offers after «now». Empty for a sold moped
 * and for one out on a rental: there is nothing to choose, so nothing opens.
 */
export function manualStateTargets(from: VehicleState, who: ManualMoveWho): VehicleState[] {
  return VEHICLE_STATES.filter((to) => manualMoveRefusal(from, to, who) === null);
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
