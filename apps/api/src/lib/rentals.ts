import { acquiringFee, canPickUp, periodsThrough, returnSettlement, type Settlement, type VehicleState } from '@ev8/shared';
import { createHash } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from './audit.js';
import { hasPerm, type Actor } from './auth.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { debtOf } from './debt.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { recomputeRental, recordPaymentTx } from './payments.js';
import { rentalOwed, spreadRental, syncDeposit, writeAllocations } from './rentalMoney.js';
import { movePool, moveVehicle } from './vehicles.js';
import { itemLabel } from './pdf/returnAct.js';

// Hand-over and return (RNT-01, RNT-04, RNT-05; redesign wave 3). Each is one
// transaction: whatever it makes — a new customer, the rental, its weeks, the
// deposit, the act, the first payment, the charges and the decision on the
// deposit — appears together or not at all, under one operation key (B2-01).

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Hand-over
// ---------------------------------------------------------------------------

export interface NewCustomer {
  name: string;
  /** Where they came from (wave 4 §3.5); optional. */
  source?: string | null;
  phone: string;
  personalId: string;
  nameKa: string | null;
  nameLat: string | null;
  /** The ID card, as a picture: a customer is not made without it (В2). */
  idPhoto: { bytes: Buffer; mime: string } | null;
  licencePhoto: { bytes: Buffer; mime: string } | null;
}

export interface PickupInput {
  actor: Actor;
  today: string;
  customerId: string | null;
  newCustomer: NewCustomer | null;
  vehicleId: string | null;
  vinNote: string | null;
  /** An owner agreed to move a moped from the sale park (Q9). */
  moveFromSale: boolean;
  weeklyRateTetri: number;
  depositTetri: number;
  pickedUpOn: string;
  expectedReturnOn: string | null;
  odometerKm: number | null;
  odometerReason: string | null;
  condition: string | null;
  notes: string | null;
  buyoutTargetTetri: number | null;
  buyoutPerPaymentTetri: number | null;
  nightParkingAddress: string | null;
  batteries: number | null;
  chargers: number | null;
  /** The wizard's first payment; `later` is a choice too (B4-01). Null: an older client that does not ask. */
  payment: null | { later: true } | { later: false; channel: 'cash' | 'acquiring' | 'transfer'; amountTetri: number };
  /** An existing rental brought over, an owner only (B3-02). */
  transfer: null | { paidThrough: string | null; depositReceivedTetri: number };
  /** An owner handing a moped to a customer who owes (В2). */
  debtOverrideReason: string | null;
  /** The wizard asks for everything the contract needs; older clients do not. */
  strict: boolean;
}

export interface PickupResult {
  id: string;
  number: string;
  actId: string;
  customerId: string;
  paymentId: string | null;
}

