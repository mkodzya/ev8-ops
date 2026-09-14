import { todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { hasPerm } from '../lib/auth.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { issueForServicePart, unissueForServicePart } from '../lib/stock.js';
import { actorOf } from '../lib/guard.js';
import { date, int, oneOf, str, tetri } from '../lib/validate.js';
import { moveVehicle } from '../lib/vehicles.js';

// Repair jobs (SRV-01, SRV-02).
//
// A job is opened on a VIN. If the moped is standing in the yard it goes
// into service and comes back when the job is closed; if it is out with a
// renter it stays out — the repair happens around the rental — and the job
// remembers which of the two it did.

type Body = Record<string, unknown>;

const PAYERS = ['company', 'customer'] as const;

function totalOf(job: { labourTetri: number; parts: { qty: number; unitPriceTetri: number }[] }): number {
  return job.labourTetri + job.parts.reduce((n, p) => n + p.qty * p.unitPriceTetri, 0);
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
  doneBy: string | null;
  notes: string | null;
  movedVehicle: boolean;
  withheldTetri: number;
  vehicle: { id: string; vin: string; model: { brand: string; name: string } };
  rental: { id: string; number: string } | null;
  customer: { id: string; name: string } | null;
  parts: { id: string; name: string; qty: number; unitPriceTetri: number }[];
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
    partsTetri: job.parts.reduce((n, p) => n + p.qty * p.unitPriceTetri, 0),
    totalTetri: totalOf(job),
    withheldTetri: job.withheldTetri,
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
  customer: { select: { id: true, name: true } },
  parts: { orderBy: { createdAt: 'asc' } },
} as const;

export function serviceRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { status?: string } }>('/api/service', { config: { scope: 'fleet.view' } }, async (req) => {
    const status = req.query.status;
    const jobs = await prisma.serviceJob.findMany({
      where: status === 'open' || status === 'done' || status === 'cancelled' ? { status } : {},
      orderBy: [{ status: 'asc' }, { openedOn: 'desc' }],
      take: 300,
      include: INCLUDE,
    });
    const open = await prisma.serviceJob.count({ where: { status: 'open' } });
    return { open, jobs: jobs.map(serialize) };
  });

  app.get<{ Params: { id: string } }>('/api/service/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const job = await prisma.serviceJob.findUnique({
      where: { id: req.params.id },
      include: { ...INCLUDE, photos: { where: { archived: false }, select: { id: true, label: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    return { job: serialize(job) };
  });

  /** Open a job (SRV-01). The moped moves into service unless it is out. */
  app.post<{ Body: Body }>('/api/service', { config: { scope: 'service.manage' } }, async (req, reply) => {
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
    const alreadyOpen = await prisma.serviceJob.findFirst({ where: { vehicleId, status: 'open' }, select: { id: true, number: true } });
    if (alreadyOpen) throw conflict('job_already_open', 'This moped already has an open repair job.', { job: alreadyOpen });

    const rented = vehicle.state === 'rented' && vehicle.currentRental != null;
    const payer = oneOf(b, 'payer', PAYERS) ?? 'company';
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
          payer,
          labourTetri: tetri(b, 'labourTetri', { min: 0 }) ?? 0,
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
          action: 'service.open',
          entityType: 'service_job',
          entityId: created.id,
          after: { number: created.number, vehicleId, reason, payer, movedVehicle: !rented },
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
    if (job.status !== 'open') throw conflict('job_closed', 'A closed job is a record; it is not edited.');

    const data: Record<string, unknown> = {};
    if ('reason' in b) data.reason = str(b, 'reason', { required: true, max: 2000 });
    if ('labourTetri' in b) data.labourTetri = tetri(b, 'labourTetri', { min: 0 }) ?? 0;
    if ('doneBy' in b) data.doneBy = str(b, 'doneBy', { max: 200 });
    if ('notes' in b) data.notes = str(b, 'notes', { max: 4000 });
    if ('payer' in b) {
      const payer = oneOf(b, 'payer', PAYERS, { required: true })!;
      if (payer === 'customer' && !job.rentalId) throw conflict('no_renter', 'This job names no renter to charge.');
      data.payer = payer;
      data.customerId = payer === 'customer' ? job.customerId : null;
      if (payer === 'customer' && !job.customerId) {
        const rental = await prisma.rental.findUniqueOrThrow({ where: { id: job.rentalId! }, select: { customerId: true } });
        data.customerId = rental.customerId;
      }
    }
    await prisma.serviceJob.update({ where: { id: job.id }, data: { ...data, updatedAt: new Date() } });
    await audit({ actorId: actor.id, action: 'service.update', entityType: 'service_job', entityId: job.id, after: data as object });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/service/:id/parts', { config: { scope: 'service.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const job = await prisma.serviceJob.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, openedOn: true } });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    if (job.status !== 'open') throw conflict('job_closed', 'A closed job is a record; it is not edited.');

    // A line may take the part off the shelf, or just name it. A repair on a
    // part nobody keeps in stock is still a repair.
    const catalogueId = str(b, 'partId');
    const catalogue = catalogueId ? await prisma.part.findUnique({ where: { id: catalogueId } }) : null;
    if (catalogueId && !catalogue) throw notFound('part_not_found', 'No such part.');
    const name = catalogue?.name ?? str(b, 'name', { required: true, max: 200 })!;
    const qty = int(b, 'qty', { min: 1 }) ?? 1;
    const price = tetri(b, 'unitPriceTetri', { min: 0 }) ?? catalogue?.salePriceTetri ?? null;
    if (price == null) throw badRequest('missing_field', 'unitPriceTetri is required', { field: 'unitPriceTetri' });

    const part = await prisma.$transaction(async (tx) => {
      const created = await tx.servicePart.create({
        data: { jobId: job.id, name, qty, unitPriceTetri: price, partId: catalogue?.id ?? null },
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

    if (withheldTetri > 0) {
      if (!hasPerm(actor, 'deposit.decide')) throw conflict('deposit_decision_forbidden', 'Only the director or the owner decides on a deposit.');
      if (job.payer !== 'customer' || !job.rentalId) throw conflict('no_renter', 'Only a repair charged to a renter can come out of their deposit.');
      if (withheldTetri > total) throw conflict('withheld_over_total', 'More than the repair itself cannot be kept.');
    }

    await prisma.$transaction(async (tx) => {
      if (withheldTetri > 0) {
        const deposit = await tx.deposit.findUnique({ where: { rentalId: job.rentalId! } });
        if (!deposit) throw conflict('no_deposit', 'This rental has no deposit.');
        const free = deposit.paidTetri - deposit.returnedTetri - deposit.withheldTetri;
        if (withheldTetri > free) {
          throw conflict('deposit_too_small', 'The deposit does not hold that much.', { freeTetri: free });
        }
        const withheld = deposit.withheldTetri + withheldTetri;
        await tx.deposit.update({
          where: { id: deposit.id },
          data: {
            withheldTetri: withheld,
            withheldReason: [deposit.withheldReason, `${job.number}: ${job.reason}`].filter(Boolean).join('; ').slice(0, 1000),
            withheldGrounds: [...new Set([...deposit.withheldGrounds, 'moped_damage'])],
            status: withheld >= deposit.amountTetri ? 'withheld' : 'partial',
            decidedById: actor.id,
            updatedAt: new Date(),
          },
        });
      }
      await tx.serviceJob.update({
        where: { id: job.id },
        data: {
          status: 'done',
          closedOn: dateFromISO(closedOn)!,
          withheldTetri,
          notes: 'notes' in b ? str(b, 'notes', { max: 4000 }) : job.notes,
          updatedAt: new Date(),
        },
      });
      if (job.movedVehicle) {
        await moveVehicle(tx, { vehicleId: job.vehicleId, kind: 'service_out', occurredOn: closedOn, actorId: actor.id, reason: job.reason });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'service.close',
          entityType: 'service_job',
          entityId: job.id,
          after: { closedOn, totalTetri: total, withheldTetri, payer: job.payer },
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
    if (job.status !== 'open') throw conflict('job_closed', 'This job is already closed.');
    const today = todayISO(new Date(), env.TZ);
    await prisma.$transaction(async (tx) => {
      await tx.serviceJob.update({ where: { id: job.id }, data: { status: 'cancelled', closedOn: dateFromISO(today)!, updatedAt: new Date() } });
      if (job.movedVehicle) {
        await moveVehicle(tx, { vehicleId: job.vehicleId, kind: 'service_out', occurredOn: today, actorId: actor.id, reason });
      }
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'service.cancel', entityType: 'service_job', entityId: job.id, note: reason },
      });
    });
    return { ok: true };
  });
}
