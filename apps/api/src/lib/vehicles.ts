import { EVENT_TARGET_STATE, POOL_EVENT, type VehicleEventKind, type VehiclePool, type VehicleState } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { dateFromISO } from './dates.js';
import { conflict } from './errors.js';

type Tx = Prisma.TransactionClient;

/**
 * The one way a vehicle changes state (FLT-03): an event is written, the
 * state follows from it. `manual` carries its target and a reason.
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
  if (input.kind === 'manual') {
    if (!input.toState) throw new Error('manual move needs a target state');
    if (!input.reason) throw conflict('reason_required', 'A manual state change needs a reason.');
    if (input.toState === 'rented') throw conflict('use_rental', 'A moped becomes rented through a hand-over, not by hand.');
    to = input.toState;
  } else {
    if (input.kind === 'to_rent' || input.kind === 'to_sale') throw new Error('a park move goes through movePool');
    to = EVENT_TARGET_STATE[input.kind];
  }
  await tx.vehicleEvent.create({
    data: {
      vehicleId: v.id,
      kind: input.kind,
      occurredOn: dateFromISO(input.occurredOn)!,
      fromState: from,
      toState: to,
      rentalId: input.rentalId ?? null,
      reason: input.reason ?? null,
      actorId: input.actorId,
    },
  });
  await tx.vehicle.update({
    where: { id: v.id },
    data: {
      state: to,
      currentRentalId: input.kind === 'pickup' ? input.rentalId ?? null : to === 'rented' ? v.currentRentalId : null,
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