export async function pickUp(input: PickupInput): Promise<PickupResult> {
  const owner = hasPerm(input.actor, 'payments.reconcile');
  if (input.pickedUpOn > input.today) throw badRequest('future_date', 'A moped is not handed over tomorrow.', { field: 'pickedUpOn' });
  if (input.expectedReturnOn && input.expectedReturnOn < input.pickedUpOn) {
    throw badRequest('return_before_pickup', 'The planned return is before the hand-over.', { field: 'expectedReturnOn' });
  }
  if (input.strict && !input.nightParkingAddress?.trim()) {
    throw badRequest('missing_field', 'The night parking address is in the contract (§5).', { field: 'nightParkingAddress' });
  }
  if (input.transfer) {
    if (!owner) throw forbidden('owner_only', 'Only an owner brings a rental over.');
    if (input.pickedUpOn >= input.today) throw badRequest('transfer_date', 'A rental brought over began before today.', { field: 'pickedUpOn' });
    if (input.transfer.depositReceivedTetri > input.depositTetri) {
      throw badRequest('bad_field', 'More deposit received than the contract asks.', { field: 'depositReceivedTetri' });
    }
  } else if (input.strict && input.odometerKm == null) {
    throw badRequest('missing_field', 'The mileage goes into the act.', { field: 'odometerKm' });
  }
  if (input.strict && !input.transfer && !input.payment) {
    throw badRequest('missing_field', 'Say how the first payment is made, or that it comes later.', { field: 'payment' });
  }
  // A manager takes cash and cards at the counter; a transfer is an owner's (wave 3 §3.1).
  if (input.payment && !input.payment.later && input.payment.channel === 'transfer' && !owner) {
    throw forbidden('reconcile_required', 'Only an owner enters bank payments.');
  }

  // Who it is: an existing card, or a new one made here (B4-03).
  let customerId = input.customerId;
  if (!customerId && !input.newCustomer) throw badRequest('missing_field', 'customerId is required', { field: 'customerId' });
  if (input.newCustomer) {
    const c = input.newCustomer;
    for (const [field, v] of [
      ['name', c.name],
      ['phone', c.phone],
      ['personalId', c.personalId],
    ] as const) {
      if (!v?.trim()) throw badRequest('missing_field', `${field} is required`, { field });
    }
    if (!c.idPhoto) throw badRequest('missing_field', 'A photo of the ID card is required.', { field: 'idPhoto' });
    const twin = await prisma.customer.findFirst({
      where: { archived: false, OR: [{ phone: c.phone.trim() }, { personalId: c.personalId.trim() }] },
      select: { id: true, name: true },
    });
    if (twin) throw conflict('duplicate_customer', 'A customer with this phone or personal number exists.', { existing: twin, field: 'phone' });
  } else {
    const c = await prisma.customer.findUnique({ where: { id: customerId! } });
    if (!c || c.archived) throw notFound('customer_not_found', 'No such customer.');
    // A customer who owes: a manager stops, an owner may go on with a reason (В2).
    const debt = await debtOf(c.id);
    if (debt.owesTetri > 0) {
      if (!owner) throw forbidden('customer_in_debt', 'A customer who owes gets a new rental from an owner only.', { owesTetri: debt.owesTetri });
      if (!input.debtOverrideReason?.trim()) {
        throw badRequest('missing_field', 'Say why a customer who owes gets a moped.', { field: 'debtOverrideReason', owesTetri: debt.owesTetri });
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    let vehicle: { id: string; pool: string | null } | null = null;
    if (input.vehicleId) {
      const v = await tx.vehicle.findUnique({ where: { id: input.vehicleId } });
      if (!v || v.archived) throw notFound('vehicle_not_found', 'No such moped.');
      if (!canPickUp(v.state as VehicleState)) {
        throw conflict('vehicle_not_available', 'This moped cannot be handed over in its current state.', { state: v.state, field: 'vehicleId' });
      }
      if (v.pool === 'sale') {
        if (!owner) throw forbidden('vehicle_in_sale_pool', 'A moped of the sale park goes to rent by an owner.', { field: 'vehicleId' });
        if (!input.moveFromSale) throw conflict('vehicle_in_sale_pool', 'This moped is in the sale park; confirm the move to rent.', { field: 'vehicleId' });
      }
      // Mileage below the last act's only with a reason (B4-06).
      if (input.odometerKm != null && v.odometerKm != null && input.odometerKm < v.odometerKm && !input.odometerReason?.trim()) {
        throw badRequest('odometer_below', 'The mileage is below the last act; say why.', { field: 'odometerReason', lastKm: v.odometerKm });
      }
      vehicle = { id: v.id, pool: v.pool };
    }

    if (input.newCustomer) {
      const c = input.newCustomer;
      const made = await tx.customer.create({
        data: { name: c.name.trim(), phone: c.phone.trim(), personalId: c.personalId.trim(), nameKa: c.nameKa, nameLat: c.nameLat, kind: 'person', source: c.source ?? null },
      });
      customerId = made.id;
      for (const [doc, kind] of [
        [c.idPhoto, 'id_card'],
        [c.licencePhoto, 'driver_licence'],
      ] as const) {
        if (!doc) continue;
        await tx.storedFile.create({
          data: {
            kind: 'customer_document',
            customerId: made.id,
            docKind: kind,
            label: kind,
            mimeType: doc.mime,
            sizeBytes: doc.bytes.length,
            sha256: createHash('sha256').update(doc.bytes).digest('hex'),
            bytes: new Uint8Array(doc.bytes),
            uploadedById: input.actor.id,
          },
        });
      }
      await tx.auditLog.create({
        data: { actorId: input.actor.id, action: 'customer.create', entityType: 'customer', entityId: made.id, after: { name: c.name, phone: c.phone, inPickup: true } },
      });
    }

    const rental = await tx.rental.create({
      data: {
        customerId: customerId!,
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
        createdById: input.actor.id,
        debtOverrideReason: input.debtOverrideReason?.trim() || null,
        transferredAt: input.transfer ? new Date() : null,
        transferredById: input.transfer ? input.actor.id : null,
      },
    });
    // Every week that should exist by today; the nightly run goes on from here.
    // Brought over: the weeks up to "paid through" were paid before the move,
    // not revenue of this period (Q3).
    const paidThrough = input.transfer?.paidThrough ?? null;
    const weeks = periodsThrough(input.pickedUpOn, input.today);
    if (paidThrough && !weeks.some((p) => p.endsOn === paidThrough)) {
      throw badRequest('bad_field', 'Paid through is the last day of a week.', { field: 'paidThrough' });
    }
    for (const p of weeks) {
      await tx.rentalPeriod.create({
        data: {
          rentalId: rental.id,
          seq: p.seq,
          startsOn: dateFromISO(p.startsOn)!,
          endsOn: dateFromISO(p.endsOn)!,
          amountTetri: input.weeklyRateTetri,
          paidBeforeTransfer: !!paidThrough && p.endsOn <= paidThrough,
        },
      });
    }
    await tx.deposit.create({
      data: { rentalId: rental.id, amountTetri: input.depositTetri, status: 'held', receivedBeforeTransferTetri: input.transfer?.depositReceivedTetri ?? 0 },
    });
    const act = await tx.act.create({
      data: {
        rentalId: rental.id,
        kind: 'pickup',
        occurredOn: dateFromISO(input.pickedUpOn)!,
        odometerKm: input.odometerKm,
        odometerReason: input.odometerReason?.trim() || null,
        condition: input.condition,
        createdById: input.actor.id,
      },
    });
    if (vehicle) {
      // Handing a moped to a renter is the decision that it is a rental moped (ADR-0005, Q9).
      await movePool(tx, { vehicleId: vehicle.id, pool: 'rent', occurredOn: input.pickedUpOn, actorId: input.actor.id, reason: `hand-over ${rental.number}` });
      await moveVehicle(tx, { vehicleId: vehicle.id, kind: 'pickup', occurredOn: input.pickedUpOn, actorId: input.actor.id, rentalId: rental.id });
      if (input.odometerKm != null) await tx.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: input.odometerKm } });
    }
    await recomputeRental(tx, rental.id);

    let paymentId: string | null = null;
    if (input.payment && !input.payment.later && input.payment.amountTetri > 0) {
      const gross = input.payment.amountTetri;
      const p = await recordPaymentTx(tx, {
        actorId: input.actor.id,
        occurredOn: input.today,
        channel: input.payment.channel,
        grossTetri: gross,
        feeTetri: input.payment.channel === 'acquiring' ? acquiringFee(gross) : 0,
        customerId: customerId!,
        rentalId: rental.id,
        bankText: null,
        note: null,
        source: 'manual',
        kind: 'rent',
      });
      paymentId = p.id;
    }

    await tx.auditLog.create({
      data: {
        actorId: input.actor.id,
        action: input.transfer ? 'rental.transfer' : 'rental.pickup',
        entityType: 'rental',
        entityId: rental.id,
        after: {
          number: rental.number,
          customerId,
          vehicleId: input.vehicleId,
          weeklyRateTetri: input.weeklyRateTetri,
          depositTetri: input.depositTetri,
          pickedUpOn: input.pickedUpOn,
          transfer: input.transfer,
          debtOverrideReason: input.debtOverrideReason,
          payment: input.payment,
          movedFromSale: vehicle?.pool === 'sale',
        },
        note: input.debtOverrideReason,
      },
    });
    return { id: rental.id, number: rental.number, actId: act.id, customerId: customerId!, paymentId };
  });
}

