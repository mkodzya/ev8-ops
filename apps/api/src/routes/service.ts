import { closeCharge, jobTotalTetri, labourTetri as labourFor, minutesFromHours, partPriceTetri, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { hasPerm } from '../lib/auth.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { issueForServicePart, partRows, returnServiceParts, unissueForServicePart } from '../lib/stock.js';
import { actorOf } from '../lib/guard.js';
import { date, int, oneOf, str, tetri } from '../lib/validate.js';
import { syncDeposit } from '../lib/rentalMoney.js';
import { moveVehicle } from '../lib/vehicles.js';

// Repair jobs (SRV-01, SRV-02).
//
// A job is opened on a VIN. If the moped is standing in the yard it goes
// into service and comes back when the job is closed; if it is out with a
// renter it stays out — the repair happens around the rental — and the job
// remembers which of the two it did.

type Body = Record<string, unknown>;

const PAYERS = ['company', 'customer'] as const;
type Payer = (typeof PAYERS)[number];

/**
 * The payer changed, so the catalogue lines already on the job are priced
 * again (crit. 23). A line is repriced only when it still carries the price
 * the rule gave it: what the shelf paid for a company job, retail for a
 * customer's. A figure somebody typed over that is their own and is left
 * alone, and a line that names a part nobody stocks has no rule to follow.
 */
async function repriceLines(jobId: string, from: Payer, to: Payer): Promise<{ id: string; from: number; to: number }[]> {
  const lines = await prisma.servicePart.findMany({
    where: { jobId, partId: { not: null } },
    select: { id: true, unitPriceTetri: true, unitCostTetri: true, part: { select: { salePriceTetri: true } } },
  });
  const out: { id: string; from: number; to: number }[] = [];
  for (const l of lines) {
    const shelf = { avgCostTetri: l.unitCostTetri, salePriceTetri: l.part?.salePriceTetri ?? null };
    const was = partPriceTetri(from, shelf);
    const now = partPriceTetri(to, shelf);
    if (now == null || was == null || now === l.unitPriceTetri) continue;
    if (l.unitPriceTetri !== was) continue; // a price somebody typed
    out.push({ id: l.id, from: l.unitPriceTetri, to: now });
  }
  return out;
}

function totalOf(job: { labourTetri: number; parts: { qty: number; unitPriceTetri: number }[] }): number {
  return jobTotalTetri({ parts: job.parts, labourTetri: job.labourTetri });
}

function serialize(job: {
  id: string;
  number: string;
  reason: string;
  openedOn: Date;
  closedOn: Date | null;
  status: string;
  payer: string;
  labourTetri: number;
  labourMinutes: number;
  labourRateTetri: number;
  chargedTetri: number;
  odometerKm: number | null;
  workshopId: string | null;
  workshop?: { id: string; name: string } | null;
  closedAt?: { id: string; name: string } | null;
  doneBy: string | null;
  notes: string | null;
  movedVehicle: boolean;
  withheldTetri: number;
  vehicle: { id: string; vin: string; model: { brand: string; name: string } };
  rental: { id: string; number: string } | null;
  customer: { id: string; name: string } | null;
  parts: { id: string; name: string; qty: number; unitPriceTetri: number; unitCostTetri?: number | null; partId?: string | null }[];
  photos?: { id: string; label: string }[];
}) {
  return {
    id: job.id,
    number: job.number,
    reason: job.reason,
    openedOn: isoDate(job.openedOn),
    closedOn: isoDate(job.closedOn),
    status: job.status,
    payer: job.payer,
    labourTetri: job.labourTetri,
    /** Work as it was entered: hours at a rate, so "1.5 × 50 ₾" reads back (§3.7). */
    labourMinutes: job.labourMinutes,
    labourRateTetri: job.labourRateTetri,
    partsTetri: job.parts.reduce((n, p) => n + p.qty * p.unitPriceTetri, 0),
    totalTetri: totalOf(job),
    withheldTetri: job.withheldTetri,
    /** What the customer owes for this repair after the deposit was drawn on (Q26). */
    chargedTetri: job.chargedTetri,
    odometerKm: job.odometerKm,
    workshop: job.workshop ?? null,
    closedAt: job.closedAt ?? null,
    doneBy: job.doneBy,
    notes: job.notes,
    movedVehicle: job.movedVehicle,
    vehicle: { id: job.vehicle.id, vin: job.vehicle.vin, model: `${job.vehicle.model.brand} ${job.vehicle.model.name}` },
    rental: job.rental,
    customer: job.customer,
    parts: job.parts,
    photos: job.photos ?? [],
  };
}

const INCLUDE = {
  vehicle: { include: { model: { select: { brand: true, name: true } } } },
  rental: { select: { id: true, number: true } },
  customer: { select: { id: true, name: true, nameKa: true, nameLat: true } },
  workshop: { select: { id: true, name: true } },
  closedAt: { select: { id: true, name: true } },
  parts: { orderBy: { createdAt: 'asc' as const } },
} as const;

export function serviceRoutes(app: FastifyInstance): void {
  /** The workshops that do the repairs — a list the owner keeps (`service.md`). */
  app.get('/api/workshops', { config: { scope: 'fleet.view' } }, async () => {
    const workshops = await prisma.workshop.findMany({
      where: { archived: false },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, phone: true, note: true },
    });
    return { workshops };
  });

  app.post<{ Body: Body }>('/api/workshops', { config: { scope: 'settings.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const name = str(b, 'name', { required: true, max: 200 })!;
    try {
      const row = await prisma.workshop.create({
        data: {
          name,
          phone: str(b, 'phone', { max: 40 }),
          note: str(b, 'note', { max: 1000 }),
          sortOrder: int(b, 'sortOrder', { min: 0 }) ?? 0,
          createdById: actor.id,
        },
        select: { id: true, name: true },
      });
      await audit({ actorId: actor.id, action: 'workshop.create', entityType: 'workshop', entityId: row.id, after: { name } });
      return reply.code(201).send(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('workshop_exists', 'A workshop by that name is already on the list.', { field: 'name' });
      throw e;
    }
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/workshops/:id', { config: { scope: 'settings.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const row = await prisma.workshop.findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound('workshop_not_found', 'No such workshop.');
    const data: Record<string, unknown> = {};
    if ('name' in b) data.name = str(b, 'name', { required: true, max: 200 });
    if ('phone' in b) data.phone = str(b, 'phone', { max: 40 });
    if ('note' in b) data.note = str(b, 'note', { max: 1000 });
    if ('archived' in b) data.archived = b.archived === true;
    await prisma.workshop.update({ where: { id: row.id }, data: { ...data, updatedAt: new Date() } });
    await audit({ actorId: actor.id, action: 'workshop.update', entityType: 'workshop', entityId: row.id, before: { name: row.name }, after: data as object });
    return { ok: true };
  });

  app.get<{ Querystring: { status?: string } }>('/api/service', { config: { scope: 'fleet.view' } }, async (req) => {
    const status = req.query.status;
    const jobs = await prisma.serviceJob.findMany({
      where: status === 'open' || status === 'done' || status === 'cancelled' || status === 'draft' ? { status } : {},
      orderBy: [{ status: 'asc' }, { openedOn: 'desc' }],
      take: 300,
      include: INCLUDE,
    });
    const [open, drafts, workshops] = await Promise.all([
      prisma.serviceJob.count({ where: { status: 'open' } }),
      prisma.serviceJob.count({ where: { status: 'draft' } }),
      prisma.workshop.findMany({ where: { archived: false }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, phone: true } }),
    ]);
    return { open, drafts, workshops, jobs: jobs.map(serialize) };
  });

  app.get<{ Params: { id: string } }>('/api/service/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const job = await prisma.serviceJob.findUnique({
      where: { id: req.params.id },
      include: { ...INCLUDE, photos: { where: { archived: false }, select: { id: true, label: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    return { job: serialize(job) };
  });

  /**
   * Open a job (SRV-01), or report a breakdown (§3.7). The moped moves into
   * service unless it is out with somebody; a manager's report opens the same
   * record as a draft, so nothing is lost between the yard and the owner.
   */
  app.post<{ Body: Body }>('/api/service', { config: { scope: 'service.report' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const vehicleId = str(b, 'vehicleId', { required: true })!;
    const reason = str(b, 'reason', { required: true, max: 2000 })!;
    const openedOn = date(b, 'openedOn') ?? todayISO(new Date(), env.TZ);

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: { currentRental: { select: { id: true, customerId: true } } },
    });
    if (!vehicle) throw notFound('vehicle_not_found', 'No such moped.');
    if (vehicle.state === 'sold' || vehicle.state === 'out') {
      throw conflict('vehicle_gone', 'This moped is no longer in the fleet.', { state: vehicle.state });
    }
    const alreadyOpen = await prisma.serviceJob.findFirst({ where: { vehicleId, status: { in: ['open', 'draft'] } }, select: { id: true, number: true } });
    if (alreadyOpen) throw conflict('job_already_open', 'This moped already has an open repair job.', { job: alreadyOpen });

    const rented = vehicle.state === 'rented' && vehicle.currentRental != null;
    const payer = oneOf(b, 'payer', PAYERS) ?? 'company';
    // A manager may say a moped is broken, and no more than that (§3.7): the
    // repair opens as a draft for an owner to take up, and what it will cost
    // or who pays is not a manager's to decide.
    const reported = !hasPerm(actor, 'service.manage');
    const workshopId = str(b, 'workshopId');
    const minutes = 'labourHours' in b ? minutesFromHours(Number(b.labourHours) || 0) : (int(b, 'labourMinutes', { min: 0 }) ?? 0);
    if (payer === 'customer' && !rented) {
      throw conflict('no_renter', 'Only a moped that is out with somebody can be repaired at their expense.');
    }

    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.serviceJob.create({
        data: {
          vehicleId,
          rentalId: rented ? vehicle.currentRental!.id : null,
          customerId: payer === 'customer' ? vehicle.currentRental!.customerId : null,
          reason,
          openedOn: dateFromISO(openedOn)!,
          status: reported ? 'draft' : 'open',
          payer,
          workshopId,
          labourMinutes: minutes,
          labourTetri: minutes > 0 ? labourFor(minutes) : (tetri(b, 'labourTetri', { min: 0 }) ?? 0),
          doneBy: str(b, 'doneBy', { max: 200 }),
          notes: str(b, 'notes', { max: 4000 }),
          movedVehicle: !rented,
          createdById: actor.id,
        },
        select: { id: true, number: true },
      });
      if (!rented) {
        await moveVehicle(tx, { vehicleId, kind: 'service_in', occurredOn: openedOn, actorId: actor.id, reason });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: reported ? 'service.report' : 'service.open',
          entityType: 'service_job',
          entityId: created.id,
          after: { number: created.number, vehicleId, reason, payer, movedVehicle: !rented, draft: reported },
        },
      });
      return created;
    });
    return reply.code(201).send(job);
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/service/:id', { config: { scope: 'service.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const job = await prisma.serviceJob.findUnique({ where: { id: req.params.id } });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    if (job.status !== 'open' && job.status !== 'draft') throw conflict('job_closed', 'A closed job is a record; it is not edited.');
    if (job.status === 'draft' && !hasPerm(actor, 'service.manage')) throw conflict('job_closed', 'An owner takes a reported breakdown up.');

    const data: Record<string, unknown> = {};
    if ('reason' in b) data.reason = str(b, 'reason', { required: true, max: 2000 });
    if ('workshopId' in b) data.workshopId = str(b, 'workshopId');
    // Work is hours at a rate; the money follows from them (§3.7, crit. 24).
    if ('labourHours' in b || 'labourMinutes' in b) {
      const minutes = 'labourHours' in b ? minutesFromHours(Number(b.labourHours) || 0) : (int(b, 'labourMinutes', { min: 0 }) ?? 0);
      data.labourMinutes = minutes;
      data.labourTetri = labourFor(minutes);
    } else if ('labourTetri' in b) data.labourTetri = tetri(b, 'labourTetri', { min: 0 }) ?? 0;
    // An owner picks a manager's report up and it becomes a repair (§3.10).
    if (b.open === true) data.status = 'open';
    if ('doneBy' in b) data.doneBy = str(b, 'doneBy', { max: 200 });
    if ('notes' in b) data.notes = str(b, 'notes', { max: 4000 });
    // Who pays decides what a catalogue part costs (B8-04, crit. 22, 23), so
    // changing the payer repriced nothing and the lines already on the job
    // kept the other side's price: a customer was billed at what the shelf
    // paid (QA-W5-13). Lines priced by the rule follow the payer; a price
    // somebody typed is their own and stays.
    let repriced: { id: string; from: number; to: number }[] = [];
    if ('payer' in b) {
      const payer = oneOf(b, 'payer', PAYERS, { required: true })!;
      if (payer === 'customer' && !job.rentalId) throw conflict('no_renter', 'This job names no renter to charge.');
      data.payer = payer;
      data.customerId = payer === 'customer' ? job.customerId : null;
      if (payer === 'customer' && !job.customerId) {
        const rental = await prisma.rental.findUniqueOrThrow({ where: { id: job.rentalId! }, select: { customerId: true } });
        data.customerId = rental.customerId;
      }
      if (payer !== job.payer) repriced = await repriceLines(job.id, job.payer as Payer, payer);
    }
    await prisma.$transaction(async (tx) => {
      await tx.serviceJob.update({ where: { id: job.id }, data: { ...data, updatedAt: new Date() } });
      for (const line of repriced) {
        await tx.servicePart.update({ where: { id: line.id }, data: { unitPriceTetri: line.to } });
      }
    });
    await audit({
      actorId: actor.id,
      action: 'service.update',
      entityType: 'service_job',
      entityId: job.id,
      after: repriced.length > 0 ? { ...(data as object), repriced } : (data as object),
    });
    return { ok: true, repriced: repriced.length };
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/service/:id/parts', { config: { scope: 'service.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const job = await prisma.serviceJob.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, openedOn: true, payer: true } });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    if (job.status !== 'open') throw conflict('job_closed', 'A closed job is a record; it is not edited.');

    // A line may take the part off the shelf, or just name it. A repair on a
    // part nobody keeps in stock is still a repair.
    const catalogueId = str(b, 'partId');
    const catalogue = catalogueId ? await prisma.part.findUnique({ where: { id: catalogueId } }) : null;
    if (catalogueId && !catalogue) throw notFound('part_not_found', 'No such part.');
    const name = catalogue?.name ?? str(b, 'name', { required: true, max: 200 })!;
    const qty = int(b, 'qty', { min: 1 }) ?? 1;
    // The company's own repair is costed at what the shelf paid; a customer's
    // at what the part is sold for (B8-04, crit. 22, 23).
    const shelf = catalogue ? (await partRows()).find((r) => r.id === catalogue.id) ?? null : null;
    const suggested = catalogue ? partPriceTetri(job.payer as 'company' | 'customer', { avgCostTetri: shelf?.avgCostTetri ?? null, salePriceTetri: catalogue.salePriceTetri }) : null;
    const price = tetri(b, 'unitPriceTetri', { min: 0 }) ?? suggested;
    if (price == null) throw badRequest('missing_field', 'unitPriceTetri is required', { field: 'unitPriceTetri' });

    const part = await prisma.$transaction(async (tx) => {
      const created = await tx.servicePart.create({
        data: { jobId: job.id, name, qty, unitPriceTetri: price, unitCostTetri: shelf?.avgCostTetri ?? null, partId: catalogue?.id ?? null },
        select: { id: true },
      });
      if (catalogue) {
        await issueForServicePart(tx, {
          servicePartId: created.id,
          partId: catalogue.id,
          qty,
          occurredOn: isoDate(job.openedOn)!,
          actorId: actor.id,
        });
      }
      return created;
    });
    await audit({ actorId: actor.id, action: 'service.part.add', entityType: 'service_job', entityId: job.id, after: { partId: part.id, name, qty } });
    return reply.code(201).send(part);
  });

  app.delete<{ Params: { id: string; partId: string } }>(
    '/api/service/:id/parts/:partId',
    { config: { scope: 'service.manage' } },
    async (req) => {
      const actor = actorOf(req);
      const part = await prisma.servicePart.findUnique({ where: { id: req.params.partId }, include: { job: { select: { id: true, status: true } } } });
      if (!part || part.job.id !== req.params.id) throw notFound('part_not_found', 'No such part on this job.');
      if (part.job.status !== 'open') throw conflict('job_closed', 'A closed job is a record; it is not edited.');
      // Taking the line off the job puts the parts back on the shelf.
      await prisma.$transaction(async (tx) => {
        await unissueForServicePart(tx, part.id);
        await tx.servicePart.delete({ where: { id: part.id } });
      });
      await audit({ actorId: actor.id, action: 'service.part.remove', entityType: 'service_job', entityId: part.job.id, before: { name: part.name, qty: part.qty } });
      return { ok: true };
    },
  );

  /**
   * Close a job. The moped comes back only if this job is what took it away.
   * Keeping part of the deposit is a decision about somebody's money, so it
   * belongs to whoever may decide on a deposit (SRV-02, RNT-05).
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/service/:id/close', { config: { scope: 'service.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const job = await prisma.serviceJob.findUnique({ where: { id: req.params.id }, include: { parts: true } });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    if (job.status !== 'open') throw conflict('job_closed', 'This job is already closed.');

    const closedOn = date(b, 'closedOn') ?? todayISO(new Date(), env.TZ);
    if (closedOn < isoDate(job.openedOn)!) throw conflict('closed_before_opened', 'A job cannot close before it was opened.');
    const withheldTetri = tetri(b, 'withheldTetri', { min: 0 }) ?? 0;
    const total = totalOf(job);
    // Two things are asked of every closing (B5-06, crit. 26): what the
    // odometer read, and where the moped stands now.
    const odometerKm = int(b, 'odometerKm', { min: 0 });
    const closedLocationId = str(b, 'locationId');
    if (job.movedVehicle) {
      if (odometerKm == null) throw badRequest('missing_field', 'Say what the odometer reads.', { field: 'odometerKm' });
      if (!closedLocationId) throw badRequest('missing_field', 'Say where the moped stands now.', { field: 'locationId' });
    }

    if (withheldTetri > 0) {
      if (!hasPerm(actor, 'deposit.decide')) throw conflict('deposit_decision_forbidden', 'Only an owner decides on a deposit.');
      if (job.payer !== 'customer' || !job.rentalId) throw conflict('no_renter', 'Only a repair charged to a renter can come out of their deposit.');
      if (withheldTetri > total) throw conflict('withheld_over_total', 'More than the repair itself cannot be kept.');
    }

    await prisma.$transaction(async (tx) => {
      if (withheldTetri > 0) {
        const deposit = await tx.deposit.findUnique({
          where: { rentalId: job.rentalId! },
          include: { withholdings: { where: { voidedAt: null } }, payouts: { where: { voidedAt: null }, select: { grossTetri: true } } },
        });
        if (!deposit) throw conflict('no_deposit', 'This rental has no deposit.');
        const kept = deposit.withholdings.reduce((n, w) => n + w.amountTetri, 0);
        const paidOut = deposit.paidOutBeforeTetri + deposit.payouts.reduce((n, p) => n + p.grossTetri, 0);
        const free = deposit.paidTetri - kept - paidOut;
        if (withheldTetri > free) {
          throw conflict('deposit_too_small', 'The deposit does not hold that much.', { freeTetri: free });
        }
        // A row of its own beside a return's: neither overwrites the other (B5-04).
        await tx.depositWithholding.create({
          data: {
            depositId: deposit.id,
            source: 'service',
            rentalId: job.rentalId,
            serviceJobId: job.id,
            amountTetri: withheldTetri,
            grounds: ['moped_damage'],
            reason: `${job.number}: ${job.reason}`.slice(0, 1000),
            createdById: actor.id,
          },
        });
        await syncDeposit(tx, deposit.id);
      }
      // What the deposit did not cover is the customer's debt, as one line
      // named after the job (Q26, crit. 25).
      const charge = job.payer === 'customer' ? closeCharge({ totalTetri: total, withholdTetri: withheldTetri, depositFreeTetri: total }) : { withheldTetri: 0, debtTetri: 0 };
      await tx.serviceJob.update({
        where: { id: job.id },
        data: {
          status: 'done',
          closedOn: dateFromISO(closedOn)!,
          withheldTetri,
          chargedTetri: charge.debtTetri,
          odometerKm: odometerKm ?? job.odometerKm,
          closedLocationId: closedLocationId ?? job.closedLocationId,
          notes: 'notes' in b ? str(b, 'notes', { max: 4000 }) : job.notes,
          updatedAt: new Date(),
        },
      });
      if (odometerKm != null) await tx.vehicle.update({ where: { id: job.vehicleId }, data: { odometerKm, updatedAt: new Date() } });
      // A moped that never left the customer keeps no point of ours while it
      // is out with them; the point is set on the one that comes back.
      if (closedLocationId && job.movedVehicle) {
        await tx.vehicle.update({ where: { id: job.vehicleId }, data: { locationId: closedLocationId, updatedAt: new Date() } });
      }
      if (job.movedVehicle) {
        await moveVehicle(tx, { vehicleId: job.vehicleId, kind: 'service_out', occurredOn: closedOn, actorId: actor.id, reason: job.reason });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'service.close',
          entityType: 'service_job',
          entityId: job.id,
          after: { closedOn, totalTetri: total, withheldTetri, payer: job.payer, odometerKm, locationId: closedLocationId },
        },
      });
    });
    return { ok: true, totalTetri: total, withheldTetri };
  });

  /** A job opened by mistake. The moped goes back where it was. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/service/:id/cancel', { config: { scope: 'service.manage' } }, async (req) => {
    const actor = actorOf(req);
    const reason = str(req.body ?? {}, 'reason', { required: true, max: 1000 })!;
    const job = await prisma.serviceJob.findUnique({ where: { id: req.params.id } });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    if (job.status !== 'open' && job.status !== 'draft') throw conflict('job_closed', 'This job is already closed.');
    const today = todayISO(new Date(), env.TZ);
    let back = 0;
    await prisma.$transaction(async (tx) => {
      // The parts go back as a movement of their own, with the reason on it (B8-04, crit. 27).
      back = await returnServiceParts(tx, { jobId: job.id, occurredOn: today, actorId: actor.id, reason: `${job.number}: ${reason}`.slice(0, 1000) });
      await tx.serviceJob.update({ where: { id: job.id }, data: { status: 'cancelled', closedOn: dateFromISO(today)!, updatedAt: new Date() } });
      if (job.movedVehicle) {
        await moveVehicle(tx, { vehicleId: job.vehicleId, kind: 'service_out', occurredOn: today, actorId: actor.id, reason });
      }
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'service.cancel', entityType: 'service_job', entityId: job.id, after: { partsBack: back }, note: reason },
      });
    });
    return { ok: true, partsBack: back };
  });
}
