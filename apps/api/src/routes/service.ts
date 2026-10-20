import {
  AFTER_PHOTOS_MAX,
  JOB_PHOTOS_MAX,
  LABOUR_RATE_TETRI,
  SERVICE_REASONS,
  WORK_QTY_MAX,
  closeCharge,
  fleetNumber,
  jobTotalTetri,
  labourTetri as labourFor,
  minutesFromHours,
  normSecFromMinutes,
  partPriceTetri,
  readFleetNumber,
  readQuery,
  seesEveryRepair,
  todayISO,
  vinMatches,
  workLineState,
  workLineTetri,
  worksTotal,
} from '@ev8/shared';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit } from '../lib/audit.js';
import { hasPerm, permissionsOf, type Actor } from '../lib/auth.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { issueForServicePart, partRows, returnServiceParts, returnServicePart } from '../lib/stock.js';
import { actorOf, mayView } from '../lib/guard.js';
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

/** A repair a mechanic opens carries its photos with it: one operation, one body (as a hand-over does). */
const JOB_BODY_LIMIT = 16 * 1024 * 1024;
const PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
  closedLocation?: { id: string; name: string } | null;
  closedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: { id: string; name: string } | null;
  rejectedAt: Date | null;
  rejectedBy: { id: string; name: string } | null;
  rejectReason: string | null;
  notes: string | null;
  movedVehicle: boolean;
  withheldTetri: number;
  vehicle: { id: string; vin: string; fleetNo: number | null; model: { brand: string; name: string } };
  rental: { id: string; number: string } | null;
  customer: { id: string; name: string } | null;
  parts: { id: string; name: string; qty: number; unitPriceTetri: number; unitCostTetri?: number | null; partId?: string | null }[];
  photos?: { id: string; label: string; tag: string | null }[];
  mechanic: { id: string; name: string } | null;
  reasonKind: string | null;
  openedOdometerKm: number | null;
  odometerReason: string | null;
  openedAt: Date | null;
  works: {
    id: string;
    workTypeId: string | null;
    freeText: string | null;
    qty: number;
    normSec: number | null;
    rateTetri: number;
    mechanicId: string | null;
    createdAt: Date;
    approvedAt: Date | null;
    rejectedAt: Date | null;
    rejectReason: string | null;
    workType: { code: string; category: string; nameKa: string | null; nameRu: string | null; nameEn: string | null } | null;
  }[];
}) {
  const works = job.works.map((w) => ({
    id: w.id,
    workTypeId: w.workTypeId,
    code: w.workType?.code ?? null,
    category: w.workType?.category ?? null,
    nameKa: w.workType?.nameKa ?? null,
    nameRu: w.workType?.nameRu ?? null,
    nameEn: w.workType?.nameEn ?? null,
    freeText: w.freeText,
    qty: w.qty,
    normSec: w.normSec,
    rateTetri: w.rateTetri as number | null,
    /** The norm and the rate this line was written with, not today's (stage 2). */
    amountTetri: workLineTetri(w) as number | null,
    mechanicId: w.mechanicId,
    /** Approved with the repair or on its own, waiting, or refused (stage 3). */
    state: workLineState(w),
    addedAt: w.createdAt.toISOString(),
    decidedAt: (w.rejectedAt ?? w.approvedAt)?.toISOString() ?? null,
    rejectReason: w.rejectReason,
  }));
  // A refused line is not work done: it is shown, struck through, and not
  // counted — unless the whole repair was refused, when nothing is.
  const total = worksTotal(job.works.filter((w) => w.rejectedAt == null));
  return {
    id: job.id,
    number: job.number,
    reason: job.reason,
    openedOn: isoDate(job.openedOn),
    closedOn: isoDate(job.closedOn),
    status: job.status,
    payer: job.payer,
    labourTetri: job.labourTetri as number | null,
    /** Work as it was entered: hours at a rate, so "1.5 × 50 ₾" reads back (§3.7). */
    labourMinutes: job.labourMinutes,
    labourRateTetri: job.labourRateTetri as number | null,
    partsTetri: job.parts.reduce((n, p) => n + p.qty * p.unitPriceTetri, 0) as number | null,
    totalTetri: totalOf(job) as number | null,
    withheldTetri: job.withheldTetri as number | null,
    /** What the customer owes for this repair after the deposit was drawn on (Q26). */
    chargedTetri: job.chargedTetri as number | null,
    odometerKm: job.odometerKm,
    workshop: job.workshop ?? null,
    closedLocation: job.closedLocation ?? null,
    /** The minute it closed; empty on repairs closed before stage 3. */
    closedAt: job.closedAt?.toISOString() ?? null,
    /** Who let the work start, and when (stage 3); empty on repairs never waited for. */
    approved: job.approvedAt ? { at: job.approvedAt.toISOString(), by: job.approvedBy?.name ?? null } : null,
    /** A refused repair says who refused it and why (stage 3). */
    rejected: job.rejectedAt ? { at: job.rejectedAt.toISOString(), by: job.rejectedBy?.name ?? null, reason: job.rejectReason ?? '' } : null,
    notes: job.notes,
    movedVehicle: job.movedVehicle,
    vehicle: { id: job.vehicle.id, vin: job.vehicle.vin, number: fleetNumber(job.vehicle.fleetNo), model: `${job.vehicle.model.brand} ${job.vehicle.model.name}` },
    rental: job.rental,
    customer: job.customer as { id: string; name: string } | null,
    parts: job.parts as { id: string; name: string; qty: number; unitPriceTetri: number | null; unitCostTetri?: number | null; partId?: string | null }[],
    photos: job.photos ?? [],
    mechanic: job.mechanic,
    reasonKind: job.reasonKind,
    openedOdometerKm: job.openedOdometerKm,
    odometerReason: job.odometerReason,
    openedAt: job.openedAt?.toISOString() ?? null,
    works,
    worksTotal: { seconds: total.seconds, tetri: total.tetri as number | null, unnormed: total.unnormed },
  };
}

