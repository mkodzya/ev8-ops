import { POOL_EVENT, eventTargetState, type VehicleEventKind, type VehiclePool, type VehicleState } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { dateFromISO } from './dates.js';
import { prisma } from './db.js';
import { conflict, type ApiError } from './errors.js';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/**
 * The rental a moped is out on: one it was handed out on and that is not
 * closed — running, late, paused or disputed (issue #17, ADR-0049). Read from
 * the rentals, never from the moped's own `currentRentalId`: that link is
 * cleared by any event that leaves the moped anything but rented, which is
 * how a moped in a running rental came to say «Свободен» after a repair, and
 * nothing then stopped it being handed to a second customer. `except`: the
 * rental asking, which is not another one.
 */
export async function openRentalOf(db: Db, vehicleId: string, except?: string): Promise<{ id: string; number: string; customerId: string } | null> {
  return db.rental.findFirst({
    where: { vehicleId, status: { not: 'returned' }, pickedUpOn: { not: null }, ...(except ? { id: { not: except } } : {}) },
    orderBy: [{ pickedUpOn: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, number: true, customerId: true },
  });
}

/** `openRentalOf` for many mopeds at once, by moped: a list's question (issue #17). */
export async function openRentalsOf(db: Db, vehicleIds: string[]): Promise<Map<string, { id: string; number: string }>> {
  const out = new Map<string, { id: string; number: string }>();
  if (vehicleIds.length === 0) return out;
  const rows = await db.rental.findMany({
    where: { vehicleId: { in: vehicleIds }, status: { not: 'returned' }, pickedUpOn: { not: null } },
    orderBy: [{ pickedUpOn: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, number: true, vehicleId: true },
  });
  for (const r of rows) if (r.vehicleId && !out.has(r.vehicleId)) out.set(r.vehicleId, { id: r.id, number: r.number });
  return out;
}

/**
 * A moped that is out on a rental is handed to nobody else — whatever its
 * state says (issue #17): the hand-over, a swap, a VIN confirmed later, a
 * return taken back and a sale all ask this before they write.
 */
export function inRentalRefusal(rental: { number: string }, field = 'vehicleId'): ApiError {
  return conflict('vehicle_in_rental', `This moped is out on rental ${rental.number}; it is not handed to anyone else until that rental is closed.`, { rental: rental.number, field });
}

/**
 * The one way a vehicle changes state (FLT-03): an event is written, the
 * state follows from it. `manual` carries its target and a reason; a manual
 * «rented» carries the open rental it goes back to as well — an owner's
 * correction (issue #17), checked by the caller to be open. A repair's end
 * (`service_out`) leaves a moped whose rental is open with its customer.
 */
export async function moveVehicle(
  tx: Tx,
  input: {
    vehicleId: string;
    kind: VehicleEventKind;
    occurredOn: string;
    actorId: string | null;
    rentalId?: string | null;
    reason?: string | null;
    toState?: VehicleState; // manual only
  },
): Promise<{ from: VehicleState; to: VehicleState }> {
  const v = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });
  const from = v.state as VehicleState;
  let to: VehicleState;
  // The rental a move that is not a hand-over gives the moped back to (issue #17).
  let backTo: string | null = null;
  if (input.kind === 'manual') {
    if (!input.toState) throw new Error('manual move needs a target state');
    if (!input.reason) throw conflict('reason_required', 'A manual state change needs a reason.');
    if (input.toState === 'rented') {
      if (!input.rentalId) throw conflict('use_rental', 'A moped becomes rented through a hand-over, not by hand.');
      backTo = input.rentalId;
    }
    to = input.toState;
  } else {
    if (input.kind === 'to_rent' || input.kind === 'to_sale') throw new Error('a park move goes through movePool');
    const open = input.kind === 'service_out' ? await openRentalOf(tx, v.id) : null;
    to = eventTargetState(input.kind, open != null);
    if (open && to === 'rented') backTo = open.id;
  }
  await tx.vehicleEvent.create({
    data: {
      vehicleId: v.id,
      kind: input.kind,
      occurredOn: dateFromISO(input.occurredOn)!,
      fromState: from,
      toState: to,
      rentalId: input.rentalId ?? backTo,
      reason: input.reason ?? null,
      actorId: input.actorId,
    },
  });
  await tx.vehicle.update({
    where: { id: v.id },
    data: {
      state: to,
      currentRentalId: input.kind === 'pickup' ? (input.rentalId ?? null) : to === 'rented' ? (backTo ?? v.currentRentalId) : null,
      // A moped that has left for a customer is at that customer, not at a
      // point of ours. Keeping the yard it left would be a second answer to
      // "where is it", and the wrong one.
      locationId: to === 'rented' ? null : v.locationId,
      updatedAt: new Date(),
    },
  });
  return { from, to };
}

/**
 * Moving a moped between the rental park and the sale park (ADR-0005). It is
 * a decision, so it is an event — but the moped does not move an inch, so the
 * state is repeated unchanged and only the park changes. A moped that is
 * already in that park is left alone rather than given a second event saying
 * nothing happened.
 */
export async function movePool(
  tx: Tx,
  input: { vehicleId: string; pool: VehiclePool; occurredOn: string; actorId: string | null; reason?: string | null },
): Promise<{ from: VehiclePool | null; to: VehiclePool; changed: boolean }> {
  const v = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });
  const from = (v.pool ?? null) as VehiclePool | null;
  if (from === input.pool) return { from, to: input.pool, changed: false };
  await tx.vehicleEvent.create({
    data: {
      vehicleId: v.id,
      kind: POOL_EVENT[input.pool],
      occurredOn: dateFromISO(input.occurredOn)!,
      fromState: v.state,
      toState: v.state,
      fromPool: from,
      toPool: input.pool,
      reason: input.reason ?? null,
      actorId: input.actorId,
    },
  });
  await tx.vehicle.update({ where: { id: v.id }, data: { pool: input.pool, updatedAt: new Date() } });
  return { from, to: input.pool, changed: true };
}
