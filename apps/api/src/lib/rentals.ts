import { KEY_FEE_TETRI, acquiringFee, canPickUp, fleetNumber, handOverActOf, handOverBlockTetri, nameSpellings, periodsThrough, returnSettlement, shiftsOf, type Settlement, type VehicleState } from '@ev8/shared';
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
import { returnServiceParts, unfitTrackers } from './stock.js';
import { movePool, moveVehicle } from './vehicles.js';
import { HANDS_OUT, MOPED_ACT, mopedActOf } from './acts.js';
import { itemLabel } from './pdf/returnAct.js';
import { restoreOdometer } from './maintenance.js';

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
  /** The Kommo deal the hand-over was started from, when it was (ADR-0015). */
  kommoRef?: string | null;
}

export interface PickupResult {
  id: string;
  number: string;
  actId: string;
  customerId: string;
  paymentId: string | null;
}

/**
 * `within`: a transaction to write in instead of one of its own — for a caller
 * that brings several rentals over and wants all of them or none (the loader).
 */
export async function pickUp(input: PickupInput, within?: Tx): Promise<PickupResult> {
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
    // What "owes" means here is one function with the wizard (ADR-0017): the
    // whole figure, money awaited today included, until the owner says otherwise.
    const debt = await debtOf(c.id);
    if (handOverBlockTetri(debt.owesTetri, debt.dueTodayRentTetri) > 0) {
      if (!owner) throw forbidden('customer_in_debt', 'A customer who owes gets a new rental from an owner only.', { owesTetri: debt.owesTetri });
      if (!input.debtOverrideReason?.trim()) {
        throw badRequest('missing_field', 'Say why a customer who owes gets a moped.', { field: 'debtOverrideReason', owesTetri: debt.owesTetri });
      }
    }
  }

  const write = async (tx: Tx): Promise<PickupResult> => {
    let vehicle: { id: string; pool: string | null; arrivedOn: string | null } | null = null;
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
      vehicle = { id: v.id, pool: v.pool, arrivedOn: isoDate(v.arrivedOn) };
    }

    if (input.newCustomer) {
      const c = input.newCustomer;
      const made = await tx.customer.create({
        data: { name: c.name.trim(), phone: c.phone.trim(), personalId: c.personalId.trim(), ...nameSpellings({ name: c.name, nameKa: c.nameKa, nameLat: c.nameLat }), kind: 'person', source: c.source ?? null },
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
        kommoRef: input.kommoRef?.trim() || null,
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
        // The moped the act is about (migration 0063); none for a hand-over without a VIN.
        vehicleId: input.vehicleId,
        kind: 'pickup',
        occurredOn: dateFromISO(input.pickedUpOn)!,
        odometerKm: input.odometerKm,
        odometerReason: input.odometerReason?.trim() || null,
        condition: input.condition,
        createdById: input.actor.id,
      },
    });
    if (vehicle) {
      // A rental carried over can be older than the day we wrote the moped
      // down as arrived: it worked for months while the paperwork caught up
      // (designer, 21.09.2026). The rental is not the wrong part — the
      // arrival date is, because for a carried-over moped it means "the day
      // we recorded it". So it moves back to the day the moped actually went
      // out, and the correction says so in the journal (QA-W6-06 neighbour).
      if (input.transfer && vehicle.arrivedOn && input.pickedUpOn < vehicle.arrivedOn) {
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { arrivedOn: dateFromISO(input.pickedUpOn)!, updatedAt: new Date() } });
        await tx.auditLog.create({
          data: {
            actorId: input.actor.id,
            action: 'vehicle.arrived.aligned',
            entityType: 'vehicle',
            entityId: vehicle.id,
            before: { arrivedOn: vehicle.arrivedOn },
            after: { arrivedOn: input.pickedUpOn, rental: rental.number },
            note: `rental ${rental.number} brought over from ${input.pickedUpOn}`,
          },
        });
      }
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
  };
  return within ? write(within) : prisma.$transaction(write);
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
  /** Why the reading is below the moped's last one (ADR-0038 §4). */
  odometerReason: string | null;
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

type PeriodRow = { id: string; seq: number; startsOn: Date; endsOn: Date; amountTetri: number; paidTetri: number; extraDays: number };