// ---------------------------------------------------------------------------
// Return
// ---------------------------------------------------------------------------

export interface DepositDecision {
  action: 'return_all' | 'withhold';
  withheldTetri: number;
  grounds: string[];
  reason: string | null;
  returnedTo: string | null;
  returnedToReason: string | null;
}

export interface ReturnInput {
  actor: Actor;
  today: string;
  rentalId: string;
  returnedOn: string;
  odometerKm: number | null;
  condition: string | null;
  /** By what was handed over: moped, key, battery_1…N, charger_1…N (B5-07). */
  items: Record<string, { state: 'ok' | 'damaged' | 'missing'; note: string | null }>;
  /** Where the moped stands now (B5-06). */
  toService: boolean;
  locationId: string | null;
  lateChoice: 'week' | 'late' | null;
  /** An owner's decision on the deposit; none — it waits for one (D8). */
  decision: DepositDecision | null;
}

type PeriodRow = { id: string; seq: number; startsOn: Date; endsOn: Date; amountTetri: number; paidTetri: number };

/** The weeks there are, plus any the nightly run has not opened yet by the return day. */
function withWeeksThrough(r: { pickedUpOn: Date | null; weeklyRateTetri: number; periods: PeriodRow[] }, returnedOn: string) {
  const have = r.periods.map((p) => ({ id: p.id, seq: p.seq, startsOn: isoDate(p.startsOn)!, endsOn: isoDate(p.endsOn)!, amountTetri: p.amountTetri, paidTetri: p.paidTetri }));
  const pickedUpOn = isoDate(r.pickedUpOn);
  if (!pickedUpOn) return have;
  const seqs = new Set(have.map((p) => p.seq));
  for (const p of periodsThrough(pickedUpOn, returnedOn)) {
    if (!seqs.has(p.seq)) have.push({ id: `new-${p.seq}`, seq: p.seq, startsOn: p.startsOn, endsOn: p.endsOn, amountTetri: r.weeklyRateTetri, paidTetri: 0 });
  }
  return have.filter((p) => p.startsOn <= returnedOn || p.paidTetri > 0).sort((a, b) => a.seq - b.seq);
}

