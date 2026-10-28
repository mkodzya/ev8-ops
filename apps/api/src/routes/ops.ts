import { CONTACT_KINDS, CUSTOMER_KINDS, CUSTOMER_SOURCES, VEHICLE_POOLS, VEHICLE_STATES, isoWeekday, manualMoveRefusal, nameSpellings, normalizeVin, todayISO, trackerCorrection, trackerDayFault, trackerEarliestDay, trackerTails, vinFault, weeksAnchor, type ManualMoveRefusal, type VehicleState } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { hasPerm } from '../lib/auth.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound, type ApiError } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { date, int, oneOf, str, strList, tetri } from '../lib/validate.js';
import { inRentalRefusal, movePool, moveVehicle, openRentalOf } from '../lib/vehicles.js';
import { fitTracker, imeiInUse, imeiOpenElsewhere, readImeiOf, readSimOf, readTracker } from '../lib/trackers.js';

type Body = Record<string, unknown>;

/** How long a park move stays a slip that can be taken back rather than a decision. */
const UNDO_WINDOW_MS = 10 * 60 * 1000;

/**
 * A move by hand refused, in the API's words (the screen has its own in
 * `errors.codes`). Which refusal it is comes from the shared rule the sheet
 * offers its states by, so the two cannot drift apart again.
 */
const MANUAL_MOVE_REFUSED: Record<ManualMoveRefusal, () => ApiError> = {
  vehicle_rented_move: () => conflict('vehicle_rented_move', 'Close the rental first; a rented moped does not move by hand.'),
  sold_by_sale: () => conflict('sold_by_sale', 'A moped is sold by a sale and comes back by a buy-back.'),
  owner_only: () => forbidden('owner_only', 'A manager moves a moped between free and service.'),
  use_rental: () => conflict('use_rental', 'A moped becomes rented through a hand-over, not by hand.'),
  same_state: () => conflict('same_state', 'The moped is already in this state.'),
};

// Writes. Every one goes through the change journal.

