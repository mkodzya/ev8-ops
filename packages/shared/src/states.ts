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
 * Which park a moped counts in on a screen (ADR-0005): the park somebody
 * chose, `none` when nobody has, and `gone` once it is sold or written off —
 * those have left both parks, whatever the column still holds. A moped of
 * the sale park stays `sale` in repair or out on a buy-out: the park says
 * what it is for, not what is happening to it. The fleet's counts, a model's
 * card and the quiet line under the state group by this one rule (addendum
 * 21.10.2026). The list's chips ask it too, but only of a moped standing
 * idle: since 22.10.2026 the state is asked first (`fleetChipOf` below).
 */
export type ParkKey = VehiclePool | 'none' | 'gone';

export function parkOf(v: { state: VehicleState; pool: VehiclePool | null }): ParkKey {
  if (v.state === 'sold' || v.state === 'out') return 'gone';
  return v.pool ?? 'none';
}

/**
 * The filter chips over Парк → Мопеды, in the order their questions are
 * asked (Mika, answer «Б», 22.10.2026; GitHub issue #6). Every moped is
 * counted under exactly one: the overlap — one moped under «Свободен» and
 * «На продажу» at once — read as mopeds counted twice.
 *
 *   1. rented and 2. service first, so those two chips stay exact — the
 *      state's own number, as on «Сегодня», whatever park or point the moped
 *      has or lacks;
 *   3. for sale, 4. no park, 5. no point — what is still to be done with a
 *      moped standing idle;
 *   6. free — the rest: in the rental park, on a known point, ready to go.
 *
 * Sold and written-off mopeds have left the fleet and are under none: they
 * are seen only under «Все». The order here is the order of the questions;
 * the screen lays its chips out in an order of its own.
 */
export const FLEET_CHIPS = ['rented', 'service', 'sale', 'nopool', 'nopoint', 'available'] as const;
export type FleetChip = (typeof FLEET_CHIPS)[number];

/**
 * The one chip a moped is counted under (see FLEET_CHIPS), or null for one
 * that has left the fleet. `hasPoint`: somebody has said where it stands.
 * One rule for each chip, the count beside it, and every number elsewhere
 * that opens a chip — «Свободно», «N мопедов без парка» and «N мопедов без
 * точки» on «Сегодня» (`countFleetChips`; Mika, answer «А», 22.10.2026), so
 * a number is always the list it opens (`docs/design/ux.md`, principle 10).
 */
export function fleetChipOf(v: { state: VehicleState; pool: VehiclePool | null }, hasPoint: boolean): FleetChip | null {
  if (v.state === 'rented' || v.state === 'service') return v.state;
  if (v.state !== 'available') return null;
  const park = parkOf(v);
  if (park === 'sale') return 'sale';
  if (park === 'none') return 'nopool';
  if (!hasPoint) return 'nopoint';
  return 'available';
}

/**
 * How many mopeds stand under each chip — `fleetChipOf` asked of every one,
 * sold and written-off ones counted nowhere. What «Сегодня» shows beside a
 * link into the list is read from here, never counted on its own.
 */
export function countFleetChips<T extends { state: VehicleState; pool: VehiclePool | null }>(vehicles: readonly T[], hasPoint: (v: T) => boolean): Record<FleetChip, number> {
  const counts = Object.fromEntries(FLEET_CHIPS.map((c) => [c, 0])) as Record<FleetChip, number>;
  for (const v of vehicles) {
    const chip = fleetChipOf(v, hasPoint(v));
    if (chip) counts[chip]++;
  }
  return counts;
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

/**
 * Which state an event leaves a moped in, knowing whether a rental it was
 * handed out on is still open — handed over and not closed, paused or
 * disputed included (issue #17, ADR-0049). A repair closed, cancelled or
 * refused gives the moped back where it was: to the customer while that
 * rental runs — «В аренде» — and to the yard only when there is none. Before
 * this, every repair's end said «Свободен»: a moped stood free on its card for
 * days while its rental ran on, and could have been handed to a second
 * customer. Every other event's state is EVENT_TARGET_STATE's.
 */
export function eventTargetState(kind: keyof typeof EVENT_TARGET_STATE, inOpenRental: boolean): VehicleState {
  if (kind === 'service_out' && inOpenRental) return 'rented';
  return EVENT_TARGET_STATE[kind];
}

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
  /**
   * An owner: writing off is the owners' (Q22, wave 4 §3.6), and so is giving
   * a moped back its «В аренде» (issue #17) — asked of `deposit.decide`, as everywhere.
   */
  mayWriteOff: boolean;
  /**
   * A rental the moped was handed out on is still open — read from the
   * rentals, not from the moped's own link, which any event that leaves it
   * anything but rented clears (issue #17, ADR-0049).
   */
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
 *   3. a moped whose rental is open while its state says otherwise — a
 *      repair's end used to make it «Свободен» — goes one way only: back to
 *      «В аренде», by an owner, with a reason; nothing else moves it until
 *      the rental is closed (issue #17, ADR-0049);
 *   4. anything but free and service is the owners' — so a manager keeps
 *      exactly what the API allowed before, bringing a written-off moped
 *      back included (Mika, 21.10.2026: who may do what does not change);
 *   5. rented comes from a hand-over: without an open rental it is never a
 *      state to choose («В аренде — только через выдачу»);
 *   6. the state it is already in is no move: there is nothing to write in
 *      the history, so it is refused rather than journalled as X → X.
 */
export function manualMoveRefusal(from: VehicleState, to: VehicleState, who: ManualMoveWho): ManualMoveRefusal | null {
  if (from === 'rented' && who.hasRental) return 'vehicle_rented_move';
  if (to === 'sold' || from === 'sold') return 'sold_by_sale';
  if (who.hasRental) {
    if (to !== 'rented') return 'vehicle_rented_move';
    return who.mayWriteOff ? null : 'owner_only';
  }
  if (!who.mayWriteOff && to !== 'available' && to !== 'service') return 'owner_only';
  if (to === 'rented') return 'use_rental';
  if (to === from) return 'same_state';
  return null;
}

/**
 * The states a person may set by hand from `from`, in the order of
 * VEHICLE_STATES — what the sheet offers after «now». Empty for a sold moped
 * and for one out on a rental: there is nothing to choose, so nothing opens.
 * A moped whose rental is open while its state is not «В аренде» is offered
 * to an owner that one state and nothing else (issue #17).
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