/** What the return would come to, without writing (wave 3 §3.4, step 2). */
export async function returnPreview(input: { rentalId: string; returnedOn: string; keyMissing: boolean; lateChoice: 'week' | 'late' | null }) {
  const r = await prisma.rental.findUnique({
    where: { id: input.rentalId },
    include: {
      periods: { orderBy: { seq: 'asc' } },
      acts: { where: { kind: 'pickup' }, select: { odometerKm: true } },
      deposit: {
        include: {
          withholdings: { where: { voidedAt: null }, include: { serviceJob: { select: { number: true } } } },
          payouts: { where: { voidedAt: null }, select: { grossTetri: true } },
        },
      },
      charges: { where: { voidedAt: null }, include: { allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } } },
    },
  });
  if (!r) throw notFound('rental_not_found', 'No such rental.');
  const periods = withWeeksThrough(r, input.returnedOn);
  const settlement = returnSettlement({ returnedOn: input.returnedOn, expectedReturnOn: isoDate(r.expectedReturnOn), periods, keyMissing: input.keyMissing, lateChoice: input.lateChoice });
  const d = r.deposit;
  const withheld = d?.withholdings.reduce((n, w) => n + w.amountTetri, 0) ?? 0;
  const paidOut = d ? d.paidOutBeforeTetri + d.payouts.reduce((n, p) => n + p.grossTetri, 0) : 0;
  const openCharges = r.charges.reduce((n, c) => n + Math.max(0, c.amountTetri - c.allocations.reduce((m, a) => m + a.amountTetri, 0)), 0);
  return {
    batteries: r.batteries,
    chargers: r.chargers,
    pickupKm: r.acts[0]?.odometerKm ?? null,
    expectedReturnOn: isoDate(r.expectedReturnOn),
    settlement,
    otherChargesTetri: openCharges,
    deposit: d
      ? {
          amountTetri: d.amountTetri,
          receivedTetri: d.paidTetri,
          withholdings: d.withholdings.map((w) => ({ source: w.source, amountTetri: w.amountTetri, number: w.serviceJob?.number ?? null, reason: w.reason })),
          withheldTetri: withheld,
          paidOutTetri: paidOut,
          heldTetri: Math.max(0, d.paidTetri - withheld - paidOut),
          decided: d.decidedById != null && d.status !== 'held',
        }
      : null,
  };
}