type Job = ReturnType<typeof serialize>;

/**
 * A repair as this person may see it (ADR-0033 §4). What it costs — the work,
 * the parts at the shelf's price and at the customer's, what the deposit
 * gave and what the customer still owes — goes only to whoever sees cost;
 * the customer's name only to whoever sees the fleet. The rest — the moped,
 * the reason, the hours, the lines and the photos — is the repair itself.
 * The fields go out empty, as the stock and the models do it.
 */
function present(req: FastifyRequest, job: Job): Job {
  // The work by the norm is what a mechanic is paid: he sees it on the
  // repairs he carries, the chief mechanic on those he approves (spec, «свои
  // начисления видит»). A manager, who carries none, does not.
  const seesWork = mayView(req, 'cost.view') || mayView(req, 'service.work');
  if (!seesWork) {
    job = {
      ...job,
      works: job.works.map((w) => ({ ...w, rateTetri: null, amountTetri: null })),
      worksTotal: { ...job.worksTotal, tetri: null },
    };
  }
  const out = mayView(req, 'cost.view')
    ? job
    : {
        ...job,
        labourTetri: null,
        labourRateTetri: null,
        partsTetri: null,
        totalTetri: null,
        withheldTetri: null,
        chargedTetri: null,
        parts: job.parts.map((p) => ({ id: p.id, name: p.name, qty: p.qty, partId: p.partId ?? null, unitPriceTetri: null, unitCostTetri: null })),
      };
  return mayView(req, 'fleet.view') ? out : { ...out, customer: null };
}

/**
 * Which repairs a person sees: all of them, or — a mechanic — the ones he
 * carries. A repair names its mechanic (stage 2); one he merely opened for
 * somebody else is not his.
 */
function mine(actor: Actor): { mechanicId?: string } {
  return seesEveryRepair(permissionsOf(actor.role, actor.via)) ? {} : { mechanicId: actor.id };
}

const INCLUDE = {
  vehicle: { include: { model: { select: { brand: true, name: true } } } },
  rental: { select: { id: true, number: true } },
  customer: { select: { id: true, name: true, nameKa: true, nameLat: true } },
  workshop: { select: { id: true, name: true } },
  closedLocation: { select: { id: true, name: true } },
  parts: { orderBy: { createdAt: 'asc' as const } },
  mechanic: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  rejectedBy: { select: { id: true, name: true } },
  // Which photo is which is the repair's business; the bytes go by their own address.
  photos: { where: { archived: false }, select: { id: true, label: true, tag: true }, orderBy: { createdAt: 'asc' as const } },
  works: {
    orderBy: { createdAt: 'asc' as const },
    include: { workType: { select: { code: true, category: true, nameKa: true, nameRu: true, nameEn: true } } },
  },
} as const;

/** A photo inside the body of a new repair; empty when none was sent. */
function jobPhoto(b: unknown, field: string): { bytes: Buffer; mime: string } | null {
  if (!b || typeof b !== 'object') return null;
  const o = b as Record<string, unknown>;
  const mime = typeof o.mimeType === 'string' ? o.mimeType : '';
  const data = typeof o.dataBase64 === 'string' ? o.dataBase64 : '';
  if (!data) return null;
  if (!PHOTO_MIME.has(mime)) throw badRequest('bad_mime', 'Repair photos are images: JPEG, PNG or WebP.', { field });
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) throw badRequest('bad_field', 'The photo is empty.', { field });
  if (bytes.length > 10 * 1024 * 1024) throw badRequest('file_too_big', 'Files up to 10 MB.', { field });
  return { bytes, mime };
}

/** The works a new repair plans: from the book by id, or words for a work the book does not have. */
function readWorkLines(raw: unknown): { workTypeId: string | null; freeText: string | null; qty: number }[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw badRequest('bad_field', 'works is a list.', { field: 'works' });
  return raw.map((x) => {
    const o = (x && typeof x === 'object' ? x : {}) as Body;
    const workTypeId = str(o, 'workTypeId');
    const freeText = workTypeId ? null : str(o, 'freeText', { max: 300 });
    if (!workTypeId && !freeText) throw badRequest('missing_field', 'A line of work is a work from the book or words.', { field: 'works' });
    const qty = int(o, 'qty', { min: 1, max: WORK_QTY_MAX }) ?? 1;
    return { workTypeId, freeText, qty };
  });
}

