import { CUSTOMER_KINDS, DEFAULT_DEPOSIT_TETRI, VEHICLE_STATES, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { hasPerm } from '../lib/auth.js';
import { dateFromISO } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { pickUp, returnRental } from '../lib/rentals.js';
import { ITEM_STATES, RETURN_ITEMS, WITHHOLD_GROUNDS, type ItemState, type ReturnItem, type WithholdGround } from '../lib/pdf/returnAct.js';
import { date, int, oneOf, str, strList, tetri } from '../lib/validate.js';
import { moveVehicle } from '../lib/vehicles.js';

type Body = Record<string, unknown>;

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
    try {
      const c = await prisma.customer.create({
        data: {
          name,
          nameKa: str(b, 'nameKa', { max: 200 }),
          nameLat: str(b, 'nameLat', { max: 200 }),
          personalId,
          phone,
          email: str(b, 'email', { max: 200 }),
          address: str(b, 'address', { max: 300 }),
          kind: oneOf(b, 'kind', CUSTOMER_KINDS) ?? 'person',
          isSupplier: Boolean(b.isSupplier),
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
    for (const k of ['name', 'nameKa', 'nameLat', 'personalId', 'phone', 'email', 'address', 'notes'] as const) {
      if (k in b) data[k] = str(b, k, { max: k === 'notes' ? 4000 : 300, required: k === 'name' });
    }
    if ('kind' in b) data.kind = oneOf(b, 'kind', CUSTOMER_KINDS, { required: true });
    if ('tags' in b) data.tags = strList(b, 'tags');
    if ('archived' in b) data.archived = Boolean(b.archived);
    if ('isSupplier' in b) data.isSupplier = Boolean(b.isSupplier);
    try {
      await prisma.customer.update({ where: { id: before.id }, data: { ...data, updatedAt: new Date() } });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_personal_id', 'That personal number is already on a card.');
      throw e;
    }
    await audit({ actorId: actor.id, action: 'customer.update', entityType: 'customer', entityId: before.id, before: pickKeys(before, data), after: data });
    return { ok: true };
  });

  // ---- hand-over (RNT-01) --------------------------------------------------
  app.post<{ Body: Body }>('/api/rentals', { config: { scope: 'rental.create' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const vehicleId = str(b, 'vehicleId');
    const vinNote = str(b, 'vinNote', { max: 200 });
    if (!vehicleId && !vinNote) throw conflict('vin_or_note', 'Pick a moped from the fleet, or say why the VIN is not confirmed.');
    const today = todayISO(new Date(), env.TZ);
    const result = await pickUp({
      actorId: actor.id,
      customerId: str(b, 'customerId', { required: true })!,
      vehicleId,
      vinNote,
      weeklyRateTetri: tetri(b, 'weeklyRateTetri', { required: true, min: 0 })!,
      depositTetri: tetri(b, 'depositTetri', { min: 0 }) ?? DEFAULT_DEPOSIT_TETRI,
      pickedUpOn: date(b, 'pickedUpOn') ?? today,
      expectedReturnOn: date(b, 'expectedReturnOn'),
      odometerKm: int(b, 'odometerKm', { min: 0 }),
      condition: str(b, 'condition', { max: 4000 }),
      notes: str(b, 'notes', { max: 4000 }),
      buyoutTargetTetri: tetri(b, 'buyoutTargetTetri', { min: 1 }),
      buyoutPerPaymentTetri: tetri(b, 'buyoutPerPaymentTetri', { min: 1 }),
      nightParkingAddress: str(b, 'nightParkingAddress', { max: 300 }),
      batteries: int(b, 'batteries', { min: 0 }),
      chargers: int(b, 'chargers', { min: 0 }),
      today,
    });
    return reply.code(201).send(result);
  });

  // ---- return (RNT-04, RNT-05) --------------------------------------------
  app.post<{ Params: { id: string }; Body: Body }>('/api/rentals/:id/return', { config: { scope: 'rental.return' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const today = todayISO(new Date(), env.TZ);
    let deposit: {
      returnedTetri: number;
      withheldTetri: number;
      withheldReason: string | null;
      returnedTo: string | null;
      grounds: WithholdGround[];
    } | null = null;
    if (b.deposit && typeof b.deposit === 'object') {
      if (!hasPerm(actor, 'deposit.decide')) throw conflict('deposit_decision_forbidden', 'Only the director or the owner decides on a deposit.');
      const d = b.deposit as Body;
      deposit = {
        returnedTetri: tetri(d, 'returnedTetri', { min: 0 }) ?? 0,
        withheldTetri: tetri(d, 'withheldTetri', { min: 0 }) ?? 0,
        withheldReason: str(d, 'withheldReason', { max: 1000 }),
        returnedTo: str(d, 'returnedTo', { max: 200 }),
        grounds: strList(d, 'grounds').filter((g): g is WithholdGround => (WITHHOLD_GROUNDS as readonly string[]).includes(g)),
      };
    }
    const { actId } = await returnRental({
      actorId: actor.id,
      rentalId: req.params.id,
      returnedOn: date(b, 'returnedOn') ?? today,
      odometerKm: int(b, 'odometerKm', { min: 0 }),
      condition: str(b, 'condition', { max: 4000 }),
      items: readItems(b.items),
      deposit,
      canConfirm: hasPerm(actor, 'deposit.confirm'),
    });
    return { ok: true, actId };
  });

  // Owner confirms a withholding or a third-party return (RNT-05).
  app.post<{ Params: { id: string } }>('/api/rentals/:id/deposit/confirm', { config: { scope: 'deposit.confirm' } }, async (req) => {
    const actor = actorOf(req);
    const d = await prisma.deposit.findUnique({ where: { rentalId: req.params.id } });
    if (!d) throw notFound('deposit_not_found', 'No deposit on this rental.');
    if (d.status === 'held') throw conflict('nothing_to_confirm', 'No decision has been made on this deposit yet.');
    await prisma.deposit.update({ where: { id: d.id }, data: { confirmedById: actor.id, updatedAt: new Date() } });
    await audit({ actorId: actor.id, action: 'deposit.confirm', entityType: 'deposit', entityId: d.id, after: { status: d.status, withheldTetri: d.withheldTetri, returnedTo: d.returnedTo } });
    return { ok: true };
  });

  // Small edits on a rental: notes, expected return, pause / dispute with a
  // reason, and confirming the VIN of a rental that was opened without one.
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
    if ('status' in b) {
      const status = oneOf(b, 'status', ['active', 'paused', 'disputed'] as const, { required: true })!;
      if (r.status === 'returned') throw conflict('already_returned', 'A closed rental does not change status.');
      if (status !== 'active' && !str(b, 'reason')) throw conflict('reason_required', 'Pausing or disputing a rental needs a reason.');
      data.status = status;
    }
    const vehicleId = str(b, 'vehicleId');
    await prisma.$transaction(async (tx) => {
      if (vehicleId) {
        if (r.vehicleId) throw conflict('vehicle_already_set', 'This rental already has a moped.');
        const v = await tx.vehicle.findUnique({ where: { id: vehicleId } });
        if (!v) throw notFound('vehicle_not_found', 'No such moped.');
        if (v.state !== 'available') throw conflict('vehicle_not_available', 'This moped cannot be handed over in its current state.', { state: v.state });
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
      }
      await tx.rental.update({ where: { id: r.id }, data: { ...data, updatedAt: new Date() } });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'rental.update', entityType: 'rental', entityId: r.id, before: pickKeys(r, data) as object, after: data as object, note: str(b, 'reason', { max: 1000 }) },
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
    if (v.state === 'rented' && v.currentRentalId) throw conflict('vehicle_rented', 'Close the rental first; a rented moped does not move by hand.');
    const moved = await prisma.$transaction(async (tx) => {
      const m = await moveVehicle(tx, { vehicleId: v.id, kind: 'manual', occurredOn, actorId: actor.id, reason, toState });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'vehicle.state.manual', entityType: 'vehicle', entityId: v.id, before: { state: m.from }, after: { state: m.to }, note: reason } });
      return m;
    });
    return moved;
  });

  // ---- reference data: models and mopeds (owner) --------------------------
  app.post<{ Body: Body }>('/api/models', { config: { scope: 'settings.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const m = await prisma.vehicleModel.create({
      data: {
        brand: str(b, 'brand', { required: true, max: 100 })!,
        name: str(b, 'name', { required: true, max: 100 })!,
        salePriceTetri: tetri(b, 'salePriceTetri', { min: 0 }),
        weeklyRateTetri: tetri(b, 'weeklyRateTetri', { min: 0 }),
        costTetri: tetri(b, 'costTetri', { min: 0 }),
        forSale: b.forSale == null ? true : Boolean(b.forSale),
        forRent: Boolean(b.forRent),
        notes: str(b, 'notes', { max: 4000 }),
      },
    });
    await audit({ actorId: actor.id, action: 'model.create', entityType: 'vehicle_model', entityId: m.id, after: { brand: m.brand, name: m.name } });
    return reply.code(201).send({ id: m.id });
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/models/:id', { config: { scope: 'settings.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const before = await prisma.vehicleModel.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('model_not_found', 'No such model.');
    const data: Record<string, unknown> = {};
    if ('brand' in b) data.brand = str(b, 'brand', { required: true, max: 100 });
    if ('name' in b) data.name = str(b, 'name', { required: true, max: 100 });
    for (const k of ['salePriceTetri', 'weeklyRateTetri', 'costTetri'] as const) {
      if (k in b) data[k] = tetri(b, k, { min: 0 });
    }
    if ('forSale' in b) data.forSale = Boolean(b.forSale);
    if ('forRent' in b) data.forRent = Boolean(b.forRent);
    if ('notes' in b) data.notes = str(b, 'notes', { max: 4000 });
    if ('archived' in b) data.archived = Boolean(b.archived);
    if ('isSupplier' in b) data.isSupplier = Boolean(b.isSupplier);
    try {
      await prisma.vehicleModel.update({ where: { id: before.id }, data: { ...data, updatedAt: new Date() } });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_model', 'That brand and name are already a model.');
      throw e;
    }
    await audit({ actorId: actor.id, action: 'model.update', entityType: 'vehicle_model', entityId: before.id, before: pickKeys(before, data) as object, after: data as object });
    return { ok: true };
  });

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
      if (Boolean(b.archived) && before.state === 'rented') throw conflict('vehicle_rented', 'Close the rental first.');
      data.archived = Boolean(b.archived);
    }
    await prisma.vehicle.update({ where: { id: before.id }, data: { ...data, updatedAt: new Date() } });
    await audit({ actorId: actor.id, action: 'vehicle.update', entityType: 'vehicle', entityId: before.id, before: pickKeys(before, data) as object, after: data as object });
    return { ok: true };
  });

  app.post<{ Body: Body }>('/api/fleet', { config: { scope: 'settings.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const vin = str(b, 'vin', { required: true, max: 17 })!.toUpperCase();
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

/** The return act's per-item checklist, kept to the codes the form has. */
function readItems(raw: unknown): Partial<Record<ReturnItem, { state: ItemState; note: string | null }>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Record<ReturnItem, { state: ItemState; note: string | null }>> = {};
  for (const item of RETURN_ITEMS) {
    const rec = (raw as Record<string, unknown>)[item];
    if (!rec || typeof rec !== 'object') continue;
    const state = (rec as { state?: unknown }).state;
    if (typeof state !== 'string' || !(ITEM_STATES as readonly string[]).includes(state)) continue;
    const note = (rec as { note?: unknown }).note;
    out[item] = { state: state as ItemState, note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null };
  }
  return out;
}

function pickKeys(obj: object, keys: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(keys)) out[k] = (obj as Record<string, unknown>)[k];
  return out;
}