export async function returnRental(input: ReturnInput): Promise<{ actId: string; serviceJobId: string | null }> {
  const owner = hasPerm(input.actor, 'deposit.decide');
  if (input.decision && !owner) throw forbidden('deposit_decision_forbidden', 'Only an owner decides on a deposit.');
  if (input.returnedOn > input.today) throw badRequest('future_date', 'A return is not dated in the future.', { field: 'returnedOn' });
  if (input.odometerKm == null) throw badRequest('missing_field', 'The mileage goes into the act.', { field: 'odometerKm' });

  return prisma.$transaction(async (tx) => {
    const r = await tx.rental.findUnique({
      where: { id: input.rentalId },
      include: { deposit: true, acts: { where: { kind: 'pickup' }, select: { odometerKm: true } }, periods: { orderBy: { seq: 'asc' } } },
    });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    if (r.status === 'returned') throw conflict('already_returned', 'This rental is already closed.');
    const pickedUpOn = isoDate(r.pickedUpOn);
    if (pickedUpOn && input.returnedOn < pickedUpOn) throw conflict('return_before_pickup', 'Return date is before the pickup date.', { field: 'returnedOn' });
    // Less than at the hand-over is a mistake, not a moped that went backwards (B5-05).
    const pickupKm = r.acts[0]?.odometerKm ?? null;
    if (pickupKm != null && input.odometerKm! < pickupKm) {
      throw conflict('odometer_below_pickup', 'The mileage is below the hand-over’s.', { field: 'odometerKm', pickupKm });
    }

    // The weeks by the return day exist before anything is counted.
    for (const p of withWeeksThrough(r, input.returnedOn).filter((x) => x.id.startsWith('new-'))) {
      await tx.rentalPeriod.create({ data: { rentalId: r.id, seq: p.seq, startsOn: dateFromISO(p.startsOn)!, endsOn: dateFromISO(p.endsOn)!, amountTetri: p.amountTetri } });
    }
    // Weeks that would begin after the return are not owed (RNT-04).
    await tx.rentalPeriod.deleteMany({ where: { rentalId: r.id, startsOn: { gt: dateFromISO(input.returnedOn)! }, paidTetri: 0 } });
    const periods = await tx.rentalPeriod.findMany({ where: { rentalId: r.id }, orderBy: { seq: 'asc' } });
    const settlement = returnSettlement({
      returnedOn: input.returnedOn,
      expectedReturnOn: isoDate(r.expectedReturnOn),
      periods: periods.map((p) => ({ id: p.id, seq: p.seq, startsOn: isoDate(p.startsOn)!, endsOn: isoDate(p.endsOn)!, amountTetri: p.amountTetri, paidTetri: p.paidTetri })),
      keyMissing: input.items.key?.state === 'missing',
      lateChoice: input.lateChoice,
    });

    await tx.rental.update({ where: { id: r.id }, data: { status: 'returned', returnedOn: dateFromISO(input.returnedOn)!, updatedAt: new Date() } });
    const applied = await applyCharges(tx, input.actor.id, r.id, settlement);

    const lostBatteries = Object.entries(input.items).filter(([k, v]) => k.startsWith('battery_') && v.state === 'missing').length;
    if (lostBatteries > 0) {
      await tx.batteryMove.create({
        data: { kind: 'lost', qty: lostBatteries, reason: `${r.number}: ${input.items.battery_1?.note ?? ''}`.trim(), rentalId: r.id, occurredOn: dateFromISO(input.returnedOn)!, createdById: input.actor.id },
      });
    }
    const damaged = Object.entries(input.items).filter(([, v]) => v.state === 'damaged');
    let serviceJobId: string | null = null;
    const toService = input.toService || damaged.length > 0;
    if (r.vehicleId) {
      await moveVehicle(tx, { vehicleId: r.vehicleId, kind: 'return', occurredOn: input.returnedOn, actorId: input.actor.id, rentalId: r.id });
      await tx.vehicle.update({ where: { id: r.vehicleId }, data: { odometerKm: input.odometerKm } });
      if (toService) {
        // Damage in the act opens a repair as a draft (wave 3 §3.4; the section itself is wave 5).
        // What the act says was damaged, in the act's own words: the moped by its note, a key or a battery by its name.
        const reason = damaged.map(([k, v]) => (k === 'moped' ? v.note?.trim() || itemLabel(k).ka : [itemLabel(k).ka, v.note?.trim()].filter(Boolean).join(': '))).join('; ') || `after return ${r.number}`;
        const job = await tx.serviceJob.create({
          data: {
            vehicleId: r.vehicleId,
            rentalId: r.id,
            customerId: r.customerId,
            reason: `${r.number}: ${reason}`.slice(0, 1000),
            openedOn: dateFromISO(input.returnedOn)!,
            payer: 'company',
            movedVehicle: true,
            createdById: input.actor.id,
          },
          select: { id: true, number: true },
        });
        serviceJobId = job.id;
        await moveVehicle(tx, { vehicleId: r.vehicleId, kind: 'service_in', occurredOn: input.returnedOn, actorId: input.actor.id, reason: job.number });
      } else if (input.locationId) {
        const loc = await tx.location.findUnique({ where: { id: input.locationId }, select: { id: true, archived: true } });
        if (!loc || loc.archived) throw notFound('location_not_found', 'No such point.');
        await tx.vehicle.update({ where: { id: r.vehicleId }, data: { locationId: loc.id } });
      }
    }

    const act = await tx.act.create({
      data: {
        rentalId: r.id,
        kind: 'return',
        occurredOn: dateFromISO(input.returnedOn)!,
        odometerKm: input.odometerKm,
        condition: input.condition,
        items: input.items,
        locationId: toService ? null : input.locationId,
        settlement: { ...settlementRecord(settlement), ...applied, serviceJobId } as object,
        createdById: input.actor.id,
      },
    });
    await recomputeRental(tx, r.id);
    if (input.decision) await applyDecision(tx, input.actor, r.id, input.decision, input.returnedOn);

    await tx.auditLog.create({
      data: {
        actorId: input.actor.id,
        action: 'rental.return',
        entityType: 'rental',
        entityId: r.id,
        before: { status: r.status },
        after: { status: 'returned', returnedOn: input.returnedOn, settlement: settlementRecord(settlement), decision: (input.decision ?? null) as object | null, serviceJobId },
      },
    });
    return { actId: act.id, serviceJobId };
  });
}

