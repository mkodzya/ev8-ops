import { EVENT_TARGET_STATE, type VehicleEventKind, type VehicleState } from '@ev8/shared';
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
      updatedAt: new Date(),
    },
  });
  return { from, to };
}
