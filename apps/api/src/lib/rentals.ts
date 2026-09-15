import { periodsThrough, canPickUp, type VehicleState } from '@ev8/shared';
import { audit } from './audit.js';
import { dateFromISO } from './dates.js';
import { prisma } from './db.js';
import { conflict, notFound } from './errors.js';
import { movePool, moveVehicle } from './vehicles.js';

// Hand-over and return (RNT-01, RNT-04, RNT-05). Each is one transaction:
// the rental, its first period, the deposit, the act and the vehicle event
// appear together or not at all.

export interface PickupInput {
  actorId: string;
  customerId: string;
  vehicleId: string | null;
  vinNote: string | null;
  weeklyRateTetri: number;
  depositTetri: number;
  pickedUpOn: string;
  expectedReturnOn: string | null;
  odometerKm: number | null;
  condition: string | null;
  notes: string | null;
  buyoutTargetTetri: number | null;
  buyoutPerPaymentTetri: number | null;
  nightParkingAddress: string | null;
  batteries: number | null;
  chargers: number | null;
  today: string;
}

export async function pickUp(input: PickupInput): Promise<{ id: string; number: string; actId: string }> {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer || customer.archived) throw notFound('customer_not_found', 'No such customer.');

  return prisma.$transaction(async (tx) => {
    if (input.vehicleId) {
      const v = await tx.vehicle.findUnique({ where: { id: input.vehicleId } });
      if (!v || v.archived) throw notFound('vehicle_not_found', 'No such moped.');
      if (!canPickUp(v.state as VehicleState)) {
        throw conflict('vehicle_not_available', 'This moped cannot be handed over in its current state.', {
          state: v.state,
        });
      }
    }
    const rental = await tx.rental.create({
      data: {
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        vinUnconfirmed: !input.vehicleId,
        vinNote: input.vinNote,
        weeklyRateTetri: input.weeklyRateTetri,
        depositTetri: input.depositTetri,
        pickedUpOn: dateFromISO(input.pickedUpOn)!,
        expectedReturnOn: dateFromISO(input.expectedReturnOn),
        status: 'active',
        notes: input.notes,
        buyoutTargetTetri: input.buyoutTargetTetri,
        buyoutPerPaymentTetri: input.buyoutPerPaymentTetri,
        nightParkingAddress: input.nightParkingAddress,
        batteries: input.batteries,
        chargers: input.chargers,
        createdById: input.actorId,
      },
    });
    // Every period that should exist by today (usually one); the worker
    // continues from here each night.
    for (const p of periodsThrough(input.pickedUpOn, input.today)) {
      await tx.rentalPeriod.create({
        data: {
          rentalId: rental.id,
          seq: p.seq,
          startsOn: dateFromISO(p.startsOn)!,
          endsOn: dateFromISO(p.endsOn)!,
          amountTetri: input.weeklyRateTetri,
        },
      });
    }
    await tx.deposit.create({ data: { rentalId: rental.id, amountTetri: input.depositTetri, status: 'held' } });
    const act = await tx.act.create({
      data: {
        rentalId: rental.id,
        kind: 'pickup',
        occurredOn: dateFromISO(input.pickedUpOn)!,
        odometerKm: input.odometerKm,
        condition: input.condition,
        createdById: input.actorId,
      },
    });
    if (input.vehicleId) {
      // Handing a moped to a renter is the decision that it is a rental
      // moped; nobody should have to say so twice. A moped already in the
      // rental park gets no second event out of this (ADR-0005).
      await movePool(tx, {
        vehicleId: input.vehicleId,
        pool: 'rent',
        occurredOn: input.pickedUpOn,
        actorId: input.actorId,
        reason: `hand-over ${rental.number}`,
      });
      await moveVehicle(tx, {
        vehicleId: input.vehicleId,
        kind: 'pickup',
        occurredOn: input.pickedUpOn,
        actorId: input.actorId,
        rentalId: rental.id,
      });
      if (input.odometerKm != null) await tx.vehicle.update({ where: { id: input.vehicleId }, data: { odometerKm: input.odometerKm } });
    }
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'rental.pickup',
        entityType: 'rental',
        entityId: rental.id,
        after: { number: rental.number, customerId: input.customerId, vehicleId: input.vehicleId, weeklyRateTetri: input.weeklyRateTetri, depositTetri: input.depositTetri, pickedUpOn: input.pickedUpOn },
      },
    });
    return { id: rental.id, number: rental.number, actId: act.id };
  });
}