function settlementRecord(s: Settlement) {
  return { weeks: s.weeks.map((w) => ({ seq: w.seq, owesTetri: w.owesTetri })), late: s.late, choice: s.choice, keyTetri: s.keyTetri, claimsTetri: s.claimsTetri };
}

/** The key, and the delay instead of the weeks it replaces; what was changed is kept so a cancelled return puts it back. */
async function applyCharges(tx: Tx, actorId: string, rentalId: string, s: Settlement): Promise<{ chargeIds: string[]; replaced: { id: string; amountTetri: number }[] }> {
  const chargeIds: string[] = [];
  const replaced: { id: string; amountTetri: number }[] = [];
  if (s.keyTetri > 0) {
    chargeIds.push((await tx.rentalCharge.create({ data: { rentalId, kind: 'key', amountTetri: s.keyTetri, note: 'contract §6', createdById: actorId } })).id);
  }
  if (s.choice === 'late' && s.late) {
    for (const w of s.replacedWeeks) {
      const p = await tx.rentalPeriod.findUniqueOrThrow({ where: { id: w.id } });
      replaced.push({ id: p.id, amountTetri: p.amountTetri });
      // The week the delay stands for is charged no further than it was paid.
      await tx.rentalPeriod.update({ where: { id: p.id }, data: { amountTetri: p.paidTetri, updatedAt: new Date() } });
    }
    chargeIds.push(
      (await tx.rentalCharge.create({ data: { rentalId, kind: 'late', amountTetri: s.late.amountTetri, note: `${s.late.days} × ${s.late.perDayTetri / 100}`, createdById: actorId } })).id,
    );
  }
  return { chargeIds, replaced };
}

/**
 * An owner's decision on a deposit (wave 3 §3.4 step 2, §3.5; D18: one owner
 * decides). What is kept pays what the return left owed — the weeks, the key,
 * the delay — as a payment from the deposit; kept beyond that is a charge of
 * its own (damage, cleaning…), paid by the same money. What goes back is
 * handed over later through the money form (wave 2).
 */