/** The works from the book the lines name — each one there and switched on. */
async function bookWorks(lines: { workTypeId: string | null }[]) {
  const types = await prisma.workType.findMany({ where: { id: { in: lines.flatMap((l) => (l.workTypeId ? [l.workTypeId] : [])) } } });
  for (const l of lines) {
    if (!l.workTypeId) continue;
    const w = types.find((x) => x.id === l.workTypeId);
    if (!w) throw notFound('work_type_not_found', 'No such work in the book.');
    if (!w.active) throw conflict('work_type_off', 'This work is switched off in the book.', { code: w.code });
  }
  return types;
}

/** Photos sent with an operation, as a list; empty when none were. */
function jobPhotos(raw: unknown, field: string): { bytes: Buffer; mime: string }[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((p) => jobPhoto(p, field)).filter((p): p is NonNullable<typeof p> => p != null);
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Photos after the repair, written with their tag (stage 3). */
async function writeAfterPhotos(tx: Tx, jobId: string, photos: { bytes: Buffer; mime: string }[], from: number, actorId: string): Promise<void> {
  for (const [i, p] of photos.entries()) {
    await tx.storedFile.create({
      data: {
        kind: 'service_photo',
        serviceJobId: jobId,
        tag: 'after',
        label: `after-${from + i + 1}`,
        mimeType: p.mime,
        sizeBytes: p.bytes.length,
        sha256: createHash('sha256').update(p.bytes).digest('hex'),
        bytes: new Uint8Array(p.bytes),
        uploadedById: actorId,
      },
    });
  }
}

/** Norms the approver types beside works not in the book: [{ workId, normMin }]. */
function readNorms(raw: unknown): { workId: string; normSec: number }[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw badRequest('bad_field', 'norms is a list.', { field: 'norms' });
  return raw.map((x) => {
    const o = (x && typeof x === 'object' ? x : {}) as Body;
    const workId = str(o, 'workId', { required: true })!;
    const normSec = normSecFromMinutes(o.normMin as string | number | null | undefined);
    if (normSec == null) throw badRequest('bad_field', 'A norm is minutes above zero.', { field: 'normMin', workId });
    return { workId, normSec };
  });
}

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

  app.get<{ Querystring: { status?: string } }>('/api/service', { config: { scope: 'service.view' } }, async (req) => {
    const status = req.query.status;
    const own = mine(actorOf(req));
    const jobs = await prisma.serviceJob.findMany({
      where: { ...own, ...(status === 'open' || status === 'done' || status === 'cancelled' || status === 'draft' ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { openedOn: 'desc' }],
      take: 300,
      include: INCLUDE,
    });
    const [open, drafts, workshops] = await Promise.all([
      prisma.serviceJob.count({ where: { ...own, status: 'open' } }),
      prisma.serviceJob.count({ where: { ...own, status: 'draft' } }),
      prisma.workshop.findMany({ where: { archived: false }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, phone: true } }),
    ]);
    return { open, drafts, workshops, jobs: jobs.map((j) => present(req, serialize(j))) };
  });

  app.get<{ Params: { id: string } }>('/api/service/:id', { config: { scope: 'service.view' } }, async (req) => {
    const job = await prisma.serviceJob.findFirst({
      where: { id: req.params.id, ...mine(actorOf(req)) },
      include: INCLUDE,
    });
    // Somebody else's repair is, to a mechanic, no repair at all.
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    return { job: present(req, serialize(job)) };
  });

  /**
   * The repair may start (ADR-0033, stage 3): the chief mechanic or an owner
   * approves what waits — a whole repair the first time, or the works found
   * once it had started, which wait on their own while the rest goes on (Mika,
   * 20.10.2026). The norm of a work not in the book may be given in the same
   * breath; the repair says who let it start and when, each line who approved
   * it.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/service/:id/approve', { config: { scope: 'service.approve' } }, async (req) => {
    const actor = actorOf(req);
    const norms = readNorms((req.body ?? {}).norms);
    if (norms.length > 0 && !hasPerm(actor, 'service.norms')) throw forbidden('forbidden', 'Norms are kept by the chief mechanic and the owners.', { permission: 'service.norms' });
    const job = await prisma.serviceJob.findUnique({
      where: { id: req.params.id },
      select: { id: true, number: true, status: true, approvedAt: true, works: { select: { id: true, workTypeId: true, normSec: true, approvedAt: true, rejectedAt: true } } },
    });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    if (job.status !== 'draft') throw conflict('job_not_waiting', 'This repair is not waiting for approval.', { status: job.status });
    for (const n of norms) {
      const line = job.works.find((w) => w.id === n.workId);
      if (!line) throw notFound('work_line_not_found', 'No such work on this repair.');
      if (line.workTypeId) throw conflict('norm_from_book', 'A work from the book keeps the norm it was written with.');
    }
    const waiting = job.works.filter((w) => workLineState(w) === 'waiting');
    const now = new Date();
    const first = job.approvedAt == null;
    await prisma.$transaction(async (tx) => {
      for (const n of norms) await tx.serviceWork.update({ where: { id: n.workId }, data: { normSec: n.normSec } });
      await tx.serviceWork.updateMany({ where: { id: { in: waiting.map((w) => w.id) } }, data: { approvedById: actor.id, approvedAt: now } });
      await tx.serviceJob.update({
        where: { id: job.id },
        data: { status: 'open', ...(first ? { approvedById: actor.id, approvedAt: now } : {}), updatedAt: now },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'service.approve',
          entityType: 'service_job',
          entityId: job.id,
          after: { number: job.number, status: 'open', works: waiting.length, again: !first, norms: norms.length > 0 ? norms : undefined },
        },
      });
    });
    return { ok: true, works: waiting.length };
  });

  /**
   * Refused, with the reason the mechanic will read (Mika, 20.10.2026; register
   * #109). The first time, the whole repair: it is cancelled as refused, the
   * moped goes back to the fleet if it took it, the shelf gets its parts back,
   * nobody is paid. Later, only the works that wait: they stay on the repair,
   * struck through, and the work already approved goes on.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/service/:id/reject', { config: { scope: 'service.approve' } }, async (req) => {
    const actor = actorOf(req);
    const reason = str(req.body ?? {}, 'reason', { required: true, max: 1000 })!;
    const job = await prisma.serviceJob.findUnique({
      where: { id: req.params.id },
      select: { id: true, number: true, status: true, approvedAt: true, movedVehicle: true, vehicleId: true, works: { select: { id: true, approvedAt: true, rejectedAt: true } } },
    });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    if (job.status !== 'draft') throw conflict('job_not_waiting', 'This repair is not waiting for approval.', { status: job.status });
    const now = new Date();
    const today = todayISO(now, env.TZ);
    if (job.approvedAt == null) {
      let back = 0;
      await prisma.$transaction(async (tx) => {
        back = await returnServiceParts(tx, { jobId: job.id, occurredOn: today, actorId: actor.id, reason: `${job.number}: ${reason}`.slice(0, 1000) });
        await tx.serviceJob.update({
          where: { id: job.id },
          data: { status: 'cancelled', closedOn: dateFromISO(today)!, closedAt: now, rejectedById: actor.id, rejectedAt: now, rejectReason: reason, updatedAt: now },
        });
        if (job.movedVehicle) await moveVehicle(tx, { vehicleId: job.vehicleId, kind: 'service_out', occurredOn: today, actorId: actor.id, reason });
        await tx.auditLog.create({
          data: { actorId: actor.id, action: 'service.reject', entityType: 'service_job', entityId: job.id, after: { number: job.number, status: 'cancelled', partsBack: back }, note: reason },
        });
      });
      return { ok: true, status: 'cancelled', partsBack: back };
    }
    const waiting = job.works.filter((w) => workLineState(w) === 'waiting').map((w) => w.id);
    await prisma.$transaction(async (tx) => {
      await tx.serviceWork.updateMany({ where: { id: { in: waiting } }, data: { rejectedById: actor.id, rejectedAt: now, rejectReason: reason } });
      await tx.serviceJob.update({ where: { id: job.id }, data: { status: 'open', updatedAt: now } });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'service.reject', entityType: 'service_job', entityId: job.id, after: { number: job.number, status: 'open', works: waiting.length }, note: reason },
      });
    });
    return { ok: true, status: 'open', works: waiting.length };
  });

  /**
   * A work found once the repair is open (spec, «нашлась ещё работа»): the
   * mechanic adds it from the book or in words, and it waits for approval on
   * its own — the repair goes back to waiting, and nothing else on it changes
   * (Mika, 20.10.2026; register #108). Added by whoever may approve, it is
   * approved as it is written. The norm and the rate are the repair's
   * mechanic's, copied now, as on the lines he opened it with.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/service/:id/works', { config: { scope: 'service.work' } }, async (req, reply) => {
    const actor = actorOf(req);
    const lines = readWorkLines((req.body ?? {}).works);
    if (lines.length === 0) throw badRequest('missing_field', 'Say what work: one line at least.', { field: 'works' });
    const job = await prisma.serviceJob.findFirst({
      where: { id: req.params.id, ...mine(actor) },
      select: { id: true, number: true, status: true, mechanicId: true, mechanic: { select: { labourRateTetri: true } } },
    });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    if (job.status !== 'open' && job.status !== 'draft') throw conflict('job_closed', 'A closed job is a record; it is not edited.');
    // A repair with no mechanic is an owner's, kept with the old line of hours.
    if (!job.mechanicId) throw conflict('job_no_mechanic', 'This repair has no mechanic to do the work.');
    const types = await bookWorks(lines);
    const rateTetri = job.mechanic?.labourRateTetri ?? LABOUR_RATE_TETRI;
    const approvedNow = job.status === 'open' && hasPerm(actor, 'service.approve');
    const now = new Date();
    const status = approvedNow ? job.status : 'draft';
    await prisma.$transaction(async (tx) => {
      for (const l of lines) {
        const w = l.workTypeId ? types.find((x) => x.id === l.workTypeId)! : null;
        await tx.serviceWork.create({
          data: {
            jobId: job.id,
            workTypeId: w?.id ?? null,
            freeText: w ? null : l.freeText,
            qty: l.qty,
            normSec: w?.normSec ?? null,
            rateTetri,
            mechanicId: job.mechanicId,
            createdById: actor.id,
            ...(approvedNow ? { approvedById: actor.id, approvedAt: now } : {}),
          },
        });
      }
      if (status !== job.status) await tx.serviceJob.update({ where: { id: job.id }, data: { status, updatedAt: now } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'service.work.add',
          entityType: 'service_job',
          entityId: job.id,
          after: { number: job.number, works: lines.map((l) => ({ code: types.find((x) => x.id === l.workTypeId)?.code ?? null, freeText: l.workTypeId ? null : l.freeText, qty: l.qty })), waits: !approvedNow },
        },
      });
    });
    return reply.code(201).send({ ok: true, status });
  });

  /**
   * The norm of a work not in the book (spec: «норму вписывает главный механик
   * или владелец»): at approval or later, a closed repair included — until it
   * is paid, which is stage 5. A work from the book keeps the norm it was
   * written with.
   */
  app.patch<{ Params: { id: string; workId: string }; Body: Body }>('/api/service/:id/works/:workId', { config: { scope: 'service.norms' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const normSec = normSecFromMinutes(b.normMin as string | number | null | undefined);
    if (normSec == null) throw badRequest('bad_field', 'A norm is minutes above zero.', { field: 'normMin' });
    const line = await prisma.serviceWork.findUnique({ where: { id: req.params.workId }, include: { job: { select: { id: true, number: true, status: true } } } });
    if (!line || line.jobId !== req.params.id) throw notFound('work_line_not_found', 'No such work on this repair.');
    if (line.workTypeId) throw conflict('norm_from_book', 'A work from the book keeps the norm it was written with.');
    if (line.job.status === 'cancelled') throw conflict('job_closed', 'A cancelled repair is a record; it is not edited.');
    await prisma.serviceWork.update({ where: { id: line.id }, data: { normSec } });
    await audit({ actorId: actor.id, action: 'service.work.norm', entityType: 'service_job', entityId: line.jobId, before: { workId: line.id, normSec: line.normSec }, after: { number: line.job.number, workId: line.id, normSec } });
    return { ok: true, normSec };
  });

  /**
   * Photos after the repair, taken before it is closed — on a repair the
   * owner closes, because the customer pays for it, the mechanic leaves them
   * here (stage 3). Five at most.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/service/:id/photos/after', { config: { scope: 'service.work' }, bodyLimit: JOB_BODY_LIMIT }, async (req, reply) => {
    const actor = actorOf(req);
    const photos = jobPhotos((req.body ?? {}).photos, 'photos');
    if (photos.length === 0) throw badRequest('missing_field', 'At least one photo.', { field: 'photos' });
    const job = await prisma.serviceJob.findFirst({ where: { id: req.params.id, ...mine(actor) }, select: { id: true, status: true } });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    if (job.status !== 'open' && job.status !== 'draft') throw conflict('job_closed', 'A closed job is a record; it is not edited.');
    const had = await prisma.storedFile.count({ where: { serviceJobId: job.id, tag: 'after', archived: false } });
    if (had + photos.length > AFTER_PHOTOS_MAX) throw badRequest('bad_field', `Up to ${AFTER_PHOTOS_MAX} photos after the repair.`, { field: 'photos', max: AFTER_PHOTOS_MAX - had });
    await prisma.$transaction(async (tx) => {
      await writeAfterPhotos(tx, job.id, photos, had, actor.id);
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'service.photo.add', entityType: 'service_job', entityId: job.id, after: { tag: 'after', photos: photos.length } } });
    });
    return reply.code(201).send({ ok: true, photos: had + photos.length });
  });

  /** Where a moped may be left when its repair closes: the points the owner keeps (stage 3). */
  app.get('/api/service/locations', { config: { scope: 'service.work' } }, async () => {
    const locations = await prisma.location.findMany({ where: { archived: false }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, kind: true } });
    return { locations };
  });

  /**
   * The moped a mechanic is about to repair, found the way he finds it: by
   * the last characters of the VIN, or by the number on the sticker (EV-014,
   * or 14). What he is told is the repair's business only — the model, the
   * colour, whether it stands in the yard or is out on a rental, the last
   * odometer reading — and whether a repair is already open on it, so he
   * carries that one on instead of being refused a second (code check, §3).
   * No customer: a mechanic does not see the fleet (ADR-0033 §2).
   */
  app.get<{ Querystring: { q?: string } }>('/api/service/vehicles', { config: { scope: 'service.work' } }, async (req) => {
    const raw = (req.query.q ?? '').trim();
    // «8» is EV-008: a sticker's number may be one digit, a VIN's tail is two characters at least.
    const q = readQuery(raw);
    const number = readFleetNumber(raw, { digitsToo: true });
    if (!q && number == null) return { vehicles: [] };
    const all = await prisma.vehicle.findMany({
      where: { archived: false, state: { notIn: ['sold', 'out'] } },
      select: {
        id: true,
        vin: true,
        fleetNo: true,
        color: true,
        state: true,
        odometerKm: true,
        model: { select: { brand: true, name: true } },
        serviceJobs: {
          where: { status: { in: ['open', 'draft'] } },
          select: { id: true, number: true, status: true, reason: true, mechanicId: true, mechanic: { select: { name: true } } },
          take: 1,
        },
      },
    });
    const actor = actorOf(req);
    const found = all
      .filter((v) => (number != null && v.fleetNo === number) || (q != null && vinMatches(q, v.vin)))
      // The sticker's number first: «14» is EV-014 before it is a VIN ending in 14.
      .sort((a, b) => Number(b.fleetNo === number) - Number(a.fleetNo === number) || (a.fleetNo ?? 0) - (b.fleetNo ?? 0))
      .slice(0, 8);
    return {
      vehicles: found.map((v) => {
        const job = v.serviceJobs[0] ?? null;
        return {
          id: v.id,
          vin: v.vin,
          number: fleetNumber(v.fleetNo),
          model: `${v.model.brand} ${v.model.name}`,
          color: v.color,
          state: v.state,
          odometerKm: v.odometerKm,
          openJob: job
            ? {
                id: job.id,
                number: job.number,
                status: job.status,
                reason: job.reason,
                mechanic: job.mechanic?.name ?? null,
                /** Nobody carries it yet — a manager's breakdown, a return's damage: he may take it on. */
                takeable: job.mechanicId == null,
                /** He carries it already: the screen opens it rather than writing it twice. */
                mine: job.mechanicId === actor.id,
              }
            : null,
        };
      }),
    };
  });

  /**
   * A repair opened from the workshop (stage 2 of the mechanic plan): the
   * moped, what the odometer reads and its photo, why it came in, photos of
   * the damage and the works planned from the book — all in one body, so a
   * repair without its mileage or its photos is never written, not even half
   * (the spec: «без фото заявка не отправляется»). A mechanic's repair waits
   * for the chief mechanic's approval, which is the same waiting a manager's
   * reported breakdown does (`draft`, ADR-0033); one opened by whoever may
   * approve is in work at once. A moped already under repair is not given a
   * second job: `jobId` takes the open one on, if nobody carries it yet.
   */
  app.post<{ Body: Body }>('/api/service/workshop', { config: { scope: 'service.work' }, bodyLimit: JOB_BODY_LIMIT }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const vehicleId = str(b, 'vehicleId', { required: true })!;
    const jobId = str(b, 'jobId');
    const reasonKind = oneOf(b, 'reasonKind', SERVICE_REASONS, { required: true })!;
    const reason = str(b, 'reason', { required: true, max: 2000 })!;
    const odometerKm = int(b, 'odometerKm', { required: true, min: 0, max: 1_000_000 })!;
    const odometerReason = str(b, 'odometerReason', { max: 500 });
    const odometerPhoto = jobPhoto(b.odometerPhoto, 'odometerPhoto');
    if (!odometerPhoto) throw badRequest('missing_field', 'A photo of the odometer goes with the mileage.', { field: 'odometerPhoto' });
    const photoList = Array.isArray(b.photos) ? b.photos : [];
    const photos = photoList.map((p) => jobPhoto(p, 'photos')).filter((p): p is NonNullable<typeof p> => p != null);
    if (photos.length === 0) throw badRequest('missing_field', 'At least one photo of the damage.', { field: 'photos' });
    if (photos.length > JOB_PHOTOS_MAX) throw badRequest('bad_field', `Up to ${JOB_PHOTOS_MAX} photos of the damage.`, { field: 'photos', max: JOB_PHOTOS_MAX });
    const lines = readWorkLines(b.works);
    if (lines.length === 0) throw badRequest('missing_field', 'Say what work is planned: one line at least.', { field: 'works' });

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, include: { currentRental: { select: { id: true } } } });
    if (!vehicle) throw notFound('vehicle_not_found', 'No such moped.');
    if (vehicle.state === 'sold' || vehicle.state === 'out') throw conflict('vehicle_gone', 'This moped is no longer in the fleet.', { state: vehicle.state });
    // Less than the last reading is allowed — an odometer gets replaced — but
    // not without the reason, which the chief mechanic reads at approval.
    if (vehicle.odometerKm != null && odometerKm < vehicle.odometerKm && !odometerReason) {
      throw badRequest('odometer_below', 'The mileage is below the last recorded one; say why.', { field: 'odometerReason', lastKm: vehicle.odometerKm });
    }
    const types = await bookWorks(lines);
    const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { labourRateTetri: true } });
    const rateTetri = me.labourRateTetri ?? LABOUR_RATE_TETRI;

    const open = await prisma.serviceJob.findFirst({
      where: { vehicleId, status: { in: ['open', 'draft'] } },
      select: { id: true, number: true, status: true, reason: true, mechanicId: true, mechanic: { select: { name: true } } },
    });
    if (jobId) {
      if (!open || open.id !== jobId) throw conflict('job_closed', 'That repair is no longer open on this moped.');
      // His own is opened, not taken again: a second pass would write its works and photos twice.
      if (open.mechanicId === actor.id) throw conflict('job_already_open', 'This repair is already yours.', { job: { id: open.id, number: open.number } });
      if (open.mechanicId) throw conflict('job_has_mechanic', 'Another mechanic carries this repair.', { mechanic: open.mechanic?.name ?? null });
    } else if (open) {
      throw conflict('job_already_open', 'This moped already has an open repair job.', { job: { id: open.id, number: open.number } });
    }

    const rented = vehicle.state === 'rented' && vehicle.currentRental != null;
    const approver = hasPerm(actor, 'service.approve');
    const today = todayISO(new Date(), env.TZ);
    const job = await prisma.$transaction(async (tx) => {
      let made: { id: string; number: string; status: string };
      if (open) {
        made = await tx.serviceJob.update({
          where: { id: open.id },
          data: { mechanicId: actor.id, reasonKind, reason, openedOdometerKm: odometerKm, odometerReason, updatedAt: new Date() },
          select: { id: true, number: true, status: true },
        });
      } else {
        made = await tx.serviceJob.create({
          data: {
            vehicleId,
            rentalId: rented ? vehicle.currentRental!.id : null,
            reason,
            reasonKind,
            openedOn: dateFromISO(today)!,
            openedOdometerKm: odometerKm,
            odometerReason,
            status: approver ? 'open' : 'draft',
            payer: 'company',
            mechanicId: actor.id,
            movedVehicle: !rented,
            createdById: actor.id,
            // Whoever may approve opens it in work: the approval is theirs, now (stage 3).
            ...(approver ? { approvedById: actor.id, approvedAt: new Date() } : {}),
          },
          select: { id: true, number: true, status: true },
        });
        if (!rented) await moveVehicle(tx, { vehicleId, kind: 'service_in', occurredOn: today, actorId: actor.id, reason });
      }
      await tx.vehicle.update({ where: { id: vehicleId }, data: { odometerKm, updatedAt: new Date() } });
      const files = [
        { ...odometerPhoto, tag: 'odometer', label: 'odometer' },
        ...photos.map((p, i) => ({ ...p, tag: 'before', label: `before-${i + 1}` })),
      ];
      for (const f of files) {
        await tx.storedFile.create({
          data: {
            kind: 'service_photo',
            serviceJobId: made.id,
            tag: f.tag,
            label: f.label,
            mimeType: f.mime,
            sizeBytes: f.bytes.length,
            sha256: createHash('sha256').update(f.bytes).digest('hex'),
            bytes: new Uint8Array(f.bytes),
            uploadedById: actor.id,
          },
        });
      }
      for (const l of lines) {
        const w = l.workTypeId ? types.find((x) => x.id === l.workTypeId)! : null;
        // The norm and the rate are copied now and never read again (stage 2):
        // a norm changed in the book tomorrow does not change today's work.
        await tx.serviceWork.create({
          data: {
            jobId: made.id,
            workTypeId: w?.id ?? null,
            freeText: w ? null : l.freeText,
            qty: l.qty,
            normSec: w?.normSec ?? null,
            rateTetri,
            mechanicId: actor.id,
            createdById: actor.id,
            ...(made.status === 'open' ? { approvedById: actor.id, approvedAt: new Date() } : {}),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: open ? 'service.take' : made.status === 'draft' ? 'service.request' : 'service.open',
          entityType: 'service_job',
          entityId: made.id,
          after: {
            number: made.number,
            vehicleId,
            reasonKind,
            reason,
            odometerKm,
            odometerReason,
            photos: files.length,
            works: lines.map((l) => ({ code: types.find((x) => x.id === l.workTypeId)?.code ?? null, freeText: l.workTypeId ? null : l.freeText, qty: l.qty })),
            movedVehicle: open ? undefined : !rented,
          },
          before: open ? { reason: open.reason, mechanicId: open.mechanicId } : undefined,
        },
      });
      return made;
    });
    return reply.code(open ? 200 : 201).send(job);
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
      const part = await prisma.servicePart.findUnique({ where: { id: req.params.partId }, include: { job: { select: { id: true, status: true, number: true } } } });
      if (!part || part.job.id !== req.params.id) throw notFound('part_not_found', 'No such part on this job.');
      if (part.job.status !== 'open') throw conflict('job_closed', 'A closed job is a record; it is not edited.');
      // Taking the line off the job puts the parts back on the shelf — as a
      // movement of its own, not by rubbing out the one that issued them
      // (QA-W5-18). In "Движения" of that part both are visible: that they
      // were taken, and that they came back.
      await prisma.$transaction(async (tx) => {
        await returnServicePart(tx, {
          servicePartId: part.id,
          occurredOn: todayISO(new Date(), env.TZ),
          actorId: actor.id,
          reason: `возврат из ремонта ${part.job.number}`,
        });
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
   *
   * Since stage 3 the mechanic closes his own repair, and a repair a mechanic
   * carries closes only with a photo after it — one at least, five at most,
   * sent with the closing or left on the repair before. What a repair at the
   * customer's expense leaves in the deposit is the owner's to decide, so that
   * one the owner closes (Mika, 20.10.2026). An owner's repair with no
   * mechanic — the partner workshop's, on the old form — closes as before.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/service/:id/close', { config: { scope: 'service.work' }, bodyLimit: JOB_BODY_LIMIT }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const owner = hasPerm(actor, 'service.manage');
    const job = await prisma.serviceJob.findFirst({ where: { id: req.params.id, ...(owner ? {} : mine(actor)) }, include: { parts: true } });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    if (job.status === 'draft') throw conflict('job_waits_approval', 'This repair waits for approval; it closes after.');
    if (job.status !== 'open') throw conflict('job_closed', 'This job is already closed.');
    // An owner's repair with no mechanic is the owners' alone, as it always was.
    if (!owner && !job.mechanicId) throw forbidden('forbidden', 'This repair is the owners’ to close.', { permission: 'service.manage' });
    if (!owner && job.payer === 'customer') throw conflict('close_is_owners', 'The customer pays for this repair: an owner closes it and decides on the deposit.');

    // A mechanic closes it today; an owner may say the day it was finished.
    const today = todayISO(new Date(), env.TZ);
    const closedOn = owner ? (date(b, 'closedOn') ?? today) : today;
    if (closedOn < isoDate(job.openedOn)!) throw conflict('closed_before_opened', 'A job cannot close before it was opened.');
    const withheldTetri = tetri(b, 'withheldTetri', { min: 0 }) ?? 0;
    const total = totalOf(job);
    // Two things are asked of every closing (B5-06, crit. 26): what the
    // odometer read, and where the moped stands now.
    const odometerKm = int(b, 'odometerKm', { min: 0, max: 1_000_000 });
    const closedLocationId = str(b, 'locationId');
    if (job.movedVehicle) {
      if (odometerKm == null) throw badRequest('missing_field', 'Say what the odometer reads.', { field: 'odometerKm' });
      if (!closedLocationId) throw badRequest('missing_field', 'Say where the moped stands now.', { field: 'locationId' });
    }
    if (closedLocationId && !(await prisma.location.findFirst({ where: { id: closedLocationId, archived: false }, select: { id: true } }))) {
      throw notFound('location_not_found', 'No such point.');
    }
    const photos = jobPhotos(b.photos, 'photos');
    const had = await prisma.storedFile.count({ where: { serviceJobId: job.id, tag: 'after', archived: false } });
    if (had + photos.length > AFTER_PHOTOS_MAX) throw badRequest('bad_field', `Up to ${AFTER_PHOTOS_MAX} photos after the repair.`, { field: 'photos', max: AFTER_PHOTOS_MAX - had });
    if (job.mechanicId && had + photos.length === 0) throw badRequest('after_photo_missing', 'A photo after the repair goes with closing it.', { field: 'photos' });

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
      await writeAfterPhotos(tx, job.id, photos, had, actor.id);
      // What the deposit did not cover is the customer's debt, as one line
      // named after the job (Q26, crit. 25).
      const charge = job.payer === 'customer' ? closeCharge({ totalTetri: total, withholdTetri: withheldTetri, depositFreeTetri: total }) : { withheldTetri: 0, debtTetri: 0 };
      await tx.serviceJob.update({
        where: { id: job.id },
        data: {
          status: 'done',
          closedOn: dateFromISO(closedOn)!,
          closedAt: new Date(),
          withheldTetri,
          chargedTetri: charge.debtTetri,
          odometerKm: odometerKm ?? job.odometerKm,
          closedLocationId: closedLocationId ?? job.closedLocationId,
          notes: owner && 'notes' in b ? str(b, 'notes', { max: 4000 }) : job.notes,
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
          after: { closedOn, totalTetri: total, withheldTetri, payer: job.payer, odometerKm, locationId: closedLocationId, photosAfter: had + photos.length },
        },
      });
    });
    // What it came to is the owners' to read (ADR-0033 §4); the mechanic is told it is closed.
    return mayView(req, 'cost.view') ? { ok: true, totalTetri: total, withheldTetri } : { ok: true };
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
      await tx.serviceJob.update({ where: { id: job.id }, data: { status: 'cancelled', closedOn: dateFromISO(today)!, closedAt: new Date(), updatedAt: new Date() } });
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