export interface ReturnInput {
  actorId: string;
  rentalId: string;
  returnedOn: string;
  odometerKm: number | null;
  condition: string | null;
  /** The return act's per-item checklist, as the paper form has it. */
  items: Record<string, { state: string; note: string | null }>;
  /** Present only when the actor may decide on the deposit (director, owner). */
  deposit: null | {
    returnedTetri: number;
    withheldTetri: number;
    withheldReason: string | null;
    returnedTo: string | null;
    grounds: string[];
  };
  canConfirm: boolean; // owner: withholdings and third-party returns are final at once
}

export async function returnRental(input: ReturnInput): Promise<{ actId: string }> {
  return prisma.$transaction(async (tx) => {
    const r = await tx.rental.findUnique({ where: { id: input.rentalId }, include: { deposit: true } });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    if (r.status === 'returned') throw conflict('already_returned', 'This rental is already closed.');
    const pickedUpOn = r.pickedUpOn?.toISOString().slice(0, 10) ?? null;
    if (pickedUpOn && input.returnedOn < pickedUpOn) throw conflict('return_before_pickup', 'Return date is before the pickup date.');

    await tx.rental.update({
      where: { id: r.id },
      data: { status: 'returned', returnedOn: dateFromISO(input.returnedOn)!, updatedAt: new Date() },
    });
    // Periods that start after the return day are not owed (RNT-04). Whether
    // the last one is charged in full or pro rata is an open question for the
    // owner; until decided the full week stays.
    await tx.rentalPeriod.deleteMany({ where: { rentalId: r.id, startsOn: { gt: dateFromISO(input.returnedOn)! }, paidTetri: 0 } });
    const act = await tx.act.create({
      data: {
        rentalId: r.id,
        kind: 'return',
        occurredOn: dateFromISO(input.returnedOn)!,
        odometerKm: input.odometerKm,
        condition: input.condition,
        items: input.items,
        createdById: input.actorId,
      },
    });
    if (r.vehicleId) {
      await moveVehicle(tx, { vehicleId: r.vehicleId, kind: 'return', occurredOn: input.returnedOn, actorId: input.actorId, rentalId: r.id });
      if (input.odometerKm != null) await tx.vehicle.update({ where: { id: r.vehicleId }, data: { odometerKm: input.odometerKm } });
    }
    if (input.deposit && r.deposit) {
      const d = input.deposit;
      const total = d.returnedTetri + d.withheldTetri;
      if (total > r.deposit.amountTetri) throw conflict('deposit_split', 'Returned plus withheld exceeds the deposit.');
      if (d.withheldTetri > 0 && !d.withheldReason) throw conflict('reason_required', 'Withholding needs a reason.');
      const status = d.withheldTetri === 0 ? 'returned' : d.returnedTetri === 0 ? 'withheld' : 'partial';
      const needsOwner = d.withheldTetri > 0 || !!d.returnedTo;
      await tx.deposit.update({
        where: { id: r.deposit.id },
        data: {
          status,
          returnedTetri: d.returnedTetri,
          withheldTetri: d.withheldTetri,
          withheldReason: d.withheldReason,
          withheldGrounds: d.grounds,
          returnedTo: d.returnedTo,
          returnedOn: dateFromISO(input.returnedOn),
          decidedById: input.actorId,
          confirmedById: needsOwner ? (input.canConfirm ? input.actorId : null) : input.actorId,
          updatedAt: new Date(),
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'rental.return',
        entityType: 'rental',
        entityId: r.id,
        before: { status: r.status },
        after: { status: 'returned', returnedOn: input.returnedOn, deposit: input.deposit },
      },
    });
    return { actId: act.id };
  });
}

export { audit };