export async function applyDecision(tx: Tx, actor: Actor, rentalId: string, decision: DepositDecision, on: string): Promise<void> {
  const d = await tx.deposit.findUnique({
    where: { rentalId },
    include: {
      withholdings: { where: { voidedAt: null } },
      payouts: { where: { voidedAt: null }, select: { grossTetri: true } },
      rental: { select: { customerId: true } },
    },
  });
  if (!d) throw notFound('deposit_not_found', 'No deposit on this rental.');
  if (d.decidedById && d.status !== 'held') throw conflict('deposit_decided', 'This deposit is already decided.');
  const withheldBefore = d.withholdings.reduce((n, w) => n + w.amountTetri, 0);
  const paidOut = d.paidOutBeforeTetri + d.payouts.reduce((n, p) => n + p.grossTetri, 0);
  const held = Math.max(0, d.paidTetri - withheldBefore - paidOut);
  const keep = decision.action === 'return_all' ? 0 : decision.withheldTetri;
  if (keep > held) throw conflict('over_held', 'More than the deposit holds cannot be kept.', { field: 'withheldTetri', heldTetri: held });
  if (keep > 0) {
    if (decision.grounds.length === 0) throw badRequest('missing_field', 'Say on what grounds.', { field: 'grounds' });
    if (!decision.reason?.trim()) throw badRequest('missing_field', 'Say why.', { field: 'reason' });
  }
  if (decision.returnedTo?.trim() && !decision.returnedToReason?.trim()) {
    throw badRequest('missing_field', 'Say why the deposit goes to someone else.', { field: 'returnedToReason' });
  }

  if (keep > 0) {
    const payment = await tx.payment.create({
      data: {
        occurredOn: dateFromISO(on)!,
        direction: 'in',
        channel: 'deposit',
        source: 'deposit',
        kind: 'rent',
        grossTetri: keep,
        feeTetri: 0,
        netTetri: keep,
        customerId: d.rental.customerId,
        rentalId,
        note: decision.reason,
        createdById: actor.id,
      },
      select: { id: true },
    });
    const spread = spreadRental(keep, await rentalOwed(tx, rentalId), { deposit: false });
    const allocations = [...spread.allocations];
    if (spread.leftoverTetri > 0) {
      const extra = await tx.rentalCharge.create({ data: { rentalId, kind: 'withheld', amountTetri: spread.leftoverTetri, note: decision.reason, createdById: actor.id } });
      allocations.push({ target: 'charge', id: extra.id, amountTetri: spread.leftoverTetri });
    }
    await writeAllocations(tx, payment.id, allocations);
    await tx.depositWithholding.create({
      data: { depositId: d.id, source: 'return', rentalId, amountTetri: keep, grounds: decision.grounds, reason: decision.reason!.trim(), paymentId: payment.id, createdById: actor.id },
    });
  }
  await syncDeposit(tx, d.id);
  const back = held - keep;
  await tx.deposit.update({
    where: { id: d.id },
    data: {
      status: keep === 0 ? 'returned' : back === 0 ? 'withheld' : 'partial',
      returnedTetri: back,
      returnedTo: decision.returnedTo?.trim() || null,
      returnedOn: dateFromISO(on),
      decidedById: actor.id,
      confirmedById: actor.id,
      notes: decision.returnedToReason?.trim() || d.notes,
      updatedAt: new Date(),
    },
  });
  await recomputeRental(tx, rentalId);
  // The return act says what was decided: the copy made before is archived (B5-07).
  await tx.storedFile.updateMany({ where: { rentalId, kind: 'pdf', docKind: 'return_act', archived: false }, data: { archived: true } });
  await tx.auditLog.create({
    data: { actorId: actor.id, action: 'deposit.decide', entityType: 'deposit', entityId: d.id, after: { ...decision, heldTetri: held, keptTetri: keep, backTetri: back } as object },
  });
}

export async function decideDeposit(input: { actor: Actor; rentalId: string; decision: DepositDecision; today: string }): Promise<void> {
  if (!hasPerm(input.actor, 'deposit.decide')) throw forbidden('deposit_decision_forbidden', 'Only an owner decides on a deposit.');
  await prisma.$transaction(async (tx) => {
    const r = await tx.rental.findUnique({ where: { id: input.rentalId }, select: { status: true } });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    if (r.status !== 'returned') throw conflict('not_returned', 'A deposit is decided once the moped is back.');
    await applyDecision(tx, input.actor, input.rentalId, input.decision, input.today);
  });
}

/** How long after a return an owner may take it back (B5-08). */
export const UNDO_RETURN_MS = 24 * 3600_000;

/**
 * A return made by mistake, taken back within a day (B5-08): the rental runs
 * again, the moped is with the customer, what the return charged, kept and
 * handed back is annulled — all of it in the journal.
 */