export function opsRoutes(app: FastifyInstance): void {
  // ---- customers (CST-01, CST-02) ----------------------------------------
  app.post<{ Body: Body }>('/api/customers', { config: { scope: 'customer.create' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const name = str(b, 'name', { required: true, max: 200 })!;
    const personalId = str(b, 'personalId', { max: 40 });
    const phone = str(b, 'phone', { max: 40 });
    // Duplicates: the same personal number or phone is the same person.
    const twin = await prisma.customer.findFirst({
      where: {
        archived: false,
        OR: [...(personalId ? [{ personalId }] : []), ...(phone ? [{ phone }] : [])],
      },
      select: { id: true, name: true },
    });
    if (twin && !b.force) throw conflict('duplicate_customer', 'A customer with this personal number or phone exists.', { existing: twin });
    if (twin && personalId) {
      const samePid = await prisma.customer.findFirst({ where: { personalId }, select: { id: true } });
      if (samePid) throw conflict('duplicate_personal_id', 'That personal number is already on a card.', { existing: samePid });
    }
    // One form of a name (Mika, 13.10.2026): a Georgian name gets its Latin transcript beside it.
    const spelt = nameSpellings({ name, nameKa: str(b, 'nameKa', { max: 200 }), nameLat: str(b, 'nameLat', { max: 200 }) });
    try {
      const c = await prisma.customer.create({
        data: {
          name,
          nameKa: spelt.nameKa,
          nameLat: spelt.nameLat,
          personalId,
          phone,
          email: str(b, 'email', { max: 200 }),
          address: str(b, 'address', { max: 300 }),
          kind: oneOf(b, 'kind', CUSTOMER_KINDS) ?? 'person',
          // What this record is (B3-06): a client by default, because that is
          // what all but a handful of them are.
          recordKind: oneOf(b, 'recordKind', CONTACT_KINDS) ?? 'client',
          tags: strList(b, 'tags'),
          notes: str(b, 'notes', { max: 4000 }),
        },
      });
      await audit({ actorId: actor.id, action: 'customer.create', entityType: 'customer', entityId: c.id, after: { name, personalId, phone } });
      return reply.code(201).send({ id: c.id });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_personal_id', 'That personal number is already on a card.');
      throw e;
    }
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/customers/:id', { config: { scope: 'customer.create' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const before = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('customer_not_found', 'No such customer.');
    const data: Record<string, unknown> = {};
    if ('source' in b) data.source = oneOf(b, 'source', CUSTOMER_SOURCES) ?? null;
    if ('phone' in b) {
      // Two cards with one number are two halves of one customer (B7-04).
      const phone = str(b, 'phone', { max: 300 });
      const digits = (s: string | null) => (s ?? '').replace(/\D/g, '').slice(-9);
      if (phone && digits(phone).length === 9) {
        const twin = await prisma.customer.findFirst({
          where: { id: { not: before.id }, archived: false, phone: { not: null } },
          select: { id: true, name: true, phone: true },
          orderBy: { createdAt: 'asc' },
        });
        const all = await prisma.customer.findMany({ where: { id: { not: before.id }, archived: false, phone: { not: null } }, select: { id: true, name: true, phone: true } });
        const found = all.find((c) => digits(c.phone) === digits(phone)) ?? (twin && digits(twin.phone) === digits(phone) ? twin : null);
        if (found) throw conflict('duplicate_phone', 'This number is on another card.', { existing: { id: found.id, name: found.name }, field: 'phone' });
      }
    }
    for (const k of ['name', 'nameKa', 'nameLat', 'personalId', 'phone', 'email', 'address', 'notes'] as const) {
      if (k in b) data[k] = str(b, k, { max: k === 'notes' ? 4000 : 300, required: k === 'name' });
    }
    // A change of any spelling leaves the card in one form: the Georgian name
    // where the name is Georgian, and its Latin transcript where none was typed.
    if ('name' in data || 'nameKa' in data || 'nameLat' in data) {
      const typed = {
        name: (data.name as string | undefined) ?? before.name,
        nameKa: 'nameKa' in data ? (data.nameKa as string | null) : before.nameKa,
        nameLat: 'nameLat' in data ? (data.nameLat as string | null) : before.nameLat,
      };
      const spelt = nameSpellings(typed);
      if (spelt.nameKa !== (typed.nameKa ?? null)) data.nameKa = spelt.nameKa;
      if (spelt.nameLat !== (typed.nameLat ?? null)) data.nameLat = spelt.nameLat;
    }
    // The front office's deal, one way only until the webhook tariff
    // (B10-03, register #5): a link or an id, kept as typed.
    if ('kommoRef' in b) data.kommoRef = str(b, 'kommoRef', { max: 300 });
    if ('kind' in b) data.kind = oneOf(b, 'kind', CUSTOMER_KINDS, { required: true });
    if ('recordKind' in b) {
      data.recordKind = oneOf(b, 'recordKind', CONTACT_KINDS, { required: true })!;
    }
    if ('tags' in b) data.tags = strList(b, 'tags');
    if ('archived' in b) data.archived = Boolean(b.archived);
    try {
      await prisma.customer.update({ where: { id: before.id }, data: { ...data, updatedAt: new Date() } });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_personal_id', 'That personal number is already on a card.');
      throw e;
    }
    await audit({ actorId: actor.id, action: 'customer.update', entityType: 'customer', entityId: before.id, before: pickKeys(before, data), after: data });
    return { ok: true };
  });

  // Small edits on a rental (wave 3 §3.7, B4-08): the night parking address,
  // batteries, chargers, the planned return, notes, and confirming the VIN of a
  // rental opened without one. The tariff of a running rental does not change (Q12).
  app.patch<{ Params: { id: string }; Body: Body }>('/api/rentals/:id', { config: { scope: 'rental.create' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const r = await prisma.rental.findUnique({ where: { id: req.params.id } });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    const data: Record<string, unknown> = {};
    if ('notes' in b) data.notes = str(b, 'notes', { max: 4000 });
    if ('expectedReturnOn' in b) data.expectedReturnOn = dateFromISO(date(b, 'expectedReturnOn'));
    if ('nightParkingAddress' in b) data.nightParkingAddress = str(b, 'nightParkingAddress', { max: 300 });
    if ('batteries' in b) data.batteries = int(b, 'batteries', { min: 0 });
    if ('chargers' in b) data.chargers = int(b, 'chargers', { min: 0 });
    // The weekday the rent is due on (ADR-0022): an owner's, with a reason —
    // it decides the day a renter is called late. ISO 1–7; null, or the
    // weeks' own weekday, is the rule of every other rental, kept as null.
    // The weeks' weekday is the pickup's until a week was made longer (ADR-0041).
    if ('payWeekday' in b) {
      if (!hasPerm(actor, 'deposit.decide')) throw forbidden('owner_only', 'The pay day of a rental is an owner\'s decision.');
      if (!str(b, 'reason', { max: 1000 })) throw badRequest('missing_field', 'Say why the pay day changes.', { field: 'reason' });
      const day = int(b, 'payWeekday', { min: 1, max: 7 });
      const weeksFrom = weeksAnchor(isoDate(r.pickedUpOn), r.weekShiftDays);
      data.payWeekday = day == null || (weeksFrom && isoWeekday(weeksFrom) === day) ? null : day;
    }
    // The front office's deal, one way only until the webhook tariff
    // (B10-03, register #5): a link or an id, kept as typed.
    if ('kommoRef' in b) data.kommoRef = str(b, 'kommoRef', { max: 300 });
    // Buy-out from a rental (RNT-07): a target and what each payment puts
    // towards it. Both or neither — half of the rule cannot be counted.
    if ('buyoutTargetTetri' in b || 'buyoutPerPaymentTetri' in b) {
      const target = tetri(b, 'buyoutTargetTetri', { min: 1 });
      const per = tetri(b, 'buyoutPerPaymentTetri', { min: 1 });
      if ((target == null) !== (per == null)) throw conflict('buyout_incomplete', 'A buy-out needs both the target and the part of each payment.');
      if (target != null && per != null && per > target) throw conflict('buyout_per_payment', 'Each payment cannot exceed the target.');
      data.buyoutTargetTetri = target;
      data.buyoutPerPaymentTetri = per;
    }
    // Pause and dispute are an owner's, with a reason: POST /api/rentals/:id/status (wave 3 §3.7).
    if ('status' in b) throw conflict('use_status_route', 'The status of a rental changes through its own action.');
    const vehicleId = str(b, 'vehicleId');
    await prisma.$transaction(async (tx) => {
      if (vehicleId) {
        // A moped already given is changed by a swap, with its two acts (ADR-0040), not here.
        if (r.vehicleId) throw conflict('vehicle_already_set', 'This rental already has a moped; change it with a swap.');
        const v = await tx.vehicle.findUnique({ where: { id: vehicleId } });
        if (!v) throw notFound('vehicle_not_found', 'No such moped.');
        if (v.state !== 'available') throw conflict('vehicle_not_available', 'This moped cannot be handed over in its current state.', { state: v.state });
        // Free on its card, but out on another rental (issue #17): not this one's.
        const busy = await openRentalOf(tx, vehicleId, r.id);
        if (busy) throw inRentalRefusal(busy);
        data.vehicleId = vehicleId;
        data.vinUnconfirmed = false;
        // Dated today, not at the rental's start. Confirming which VIN a
        // rental has is a correction made now; back-dating it writes a
        // hand-over into a stretch of time when this moped's own history
        // says it was somewhere else — which is how a timeline ends up
        // reading pickup, pickup, return.
        await moveVehicle(tx, {
          vehicleId,
          kind: 'pickup',
          occurredOn: todayISO(new Date(), env.TZ),
          actorId: actor.id,
          rentalId: r.id,
        });
        // Its hand-over act was written without a moped: this is the one the
        // mileage in it was read off (migration 0063 did the same for the old ones).
        await tx.act.updateMany({ where: { rentalId: r.id, kind: 'pickup', vehicleId: null }, data: { vehicleId } });
      }
      await tx.rental.update({ where: { id: r.id }, data: { ...data, updatedAt: new Date() } });
      // An empty pay day is the weeks' own weekday: the journal calls it «as
      // the pickup day», or «as the week's first day» once weeks were moved
      // (ADR-0041), as the card does — so the line keeps which, the same on both sides.
      const weeks = 'payWeekday' in data ? { weekShiftDays: r.weekShiftDays } : {};
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'rental.update', entityType: 'rental', entityId: r.id, before: { ...pickKeys(r, data), ...weeks } as object, after: { ...data, ...weeks } as object, note: str(b, 'reason', { max: 1000 }) },
      });
    });
    return { ok: true };
  });

  // ---- fleet: manual state with a reason (FLT-03) --------------------------
  app.post<{ Params: { id: string }; Body: Body }>('/api/fleet/:id/state', { config: { scope: 'fleet.state.manual' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const toState = oneOf(b, 'toState', VEHICLE_STATES, { required: true })!;
    const reason = str(b, 'reason', { required: true, max: 1000 })!;
    const occurredOn = date(b, 'occurredOn') ?? todayISO(new Date(), env.TZ);
    const v = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
    if (!v) throw notFound('vehicle_not_found', 'No such moped.');
    // One rule with the sheet that offers the states (manualMoveRefusal):
    // a rented moped moves through its rental; sold is what a sale says, not
    // what a hand says, and a buy-back brings it back; writing one off is an
    // owner's (Q22, §3.6); and the state it is already in is no move at all —
    // it used to be written as an X → X event with a reason (21.10.2026).
    // Whether it is out on a rental is asked of the rentals (issue #17): a
    // moped whose rental is open while its state says otherwise goes back to
    // «В аренде» by an owner, and nowhere else until that rental is closed.
    const open = await openRentalOf(prisma, v.id);
    const refusal = manualMoveRefusal(v.state as VehicleState, toState, { mayWriteOff: hasPerm(actor, 'deposit.decide'), hasRental: open != null });
    if (refusal) throw MANUAL_MOVE_REFUSED[refusal]();
    const backTo = toState === 'rented' ? open : null;
    const moved = await prisma.$transaction(async (tx) => {
      const m = await moveVehicle(tx, { vehicleId: v.id, kind: 'manual', occurredOn, actorId: actor.id, reason, toState, rentalId: backTo?.id ?? null });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'vehicle.state.manual', entityType: 'vehicle', entityId: v.id, before: { state: m.from }, after: { state: m.to, ...(backTo ? { rental: backTo.number } : {}) }, note: reason },
      });
      return m;
    });
    return moved;
  });

  // ---- fleet: which park a moped belongs to (ADR-0005) --------------------
  app.post<{ Params: { id: string }; Body: Body }>('/api/fleet/:id/pool', { config: { scope: 'fleet.pool.set' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const pool = oneOf(b, 'pool', VEHICLE_POOLS, { required: true })!;
    const occurredOn = date(b, 'occurredOn') ?? todayISO(new Date(), env.TZ);
    const reason = str(b, 'reason', { max: 1000 });
    const v = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
    if (!v) throw notFound('vehicle_not_found', 'No such moped.');
    // A moped that has left the fleet belongs to neither park. Deciding what
    // a sold moped is for would be a decision about somebody else's property.
    if (v.state === 'sold' || v.state === 'out') throw conflict('vehicle_gone', 'This moped has left the fleet. A buy-back brings it back, and then it takes a park.');
    const moved = await prisma.$transaction(async (tx) => {
      const m = await movePool(tx, { vehicleId: v.id, pool, occurredOn, actorId: actor.id, reason });
      if (m.changed) {
        await tx.auditLog.create({
          data: { actorId: actor.id, action: 'vehicle.pool', entityType: 'vehicle', entityId: v.id, before: { pool: m.from }, after: { pool: m.to }, note: reason },
        });
      }
      return m;
    });
    return moved;
  });

  // Taking back a park move made a moment ago. A mis-click is not a decision,
  // so the undone event leaves the moped's timeline rather than sitting there
  // as history that never happened; the change journal keeps both halves, and
  // that is where "who changed their mind" belongs. Only the person who made
  // the move, only the last one, only while it is still fresh.
  app.post<{ Params: { id: string } }>('/api/fleet/:id/pool/undo', { config: { scope: 'fleet.pool.set' } }, async (req) => {
    const actor = actorOf(req);
    const v = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
    if (!v) throw notFound('vehicle_not_found', 'No such moped.');
    const last = await prisma.vehicleEvent.findFirst({
      where: { vehicleId: v.id, kind: { in: ['to_rent', 'to_sale'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!last) throw conflict('nothing_to_undo', 'This moped has no park move to take back.');
    if (last.actorId !== actor.id) throw conflict('not_yours', 'Only the person who moved it can take it back.');
    if (Date.now() - last.createdAt.getTime() > UNDO_WINDOW_MS) {
      throw conflict('too_late', 'That move is no longer fresh. Move it to the other park instead, which is a decision of its own.');
    }
    const back = last.fromPool;
    await prisma.$transaction(async (tx) => {
      await tx.vehicle.update({ where: { id: v.id }, data: { pool: back, updatedAt: new Date() } });
      await tx.vehicleEvent.delete({ where: { id: last.id } });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'vehicle.pool.undo', entityType: 'vehicle', entityId: v.id, before: { pool: last.toPool }, after: { pool: back } },
      });
    });
    return { pool: back };
  });

  // ---- fleet: the tracker already on a moped (ADR-0036, addendum 21.10.2026) ----
  // An owner writes one that is on the moped without opening a repair, and
  // corrects a digit typed wrong or a SIM changed. Whoever reads the IMEI on
  // the card may write it (service.manage); the moped's journal, which
  // managers read too, keeps the last four digits and no more (§7). Taking a
  // tracker off stays the repair's: «снять трекер».
  app.post<{ Params: { id: string }; Body: Body }>('/api/fleet/:id/tracker', { config: { scope: 'service.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const v = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { id: true, state: true, arrivedOn: true } });
    if (!v) throw notFound('vehicle_not_found', 'No such moped.');
    if (v.state === 'sold' || v.state === 'out') throw conflict('vehicle_gone', 'This moped has left the fleet; no tracker is written onto it.');
    const { imei, simPhone } = readTracker(b);
    const today = todayISO(new Date(), env.TZ);
    // Not the day it was fitted, which nobody may know and which is never
    // made up, but a day it was on the moped: today, unless somebody knows.
    const on = date(b, 'installedOn') ?? today;
    const lastOff = await prisma.vehicleTracker.findFirst({
      where: { vehicleId: v.id, removedOn: { not: null } },
      orderBy: { removedOn: 'desc' },
      select: { removedOn: true },
    });
    const bounds = { arrivedOn: isoDate(v.arrivedOn), lastRemovedOn: isoDate(lastOff?.removedOn) };
    const fault = trackerDayFault({ on, today, ...bounds });
    if (fault) {
      // The refusal names the first day it would take and what sets it, as
      // the sheet does under the field (QA, 22.10.2026).
      const earliest = trackerEarliestDay(bounds);
      throw badRequest('tracker_date_bad', 'A day the tracker was on the moped: not after today, not before the moped came or its last tracker came off.', {
        field: 'installedOn',
        fault,
        earliest: earliest?.on ?? null,
        earliestBy: earliest?.by ?? null,
      });
    }
    await prisma.$transaction(async (tx) => {
      await fitTracker(tx, { vehicleId: v.id, jobId: null, partId: null, servicePartId: null, donorVehicleId: null, imei, simPhone, on, actorId: actor.id, source: 'card' });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'tracker.write', entityType: 'vehicle', entityId: v.id, after: { ...trackerTails({ imei, simPhone }), installedOn: on } },
      });
    });
    return reply.code(201).send({ ok: true });
  });

  // The tracker on the moped now, whoever wrote it — a repair's too: a SIM
  // changed is not a repair. The same numbers again change nothing and leave
  // no line in the history.
  app.patch<{ Params: { id: string }; Body: Body }>('/api/fleet/:id/tracker', { config: { scope: 'service.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const v = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!v) throw notFound('vehicle_not_found', 'No such moped.');
    const asked = { imei: 'imei' in b ? readImeiOf(b) : null, simPhone: 'sim' in b ? readSimOf(b) : null };
    if (asked.imei == null && asked.simPhone == null) throw badRequest('missing_field', 'Say the IMEI or the SIM number to correct.', { field: 'imei' });
    const tracker = await prisma.vehicleTracker.findFirst({ where: { vehicleId: v.id, removedOn: null }, select: { id: true, imei: true, simPhone: true } });
    if (!tracker) throw notFound('tracker_none', 'No tracker is on this moped.');
    const change = trackerCorrection(tracker, asked);
    if (!change) return { ok: true, changed: false };
    if (change.imei) {
      const elsewhere = await imeiOpenElsewhere(prisma, change.imei, tracker.id);
      if (elsewhere) throw imeiInUse(elsewhere);
    }
    await prisma.$transaction(async (tx) => {
      try {
        await tx.vehicleTracker.update({ where: { id: tracker.id }, data: change });
      } catch (e) {
        // Another moped took this IMEI a moment ago: the database says so.
        if (isUniqueViolation(e)) throw imeiInUse(null);
        throw e;
      }
      const was = trackerTails({ imei: change.imei ? tracker.imei : null, simPhone: change.simPhone ? tracker.simPhone : null });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'tracker.correct', entityType: 'vehicle', entityId: v.id, before: was, after: trackerTails(change) },
      });
    });
    return { ok: true, changed: true };
  });

  // ---- reference data: mopeds (owner); models live in routes/models.ts ----
  app.patch<{ Params: { id: string }; Body: Body }>('/api/fleet/:id', { config: { scope: 'settings.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const before = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('vehicle_not_found', 'No such moped.');
    const data: Record<string, unknown> = {};
    if ('color' in b) data.color = str(b, 'color', { max: 60 });
    if ('year' in b) data.year = int(b, 'year', { min: 2000 });
    if ('odometerKm' in b) data.odometerKm = int(b, 'odometerKm', { min: 0 });
    if ('notes' in b) data.notes = str(b, 'notes', { max: 4000 });
    if ('arrivedOn' in b) data.arrivedOn = dateFromISO(date(b, 'arrivedOn'));
    if ('modelId' in b) data.modelId = str(b, 'modelId', { required: true });
    if ('archived' in b) {
      // A moped out on rent is not something to hide from the fleet.
      if (Boolean(b.archived) && before.state === 'rented') throw conflict('vehicle_rented_move', 'Close the rental first.');
      data.archived = Boolean(b.archived);
    }
    await prisma.vehicle.update({ where: { id: before.id }, data: { ...data, updatedAt: new Date() } });
    await audit({ actorId: actor.id, action: 'vehicle.update', entityType: 'vehicle', entityId: before.id, before: pickKeys(before, data) as object, after: data as object });
    return { ok: true };
  });

  app.post<{ Body: Body }>('/api/fleet', { config: { scope: 'settings.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    // Seventeen characters without I, O or Q (B3-06, crit. 31): a VIN typed
    // with a letter that is not in one is a VIN nobody will find again.
    const vin = normalizeVin(str(b, 'vin', { required: true, max: 40 })!);
    const fault = vinFault(vin);
    if (fault) throw badRequest('bad_vin', 'A VIN is 17 characters and has no I, O or Q.', { field: 'vin', fault });
    const arrivedOn = date(b, 'arrivedOn');
    try {
      const v = await prisma.$transaction(async (tx) => {
        const created = await tx.vehicle.create({
          data: {
            vin,
            modelId: str(b, 'modelId', { required: true })!,
            color: str(b, 'color', { max: 60 }),
            year: int(b, 'year', { min: 2000 }),
            arrivedOn: dateFromISO(arrivedOn),
            odometerKm: int(b, 'odometerKm', { min: 0 }),
            notes: str(b, 'notes', { max: 4000 }),
          },
        });
        await tx.vehicleEvent.create({
          data: { vehicleId: created.id, kind: 'arrived', occurredOn: dateFromISO(arrivedOn ?? todayISO(new Date(), env.TZ))!, fromState: null, toState: 'available', actorId: actor.id },
        });
        await tx.auditLog.create({ data: { actorId: actor.id, action: 'vehicle.create', entityType: 'vehicle', entityId: created.id, after: { vin, arrivedOn } } });
        return created;
      });
      return reply.code(201).send({ id: v.id });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_vin', 'This VIN is already in the fleet.');
      throw e;
    }
  });
}

function pickKeys(obj: object, keys: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(keys)) out[k] = (obj as Record<string, unknown>)[k];
  return out;
}