/**
 * The weeks there are, plus any the nightly run has not opened yet by the
 * return day — on the grid the night uses, moved by any week made longer (ADR-0041).
 */
function withWeeksThrough(r: { pickedUpOn: Date | null; weeklyRateTetri: number; periods: PeriodRow[] }, returnedOn: string) {
  const have = r.periods.map((p) => ({ id: p.id, seq: p.seq, startsOn: isoDate(p.startsOn)!, endsOn: isoDate(p.endsOn)!, amountTetri: p.amountTetri, paidTetri: p.paidTetri }));
  const pickedUpOn = isoDate(r.pickedUpOn);
  if (!pickedUpOn) return have;
  const seqs = new Set(have.map((p) => p.seq));
  for (const p of periodsThrough(pickedUpOn, returnedOn, null, shiftsOf(r.periods))) {
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
      acts: { where: { kind: { in: HANDS_OUT } }, select: { ...MOPED_ACT, odometerKm: true } },
      vehicle: { select: { odometerKm: true } },
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
  // The act that handed out the moped coming back: after a swap, the swap's (ADR-0040).
  const handOver = handOverActOf(r.acts.map(mopedActOf), r.vehicleId);
  return {
    batteries: r.batteries,
    chargers: r.chargers,
    pickupKm: handOver?.row.odometerKm ?? null,
    /** The day that moped was handed out: the hand-over, or the swap that brought it. */
    pickupOn: handOver?.occurredOn ?? isoDate(r.pickedUpOn),
    /** The moped's last reading: below it, the return asks why (ADR-0038 §4). */
    vehicleKm: r.vehicle?.odometerKm ?? null,
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
      include: { deposit: true, acts: { where: { kind: { in: HANDS_OUT } }, select: { ...MOPED_ACT, odometerKm: true } }, periods: { orderBy: { seq: 'asc' } } },
    });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    if (r.status === 'returned') throw conflict('already_returned', 'This rental is already closed.');
    // The moped coming back was handed out by the hand-over, or by the swap
    // that brought it (ADR-0040): its day and its mileage are the ones to check.
    const handOver = handOverActOf(r.acts.map(mopedActOf), r.vehicleId);
    const pickedUpOn = handOver?.occurredOn ?? isoDate(r.pickedUpOn);
    if (pickedUpOn && input.returnedOn < pickedUpOn) throw conflict('return_before_pickup', 'Return date is before the pickup date.', { field: 'returnedOn' });
    // Less than at the hand-over is a mistake, not a moped that went backwards (B5-05).
    const pickupKm = handOver?.row.odometerKm ?? null;
    if (pickupKm != null && input.odometerKm! < pickupKm) {
      throw conflict('odometer_below_pickup', 'The mileage is below the hand-over’s.', { field: 'odometerKm', pickupKm });
    }
    // Below the moped's last reading — a repair during the rental may have
    // read it higher — only with the reason, as the hand-over asks it
    // (ADR-0038 §4): a typo would move the planned maintenance unexplained.
    const lastKm = r.vehicleId ? ((await tx.vehicle.findUnique({ where: { id: r.vehicleId }, select: { odometerKm: true } }))?.odometerKm ?? null) : null;
    const odometerReason = input.odometerReason?.trim() || null;
    const lower = lastKm != null && input.odometerKm! < lastKm;
    if (lower && !odometerReason) {
      throw badRequest('odometer_below', 'The mileage is below the moped’s last reading; say why.', { field: 'odometerReason', lastKm });
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

    // A battery or a charger the act calls missing leaves the count (QA-W4-07; chargers since migration 0044).
    for (const item of ['battery', 'charger'] as const) {
      const missing = Object.entries(input.items).filter(([k, v]) => k.startsWith(`${item}_`) && v.state === 'missing');
      if (missing.length === 0) continue;
      await tx.batteryMove.create({
        data: {
          item,
          kind: 'lost',
          qty: missing.length,
          // The note if the act carried one; otherwise the act itself says it.
          reason: missing.find(([, v]) => v.note?.trim())?.[1].note?.trim() || null,
          rentalId: r.id,
          occurredOn: dateFromISO(input.returnedOn)!,
          createdById: input.actor.id,
        },
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
        vehicleId: r.vehicleId,
        kind: 'return',
        occurredOn: dateFromISO(input.returnedOn)!,
        odometerKm: input.odometerKm,
        odometerReason: lower ? odometerReason : null,
        condition: input.condition,
        items: input.items,
        locationId: toService ? null : input.locationId,
        // The moped's figure before this return: a return taken back puts it back (ADR-0038 §1).
        settlement: { ...settlementRecord(settlement), ...applied, serviceJobId, odometerBeforeKm: lastKm } as object,
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
    data: {
      actorId: actor.id,
      action: 'deposit.decide',
      entityType: 'deposit',
      entityId: d.id,
      // What the deposit held before the decision and what it holds after,
      // so the journal can say "180.00 ₾ → 0.00 ₾" instead of nothing
      // (QA-W6-15). The rest of the decision stays beside it for the record.
      before: { heldTetri: held },
      after: { ...decision, heldTetri: 0, keptTetri: keep, backTetri: back },
      // A reason belongs in the note, where every other action puts it and
      // where the journal's own column looks for it.
      note: decision.reason?.trim() || null,
    },
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
    const record = (act.settlement ?? {}) as {
      chargeIds?: string[];
      replaced?: { id: string; amountTetri: number }[];
      serviceJobId?: string | null;
      undone?: boolean;
      odometerBeforeKm?: number | null;
    };
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
    let calledOffKm: number | null = null;
    if (record.serviceJobId) {
      // The repair the return opened is called off with it, as a repair
      // cancelled is: dated, its shelf's parts back. Still open — or waiting,
      // since a mechanic who took it on put it back to waiting (ADR-0035 §1).
      // One closed already stays closed; the moped goes back to the customer.
      const called = await tx.serviceJob.updateMany({
        where: { id: record.serviceJobId, status: { in: ['open', 'draft'] } },
        data: { status: 'cancelled', closedOn: dateFromISO(input.today)!, closedAt: now, updatedAt: now },
      });
      if (called.count === 1) {
        const job = await tx.serviceJob.findUniqueOrThrow({ where: { id: record.serviceJobId }, select: { id: true, number: true, openedOdometerKm: true } });
        calledOffKm = job.openedOdometerKm;
        const why = `return undone: ${input.reason}`;
        const back = await returnServiceParts(tx, { jobId: job.id, occurredOn: input.today, actorId: input.actor.id, reason: `${job.number}: ${why}`.slice(0, 1000) });
        await unfitTrackers(tx, job.id);
        await tx.auditLog.create({ data: { actorId: input.actor.id, action: 'service.cancel', entityType: 'service_job', entityId: job.id, after: { partsBack: back }, note: why } });
      }
    }
    if (r.vehicleId) {
      await moveVehicle(tx, { vehicleId: r.vehicleId, kind: 'pickup', occurredOn: input.today, actorId: input.actor.id, rentalId: r.id, reason: `return undone: ${input.reason}` });
    }
    await tx.act.update({ where: { id: act.id }, data: { settlement: { ...record, undone: true } as object } });
    if (r.vehicleId) {
      // Taken back, the return's reading is no reading (ADR-0038 §1), nor is
      // that of the repair it opened: the moped's figure goes back with them,
      // or the next return would have to explain a typo that never stood.
      if (calledOffKm != null) await restoreOdometer(tx, r.vehicleId, calledOffKm);
      if (act.odometerKm != null) await restoreOdometer(tx, r.vehicleId, act.odometerKm, 'odometerBeforeKm' in record ? record.odometerBeforeKm : undefined);
    }
    await tx.storedFile.updateMany({ where: { rentalId: r.id, kind: 'pdf', docKind: 'return_act', archived: false }, data: { archived: true } });
    await recomputeRental(tx, r.id);
    await tx.auditLog.create({ data: { actorId: input.actor.id, action: 'rental.return.undo', entityType: 'rental', entityId: r.id, note: input.reason } });
  });
}

// ---------------------------------------------------------------------------
// A swap: the same rental, another moped (ADR-0040)
// ---------------------------------------------------------------------------

export interface SwapInput {
  actor: Actor;
  today: string;
  rentalId: string;
  swappedOn: string;
  /** Why the moped is changed: a breakdown, the customer's request. */
  reason: string;
  /** The moped the customer gives back. */
  out: {
    odometerKm: number | null;
    /** Why the reading is below the moped's last one (ADR-0038 §4). */
    odometerReason: string | null;
    condition: string | null;
    /** The moped and its key, as a return act has them; batteries and chargers stay with the customer. */
    items: Record<string, { state: 'ok' | 'damaged' | 'missing'; note: string | null }>;
    toService: boolean;
    locationId: string | null;
  };
  /** The moped handed out in its place. */
  in: {
    vehicleId: string;
    /** An owner agreed to move a moped from the sale park (Q9). */
    moveFromSale: boolean;
    odometerKm: number | null;
    odometerReason: string | null;
    condition: string | null;
  };
}

export interface SwapResult {
  outActId: string;
  inActId: string;
  /** The repair the moped given back went into: opened now, or one already open on it. */
  serviceJobId: string | null;
  /** That repair was open already — reported while the customer had the moped — and was taken up. */
  adoptedJob: boolean;
}

/**
 * The customer gives one moped back and takes another; the rental goes on
 * (ADR-0040). Its number, weeks, deposit, debt, pay day and tariff stay as
 * they are (Q12); what changes is the moped. Two acts — the moped given back,
 * the moped handed out — and two events, each with the rental; the old moped
 * to a point or to a repair, the new one out. The contract named the old
 * moped's VIN: the copy made is archived, and the contract is drawn again
 * with the new one and waits for a signature. One transaction, one operation
 * key. There is no undo: a wrong swap is put right by a second one, and both
 * stay in the journal.
 */
export async function swapVehicle(input: SwapInput): Promise<SwapResult> {
  // A return and a hand-over in one: whoever may do both — a manager and an owner.
  if (!hasPerm(input.actor, 'rental.create') || !hasPerm(input.actor, 'rental.return')) throw forbidden('forbidden', 'A swap is a return and a hand-over; it takes the rights of both.');
  const owner = hasPerm(input.actor, 'deposit.decide');
  const reason = input.reason.trim();
  if (!reason) throw badRequest('missing_field', 'Say why the moped is changed.', { field: 'reason' });
  if (input.swappedOn > input.today) throw badRequest('future_date', 'A swap is not dated in the future.', { field: 'swappedOn' });
  if (input.out.odometerKm == null) throw badRequest('missing_field', 'The mileage of the moped given back goes into its act.', { field: 'outOdometerKm' });
  if (input.in.odometerKm == null) throw badRequest('missing_field', 'The mileage of the moped handed out goes into its act.', { field: 'inOdometerKm' });
  const outKm = input.out.odometerKm;
  const inKm = input.in.odometerKm;

  return prisma.$transaction(async (tx) => {
    const found = await tx.rental.findUnique({ where: { id: input.rentalId }, select: { id: true, vehicleId: true } });
    if (!found) throw notFound('rental_not_found', 'No such rental.');
    const freshFound = await tx.vehicle.findUnique({ where: { id: input.in.vehicleId }, select: { id: true } });
    if (!freshFound) throw notFound('vehicle_not_found', 'No such moped.');
    // One swap at a time on a rental and on each of its mopeds; what is
    // checked below is read again under the lock, never from before it.
    // The mopeds in one order, whoever asks: two swaps crossing never wait on each other.
    await tx.$queryRaw`SELECT 1 FROM rentals WHERE id = ${found.id}::uuid FOR UPDATE`;
    for (const id of [freshFound.id, found.vehicleId].filter((x): x is string => !!x).sort()) {
      await tx.$queryRaw`SELECT 1 FROM vehicles WHERE id = ${id}::uuid FOR UPDATE`;
    }

    const r = await tx.rental.findUniqueOrThrow({ where: { id: found.id }, include: { acts: { select: { ...MOPED_ACT, odometerKm: true } } } });
    if (r.status === 'returned') throw conflict('already_returned', 'This rental is already closed.');
    // A rental handed over without a VIN gets its moped through "Change terms"; there is nothing to give back.
    if (!r.vehicleId) throw conflict('swap_no_vehicle', 'This rental has no moped to give back; confirm its VIN first.', { field: 'vehicleId' });
    if (input.in.vehicleId === r.vehicleId) throw conflict('same_vehicle', 'This is the moped the customer already has.', { field: 'vehicleId' });
    const oldId = r.vehicleId;
    const old = await tx.vehicle.findUniqueOrThrow({ where: { id: oldId } });
    const fresh = await tx.vehicle.findUniqueOrThrow({ where: { id: freshFound.id } });
    if (fresh.archived) throw notFound('vehicle_not_found', 'No such moped.');
    if (!canPickUp(fresh.state as VehicleState)) {
      throw conflict('vehicle_not_available', 'This moped cannot be handed over in its current state.', { state: fresh.state, field: 'vehicleId' });
    }
    // The same rule as a hand-over (Q9): a moped of the sale park goes to rent by an owner who says so.
    if (fresh.pool === 'sale') {
      if (!owner) throw forbidden('vehicle_in_sale_pool', 'A moped of the sale park goes to rent by an owner.', { field: 'vehicleId' });
      if (!input.in.moveFromSale) throw conflict('vehicle_in_sale_pool', 'This moped is in the sale park; confirm the move to rent.', { field: 'vehicleId' });
    }

    // Not into a stretch of either moped's history that is already written:
    // a swap dated before the old moped was handed out, or before the last
    // thing that happened to either of them, would make a timeline read
    // pickup, pickup, return (the rule ops.ts keeps for a VIN confirmed later).
    const handOver = handOverActOf(r.acts.map(mopedActOf), oldId);
    const lastEventOn = async (vehicleId: string) =>
      isoDate((await tx.vehicleEvent.findFirst({ where: { vehicleId }, orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }], select: { occurredOn: true } }))?.occurredOn);
    for (const lastOn of [handOver?.occurredOn ?? isoDate(r.pickedUpOn), await lastEventOn(oldId), await lastEventOn(fresh.id)]) {
      if (lastOn && input.swappedOn < lastOn) {
        throw conflict('swap_before_last_event', 'The swap is dated before something already written in a moped’s history.', { field: 'swappedOn', lastOn });
      }
    }

    // The moped given back: less than when it was handed out is a mistake
    // (B5-05); below its last reading only with the reason (ADR-0038 §4).
    const pickupKm = handOver?.row.odometerKm ?? null;
    if (pickupKm != null && outKm < pickupKm) throw conflict('odometer_below_pickup', 'The mileage is below the hand-over’s.', { field: 'outOdometerKm', pickupKm });
    const outReason = input.out.odometerReason?.trim() || null;
    const outLower = old.odometerKm != null && outKm < old.odometerKm;
    if (outLower && !outReason) throw badRequest('odometer_below', 'The mileage is below the moped’s last reading; say why.', { field: 'outOdometerReason', lastKm: old.odometerKm });
    // The moped handed out: below its last reading only with the reason, as a hand-over asks (B4-06).
    const inReason = input.in.odometerReason?.trim() || null;
    const inLower = fresh.odometerKm != null && inKm < fresh.odometerKm;
    if (inLower && !inReason) throw badRequest('odometer_below', 'The mileage is below the moped’s last reading; say why.', { field: 'inOdometerReason', lastKm: fresh.odometerKm });

    const why = reason.slice(0, 1000);
    // (a) The moped given back is back: free, with its mileage.
    await moveVehicle(tx, { vehicleId: oldId, kind: 'return', occurredOn: input.swappedOn, actorId: input.actor.id, rentalId: r.id, reason: why });
    await tx.vehicle.update({ where: { id: oldId }, data: { odometerKm: outKm } });

    // (b) Where it goes. A repair opened on it while the customer had it did
    // not move it (service.ts, `movedVehicle`), and its closing would not
    // bring it out of service: that repair is taken up now, and no second one
    // is opened. Otherwise damage in the act — or the choice — opens a draft,
    // as a return does; or it stands at a point.
    const damaged = Object.entries(input.out.items).filter(([, v]) => v.state === 'damaged');
    const open = await tx.serviceJob.findFirst({ where: { vehicleId: oldId, status: { in: ['open', 'draft'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, number: true } });
    let serviceJobId: string | null = null;
    if (open) {
      await tx.serviceJob.update({ where: { id: open.id }, data: { movedVehicle: true, updatedAt: new Date() } });
      await moveVehicle(tx, { vehicleId: oldId, kind: 'service_in', occurredOn: input.swappedOn, actorId: input.actor.id, reason: open.number });
      serviceJobId = open.id;
    } else if (input.out.toService || damaged.length > 0) {
      // What the act says was damaged, in the act's own words; else why the moped was changed.
      const what = damaged.map(([k, v]) => (k === 'moped' ? v.note?.trim() || itemLabel(k).ka : [itemLabel(k).ka, v.note?.trim()].filter(Boolean).join(': '))).join('; ') || why;
      const job = await tx.serviceJob.create({
        data: {
          vehicleId: oldId,
          rentalId: r.id,
          customerId: r.customerId,
          reason: `${r.number}: ${what}`.slice(0, 1000),
          openedOn: dateFromISO(input.swappedOn)!,
          payer: 'company',
          movedVehicle: true,
          createdById: input.actor.id,
        },
        select: { id: true, number: true },
      });
      serviceJobId = job.id;
      await moveVehicle(tx, { vehicleId: oldId, kind: 'service_in', occurredOn: input.swappedOn, actorId: input.actor.id, reason: job.number });
    } else if (input.out.locationId) {
      const loc = await tx.location.findUnique({ where: { id: input.out.locationId }, select: { id: true, archived: true } });
      if (!loc || loc.archived) throw notFound('location_not_found', 'No such point.');
      await tx.vehicle.update({ where: { id: oldId }, data: { locationId: loc.id } });
    }

    // (c) A key not brought back is the contract's 250 (§6), as at a return.
    // The batteries and chargers stay with the customer; a changed count is "Change terms".
    const keyCharge =
      input.out.items.key?.state === 'missing'
        ? await tx.rentalCharge.create({ data: { rentalId: r.id, kind: 'key', amountTetri: KEY_FEE_TETRI, note: 'contract §6', createdById: input.actor.id }, select: { id: true } })
        : null;

    // (d) The moped handed out: a rental moped from now (ADR-0005, Q9), with the customer, with its mileage.
    await movePool(tx, { vehicleId: fresh.id, pool: 'rent', occurredOn: input.swappedOn, actorId: input.actor.id, reason: `swap ${r.number}` });
    await moveVehicle(tx, { vehicleId: fresh.id, kind: 'pickup', occurredOn: input.swappedOn, actorId: input.actor.id, rentalId: r.id, reason: why });
    await tx.vehicle.update({ where: { id: fresh.id }, data: { odometerKm: inKm } });

    // (e) The rental has the new moped. Weeks, payments, deposit, pay day and tariff are untouched.
    await tx.rental.update({ where: { id: r.id }, data: { vehicleId: fresh.id, vinUnconfirmed: false, updatedAt: new Date() } });

    // (f) Two acts, the moped given back first; each names its moped.
    const outAct = await tx.act.create({
      data: {
        rentalId: r.id,
        vehicleId: oldId,
        kind: 'swap_out',
        occurredOn: dateFromISO(input.swappedOn)!,
        odometerKm: outKm,
        odometerReason: outLower ? outReason : null,
        condition: input.out.condition,
        items: input.out.items,
        locationId: serviceJobId ? null : input.out.locationId,
        // What the swap did, as a return keeps its settlement: the moped that
        // replaced this one, the repair it went into, the key charged, and
        // the moped's figure before this reading (ADR-0038 §1).
        settlement: { toVehicleId: fresh.id, serviceJobId, adoptedJob: !!open, keyChargeId: keyCharge?.id ?? null, odometerBeforeKm: old.odometerKm } as object,
        createdById: input.actor.id,
      },
    });
    const inAct = await tx.act.create({
      data: {
        rentalId: r.id,
        vehicleId: fresh.id,
        kind: 'swap_in',
        occurredOn: dateFromISO(input.swappedOn)!,
        odometerKm: inKm,
        odometerReason: inLower ? inReason : null,
        condition: input.in.condition,
        settlement: { fromVehicleId: oldId, odometerBeforeKm: fresh.odometerKm, movedFromSale: fresh.pool === 'sale' } as object,
        createdById: input.actor.id,
      },
    });

    // (g) The contract named the old moped. The copy made — signed or not —
    // is archived and kept; the next one is drawn with the new VIN, the
    // swap's day and mileage, and waits for the customer's signature again
    // («старый договор закрыть, новый выдать», 21.10.2026).
    const contractSignedBefore = (await tx.storedFile.count({ where: { rentalId: r.id, kind: 'pdf', docKind: 'contract', archived: false, signedAt: { not: null } } })) > 0;
    await tx.storedFile.updateMany({ where: { rentalId: r.id, kind: 'pdf', docKind: 'contract', archived: false }, data: { archived: true } });
    // A "signed in Signify" mark (ADR-0039) was about that contract too: the
    // new one is not signed anywhere yet, so the mark goes, and the rental is
    // "Не подписан" again until the customer signs — here or in Signify, and a
    // person marks it once more. Who marked the old one and when stays in this
    // swap's journal line, beside the mark's own.
    const contractMark = r.contractSignedElsewhereAt
      ? { markedAt: r.contractSignedElsewhereAt.toISOString(), markedById: r.contractSignedElsewhereById, markNote: r.contractSignedElsewhereNote }
      : null;
    if (contractMark) {
      await tx.rental.update({ where: { id: r.id }, data: { contractSignedElsewhereAt: null, contractSignedElsewhereById: null, contractSignedElsewhereNote: null } });
    }

    // (h) One line in the journal: the moped before and after, and why.
    await tx.auditLog.create({
      data: {
        actorId: input.actor.id,
        action: 'rental.swap',
        entityType: 'rental',
        entityId: r.id,
        // The mark taken off sits on this side only: the journal's "было → стало" pairs fields both sides name.
        before: { vehicleId: oldId, vin: old.vin, moped: fleetNumber(old.fleetNo), ...(contractMark ? { contractMark } : {}) },
        after: {
          vehicleId: fresh.id,
          vin: fresh.vin,
          moped: fleetNumber(fresh.fleetNo),
          swappedOn: input.swappedOn,
          outKm,
          inKm,
          serviceJobId,
          adoptedJob: !!open,
          locationId: serviceJobId ? null : input.out.locationId,
          keyCharged: keyCharge != null,
          movedFromSale: fresh.pool === 'sale',
          contractSignedBefore,
          contractMarkCleared: contractMark != null,
        },
        note: why,
      },
    });
    return { outActId: outAct.id, inActId: inAct.id, serviceJobId, adoptedJob: !!open };
  });
}

// ---------------------------------------------------------------------------
// Pause, dispute, and back to running (B4-08, Q11)
// ---------------------------------------------------------------------------

export async function setRentalStatus(input: { actor: Actor; rentalId: string; status: 'active' | 'paused' | 'disputed'; reason: string; today: string }): Promise<void> {
  if (!hasPerm(input.actor, 'deposit.decide')) throw forbidden('owner_only', 'Only an owner pauses or disputes a rental.');
  if (!input.reason.trim()) throw badRequest('missing_field', 'Say why.', { field: 'reason' });
  await prisma.$transaction(async (tx) => {
    const r = await tx.rental.findUnique({ where: { id: input.rentalId }, include: { periods: { select: { seq: true, extraDays: true } } } });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    if (r.status === 'returned') throw conflict('already_returned', 'A closed rental does not change status.');
    const pickedUpOn = isoDate(r.pickedUpOn);
    if (input.status === 'active' && (r.status === 'paused' || r.status === 'disputed') && pickedUpOn) {
      // The weeks that began while it stood are not charged, and resuming
      // does not open them after the fact (Q11): they exist at nothing —
      // on the grid moved by any week made longer (ADR-0041).
      const have = new Set(r.periods.map((p) => p.seq));
      for (const p of periodsThrough(pickedUpOn, input.today, null, shiftsOf(r.periods))) {
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