export async function undoReturn(input: { actor: Actor; rentalId: string; reason: string; today: string }): Promise<void> {
  if (!hasPerm(input.actor, 'deposit.decide')) throw forbidden('owner_only', 'Only an owner takes a return back.');
  if (!input.reason.trim()) throw badRequest('missing_field', 'Say why.', { field: 'reason' });
  await prisma.$transaction(async (tx) => {
    const r = await tx.rental.findUnique({ where: { id: input.rentalId }, include: { deposit: true } });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    if (r.status !== 'returned') throw conflict('not_returned', 'This rental is not returned.');
    const act = await tx.act.findFirst({ where: { rentalId: r.id, kind: 'return' }, orderBy: { createdAt: 'desc' } });
    if (!act || Date.now() - act.createdAt.getTime() > UNDO_RETURN_MS) throw conflict('undo_return_too_late', 'A return can be taken back within a day.');
    const record = (act.settlement ?? {}) as { chargeIds?: string[]; replaced?: { id: string; amountTetri: number }[]; serviceJobId?: string | null; undone?: boolean };
    if (record.undone) throw conflict('not_returned', 'This return was already taken back.');

    const now = new Date();
    for (const p of record.replaced ?? []) await tx.rentalPeriod.update({ where: { id: p.id }, data: { amountTetri: p.amountTetri, updatedAt: now } });
    if (record.chargeIds?.length) await tx.rentalCharge.updateMany({ where: { id: { in: record.chargeIds } }, data: { voidedAt: now } });
    await tx.rentalCharge.updateMany({ where: { rentalId: r.id, kind: 'withheld', createdAt: { gte: act.createdAt }, voidedAt: null }, data: { voidedAt: now } });
    if (r.deposit) {
      const rows = await tx.depositWithholding.findMany({ where: { depositId: r.deposit.id, source: 'return', voidedAt: null, createdAt: { gte: act.createdAt } } });
      const payments = [
        ...rows.map((w) => w.paymentId).filter((id): id is string => !!id),
        ...(await tx.payment.findMany({ where: { depositId: r.deposit.id, voidedAt: null, createdAt: { gte: act.createdAt } }, select: { id: true } })).map((p) => p.id),
      ];
      for (const id of payments) {
        await tx.paymentAllocation.deleteMany({ where: { paymentId: id } });
        await tx.payment.update({ where: { id }, data: { voidedAt: now, voidReason: `return undone: ${input.reason}`, voidedById: input.actor.id, voidKind: 'void' } });
      }
      await tx.depositWithholding.updateMany({ where: { id: { in: rows.map((w) => w.id) } }, data: { voidedAt: now } });
      await syncDeposit(tx, r.deposit.id);
      await tx.deposit.update({
        where: { id: r.deposit.id },
        data: { status: 'held', returnedTetri: 0, returnedTo: null, returnedOn: null, decidedById: null, confirmedById: null, updatedAt: now },
      });
    }
    await tx.rental.update({ where: { id: r.id }, data: { status: 'active', returnedOn: null, updatedAt: now } });
    if (record.serviceJobId) {
      await tx.serviceJob.updateMany({ where: { id: record.serviceJobId, status: 'open' }, data: { status: 'cancelled', updatedAt: now } });
    }
    if (r.vehicleId) {
      await moveVehicle(tx, { vehicleId: r.vehicleId, kind: 'pickup', occurredOn: input.today, actorId: input.actor.id, rentalId: r.id, reason: `return undone: ${input.reason}` });
    }
    await tx.act.update({ where: { id: act.id }, data: { settlement: { ...record, undone: true } as object } });
    await tx.storedFile.updateMany({ where: { rentalId: r.id, kind: 'pdf', docKind: 'return_act', archived: false }, data: { archived: true } });
    await recomputeRental(tx, r.id);
    await tx.auditLog.create({ data: { actorId: input.actor.id, action: 'rental.return.undo', entityType: 'rental', entityId: r.id, note: input.reason } });
  });
}

// ---------------------------------------------------------------------------
// Pause, dispute, and back to running (B4-08, Q11)
// ---------------------------------------------------------------------------

export async function setRentalStatus(input: { actor: Actor; rentalId: string; status: 'active' | 'paused' | 'disputed'; reason: string; today: string }): Promise<void> {
  if (!hasPerm(input.actor, 'deposit.decide')) throw forbidden('owner_only', 'Only an owner pauses or disputes a rental.');
  if (!input.reason.trim()) throw badRequest('missing_field', 'Say why.', { field: 'reason' });
  await prisma.$transaction(async (tx) => {
    const r = await tx.rental.findUnique({ where: { id: input.rentalId }, include: { periods: { select: { seq: true } } } });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    if (r.status === 'returned') throw conflict('already_returned', 'A closed rental does not change status.');
    const pickedUpOn = isoDate(r.pickedUpOn);
    if (input.status === 'active' && (r.status === 'paused' || r.status === 'disputed') && pickedUpOn) {
      // The weeks that began while it stood are not charged, and resuming
      // does not open them after the fact (Q11): they exist at nothing.
      const have = new Set(r.periods.map((p) => p.seq));
      for (const p of periodsThrough(pickedUpOn, input.today)) {
        if (have.has(p.seq)) continue;
        await tx.rentalPeriod.create({ data: { rentalId: r.id, seq: p.seq, startsOn: dateFromISO(p.startsOn)!, endsOn: dateFromISO(p.endsOn)!, amountTetri: 0 } });
      }
    }
    await tx.rental.update({ where: { id: r.id }, data: { status: input.status, updatedAt: new Date() } });
    await recomputeRental(tx, r.id);
    await tx.auditLog.create({
      data: { actorId: input.actor.id, action: 'rental.status', entityType: 'rental', entityId: r.id, before: { status: r.status }, after: { status: input.status }, note: input.reason },
    });
  });
}

export { audit };
