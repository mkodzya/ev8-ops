import {
  AFTER_PHOTOS_MAX,
  JOB_PHOTOS_MAX,
  LABOUR_RATE_TETRI,
  SERVICE_PART_KINDS,
  SERVICE_REASONS,
  WORK_QTY_MAX,
  approvedWorksTetri,
  closeCharge,
  fleetNumber,
  jobPayState,
  labourTetri as labourFor,
  minutesFromHours,
  normSecFromMinutes,
  partLineState,
  partLineTetri,
  partPriceTetri,
  partsTetri,
  readFleetNumber,
  readImei,
  readQuery,
  readSimPhone,
  repairTotalTetri,
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
import { WORK_MONEY, issueForServicePart, partRows, passThrough, receiveRemoved, returnServiceParts, returnServicePart } from '../lib/stock.js';
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
    // A bought line is priced by its receipt and one taken off onto the shelf
    // costs the repair nothing (ADR-0036): neither follows the payer.
    where: { jobId, partId: { not: null }, kind: { in: ['stock', 'donor'] } },
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

/** A paid repair is a record: nothing on it changes any more (ADR-0037 §5). */
function refusePaid(job: { paidInPayoutId: string | null }): void {
  if (job.paidInPayoutId != null) throw conflict('job_paid', 'This repair is paid to its mechanic; it is not changed any more.');
}

/** A tracker as a repair or a moped shows it. */
function trackerOut(t: { id: string; imei: string; simPhone: string | null; installedOn: Date; removedOn?: Date | null }) {
  return { id: t.id, imei: t.imei as string | null, simPhone: t.simPhone, installedOn: isoDate(t.installedOn), removedOn: isoDate(t.removedOn ?? null) };
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
  paidInPayoutId: string | null;
  paidInPayout: { id: string; paidOn: Date; markedBy: { id: string; name: string } } | null;
  approvedAt: Date | null;
  approvedBy: { id: string; name: string } | null;
  rejectedAt: Date | null;
  rejectedBy: { id: string; name: string } | null;
  rejectReason: string | null;
  notes: string | null;
  movedVehicle: boolean;
  withheldTetri: number;
  vehicle: {
    id: string;
    vin: string;
    fleetNo: number | null;
    model: { brand: string; name: string };
    trackers: { id: string; imei: string; simPhone: string | null; installedOn: Date; partId: string | null }[];
  };
  rental: { id: string; number: string } | null;
  customer: { id: string; name: string } | null;
  parts: {
    id: string;
    name: string;
    qty: number;
    unitPriceTetri: number;
    unitCostTetri: number | null;
    partId: string | null;
    kind: string;
    paidTetri: number | null;
    receiptPhotoId: string | null;
    createdAt: Date;
    approvedAt: Date | null;
    rejectedAt: Date | null;
    rejectReason: string | null;
    donor: { id: string; vin: string; fleetNo: number | null } | null;
    reimburseTo: { id: string; name: string } | null;
    paidInPayoutId: string | null;
    part: { isTracker: boolean } | null;
    trackers: { imei: string; simPhone: string | null }[];
  }[];
  batteryMoves: { id: string; item: string; kind: string; qty: number; occurredOn: Date }[];
  trackersFitted: { id: string; imei: string; simPhone: string | null; installedOn: Date; removedOn: Date | null }[];
  trackersRemoved: { id: string; imei: string; simPhone: string | null; installedOn: Date; removedOn: Date | null }[];
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
    partsTetri: partsTetri(job.parts) as number | null,
    totalTetri: repairTotalTetri(job) as number | null,
    /** The mechanic's approved work as the company's repair cost carries it, rounded once (ADR-0037 §6, §8); nought on a customer's or a called-off one. */
    worksCostTetri: (job.payer === 'company' && job.status !== 'cancelled' ? approvedWorksTetri(job.works) : 0) as number | null,
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
    /** The payout that paid its mechanic: the status stays «closed», the screen says «paid» (ADR-0037 §1). */
    paid: job.paidInPayout
      ? { payoutId: job.paidInPayout.id, paidOn: isoDate(job.paidInPayout.paidOn) as string, markedBy: { id: job.paidInPayout.markedBy.id, name: job.paidInPayout.markedBy.name } }
      : null,
    /** Where it stands for paying its mechanic: payable, paid, unnormed, waiting, open or cancelled (ADR-0037 §2). */
    payState: jobPayState(job),
    notes: job.notes,
    movedVehicle: job.movedVehicle,
    vehicle: {
      id: job.vehicle.id,
      vin: job.vehicle.vin,
      number: fleetNumber(job.vehicle.fleetNo),
      model: `${job.vehicle.model.brand} ${job.vehicle.model.name}`,
      /** The tracker on the moped now, if any (ADR-0036): what «снять трекер» takes off. */
      tracker: job.vehicle.trackers[0] ? trackerOut(job.vehicle.trackers[0]) : null,
    },
    rental: job.rental,
    customer: job.customer as { id: string; name: string } | null,
    parts: job.parts.map((p) => ({
      id: p.id,
      name: p.name,
      qty: p.qty,
      partId: p.partId,
      /** Off the shelf, bought, taken off onto the shelf, off a donor (ADR-0036). */
      kind: p.kind,
      unitPriceTetri: p.unitPriceTetri as number | null,
      unitCostTetri: p.unitCostTetri,
      /** What the line adds to the repair: the receipt for a bought one, nothing for one taken off. */
      lineTetri: partLineTetri(p) as number | null,
      /** Bought: what the mechanic paid, and to whom it goes back. */
      paidTetri: p.paidTetri,
      reimburseTo: p.reimburseTo,
      /** Bought: paid back to that person in a payout of his (ADR-0037). */
      reimbursed: p.paidInPayoutId != null,
      receiptPhotoId: p.receiptPhotoId,
      /** Bought only: waiting, approved or refused; nothing for the rest. */
      state: partLineState(p),
      rejectReason: p.rejectReason,
      donor: p.donor ? { id: p.donor.id, number: fleetNumber(p.donor.fleetNo), vin: p.donor.vin } : null,
      isTracker: p.part?.isTracker ?? false,
      tracker: p.trackers[0] ? { imei: p.trackers[0].imei as string | null, simPhone: p.trackers[0].simPhone } : null,
      addedAt: p.createdAt.toISOString(),
    })),
    /** Batteries and chargers this repair took to repair or brought back: their own count (ADR-0025, ADR-0036). */
    batteries: job.batteryMoves.map((m) => ({ id: m.id, item: m.item, kind: m.kind, qty: m.qty, occurredOn: isoDate(m.occurredOn) })),
    trackers: {
      fitted: job.trackersFitted.map(trackerOut),
      removed: job.trackersRemoved.map(trackerOut),
    },
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
        worksCostTetri: null,
        withheldTetri: null,
        chargedTetri: null,
        // A mechanic sees what he paid for a part himself — it is his money
        // coming back — and the chief mechanic sees it to approve it; neither
        // sees what the shelf paid (ADR-0033 §4, ADR-0036).
        parts: job.parts.map((p) => ({ ...p, unitPriceTetri: null, unitCostTetri: null, lineTetri: null, paidTetri: mayView(req, 'service.work') ? p.paidTetri : null })),
      };
  // The IMEI and the SIM say which tracker to look for when a moped is
  // stolen: the owners' and the workshop's, not a manager's (ADR-0036).
  const tracked = mayView(req, 'service.work') || mayView(req, 'service.manage') ? out : hideTrackers(out);
  return mayView(req, 'fleet.view') ? tracked : { ...tracked, customer: null };
}

function hideTrackers(job: Job): Job {
  const blank = <T extends { imei: string | null; simPhone: string | null }>(t: T): T => ({ ...t, imei: null, simPhone: null });
  return {
    ...job,
    vehicle: { ...job.vehicle, tracker: job.vehicle.tracker ? blank(job.vehicle.tracker) : null },
    parts: job.parts.map((p) => ({ ...p, tracker: p.tracker ? blank(p.tracker) : null })),
    trackers: { fitted: job.trackers.fitted.map(blank), removed: job.trackers.removed.map(blank) },
  };
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
  vehicle: {
    include: {
      model: { select: { brand: true, name: true } },
      trackers: { where: { removedOn: null }, select: { id: true, imei: true, simPhone: true, installedOn: true, partId: true }, take: 1 },
    },
  },
  rental: { select: { id: true, number: true } },
  customer: { select: { id: true, name: true, nameKa: true, nameLat: true } },
  workshop: { select: { id: true, name: true } },
  closedLocation: { select: { id: true, name: true } },
  parts: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      donor: { select: { id: true, vin: true, fleetNo: true } },
      reimburseTo: { select: { id: true, name: true } },
      part: { select: { isTracker: true } },
      trackers: { select: { imei: true, simPhone: true }, take: 1 },
    },
  },
  batteryMoves: { orderBy: { createdAt: 'asc' as const }, select: { id: true, item: true, kind: true, qty: true, occurredOn: true } },
  trackersFitted: { orderBy: { createdAt: 'asc' as const }, select: { id: true, imei: true, simPhone: true, installedOn: true, removedOn: true } },
  trackersRemoved: { orderBy: { createdAt: 'asc' as const }, select: { id: true, imei: true, simPhone: true, installedOn: true, removedOn: true } },
  mechanic: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  rejectedBy: { select: { id: true, name: true } },
  paidInPayout: { select: { id: true, paidOn: true, markedBy: { select: { id: true, name: true } } } },
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

/**
 * The repair a line is written into (stage 4): the owner's in work, as it always
 * was; a mechanic's own — or any, to the chief mechanic — while it waits for
 * approval or is in work. A repair with no mechanic is the owners' alone.
 */
async function writableJob(actor: Actor, id: string) {
  const owner = hasPerm(actor, 'service.manage');
  const job = await prisma.serviceJob.findFirst({
    where: { id, ...(owner ? {} : mine(actor)) },
    select: { id: true, number: true, status: true, openedOn: true, payer: true, mechanicId: true, approvedAt: true, paidInPayoutId: true, vehicleId: true, vehicle: { select: { fleetNo: true, vin: true } } },
  });
  if (!job) throw notFound('job_not_found', 'No such repair job.');
  // A paid repair is closed as well; said first, it says why (ADR-0037 §5).
  refusePaid(job);
  const writable = job.status === 'open' || (job.status === 'draft' && job.mechanicId != null);
  if (!writable) throw conflict('job_closed', 'A closed job is a record; it is not edited.');
  if (!owner && !job.mechanicId) throw forbidden('forbidden', 'This repair is the owners’.', { permission: 'service.manage' });
  return job;
}

/**
 * What a part off the shelf goes on the line at, and what the shelf paid for
 * it (B8-04): the shelf's average; with nothing on the shelf, the last price a
 * shipment or a receipt paid — a figure somebody paid, not a guess. A part
 * nobody ever paid for has no cost, and the line says so by an empty one.
 */
async function shelfPrice(partId: string, payer: Payer): Promise<{ unitPriceTetri: number | null; unitCostTetri: number | null }> {
  const row = (await partRows({ includeArchived: true })).find((r) => r.id === partId) ?? null;
  let cost = row?.avgCostTetri ?? null;
  if (cost == null) {
    const last = await prisma.stockMove.findFirst({
      where: { partId, kind: 'receipt', servicePartId: null, unitCostTetri: { gt: 0 } },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
      select: { unitCostTetri: true },
    });
    cost = last?.unitCostTetri ?? null;
  }
  const part = await prisma.part.findUnique({ where: { id: partId }, select: { salePriceTetri: true } });
  return { unitPriceTetri: partPriceTetri(payer, { avgCostTetri: cost, salePriceTetri: part?.salePriceTetri ?? null }), unitCostTetri: cost };
}

/** The IMEI and the SIM of a tracker being fitted — one tracker, one line (ADR-0036). */
function readTracker(b: Body, qty: number): { imei: string; simPhone: string } {
  if (qty !== 1) throw badRequest('bad_field', 'A tracker is fitted one at a time: its IMEI is its own.', { field: 'qty' });
  const imei = readImei(str(b, 'imei', { required: true, max: 40 }));
  if (!imei) throw badRequest('imei_bad', 'An IMEI is fifteen digits off the sticker; the last one checks the rest.', { field: 'imei' });
  const simPhone = readSimPhone(str(b, 'sim', { required: true, max: 40 }));
  if (!simPhone) throw badRequest('sim_bad', 'A SIM number is its digits.', { field: 'sim' });
  return { imei, simPhone };
}

/**
 * A tracker goes onto the moped (ADR-0036). One at a time on a moped, and an
 * IMEI on one moped at a time — the database refuses the second open row of
 * an IMEI whatever this says. Off a donor, the tracker moves with the part:
 * closed on the donor, opened here.
 */
async function fitTracker(
  tx: Tx,
  input: { job: { id: string; vehicleId: string }; partId: string; servicePartId: string; donorVehicleId: string | null; imei: string; simPhone: string; on: string; actorId: string },
): Promise<void> {
  const onMoped = await tx.vehicleTracker.findFirst({ where: { vehicleId: input.job.vehicleId, removedOn: null }, select: { imei: true } });
  if (onMoped) throw conflict('tracker_on_vehicle', 'This moped has a tracker; take that one off first.', { imei: `···${onMoped.imei.slice(-4)}` });
  const elsewhere = await tx.vehicleTracker.findFirst({
    where: { imei: input.imei, removedOn: null },
    select: { id: true, vehicleId: true, installedOn: true, vehicle: { select: { fleetNo: true, vin: true } } },
  });
  if (elsewhere) {
    if (input.donorVehicleId == null || elsewhere.vehicleId !== input.donorVehicleId) {
      throw conflict('tracker_imei_in_use', 'This IMEI is on another moped; take it off there first.', {
        vehicle: fleetNumber(elsewhere.vehicle.fleetNo) ?? `···${elsewhere.vehicle.vin.slice(-6)}`,
        since: isoDate(elsewhere.installedOn),
      });
    }
    await tx.vehicleTracker.update({ where: { id: elsewhere.id }, data: { removedOn: dateFromISO(input.on)!, removedJobId: input.job.id, removedById: input.actorId } });
  }
  try {
    await tx.vehicleTracker.create({
      data: {
        vehicleId: input.job.vehicleId,
        partId: input.partId,
        imei: input.imei,
        simPhone: input.simPhone,
        installedOn: dateFromISO(input.on)!,
        serviceJobId: input.job.id,
        servicePartId: input.servicePartId,
        createdById: input.actorId,
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('tracker_imei_in_use', 'This IMEI is on another moped; take it off there first.');
    throw e;
  }
}

/**
 * A repair called off gives its shelf's parts back, so a tracker it took off
 * the shelf was never fitted (ADR-0036). One it moved off a donor, or took off
 * the moped, stays as it is: those parts did not go back anywhere.
 */
async function unfitTrackers(tx: Tx, jobId: string): Promise<void> {
  await tx.vehicleTracker.deleteMany({ where: { serviceJobId: jobId, removedOn: null, servicePart: { kind: 'stock' } } });
}

/** A repair that waited only for a line just taken off goes back to work. */
async function settleIfNothingWaits(tx: Tx, jobId: string): Promise<void> {
  const job = await tx.serviceJob.findUnique({ where: { id: jobId }, select: { status: true, approvedAt: true } });
  if (!job || job.status !== 'draft' || job.approvedAt == null) return;
  const works = await tx.serviceWork.count({ where: { jobId, approvedAt: null, rejectedAt: null } });
  const parts = await tx.servicePart.count({ where: { jobId, kind: 'bought', approvedAt: null, rejectedAt: null } });
  if (works + parts === 0) await tx.serviceJob.update({ where: { id: jobId }, data: { status: 'open', updatedAt: new Date() } });
}

/**
 * A bought part from the catalogue passes through the shelf once it is the
 * company's — approved — in at what the receipt says one cost and out at the
 * same, on the day it was written into the repair (ADR-0036). A part bought
 * under a name of the mechanic's own never touches the shelf.
 */
async function boughtThrough(tx: Tx, line: { id: string; partId: string | null; qty: number; paidTetri: number | null; createdAt: Date }, number: string, actorId: string): Promise<void> {
  if (!line.partId || line.paidTetri == null) return;
  await passThrough(tx, {
    servicePartId: line.id,
    partId: line.partId,
    qty: line.qty,
    unitCostTetri: Math.round(line.paidTetri / line.qty),
    occurredOn: todayISO(line.createdAt, env.TZ),
    actorId,
    reason: `${number}: купил механик`,
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
      select: {
        id: true,
        number: true,
        status: true,
        approvedAt: true,
        works: { select: { id: true, workTypeId: true, normSec: true, approvedAt: true, rejectedAt: true } },
        parts: { where: { kind: 'bought' }, select: { id: true, kind: true, partId: true, qty: true, paidTetri: true, createdAt: true, approvedAt: true, rejectedAt: true } },
      },
    });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    if (job.status !== 'draft') throw conflict('job_not_waiting', 'This repair is not waiting for approval.', { status: job.status });
    for (const n of norms) {
      const line = job.works.find((w) => w.id === n.workId);
      if (!line) throw notFound('work_line_not_found', 'No such work on this repair.');
      if (line.workTypeId) throw conflict('norm_from_book', 'A work from the book keeps the norm it was written with.');
    }
    const waiting = job.works.filter((w) => workLineState(w) === 'waiting');
    // A part the mechanic bought waits with the works (ADR-0036): approving it
    // is the company taking it on, so that is when it passes through the shelf.
    const bought = job.parts.filter((p) => partLineState(p) === 'waiting');
    const now = new Date();
    const first = job.approvedAt == null;
    await prisma.$transaction(async (tx) => {
      for (const n of norms) await tx.serviceWork.update({ where: { id: n.workId }, data: { normSec: n.normSec } });
      await tx.serviceWork.updateMany({ where: { id: { in: waiting.map((w) => w.id) } }, data: { approvedById: actor.id, approvedAt: now } });
      await tx.servicePart.updateMany({ where: { id: { in: bought.map((p) => p.id) } }, data: { approvedById: actor.id, approvedAt: now } });
      for (const p of bought) await boughtThrough(tx, p, job.number, actor.id);
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
          after: { number: job.number, status: 'open', works: waiting.length, parts: bought.length || undefined, again: !first, norms: norms.length > 0 ? norms : undefined },
        },
      });
    });
    return { ok: true, works: waiting.length, parts: bought.length };
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
    // Spaces are no reason: the mechanic reads it on his repair.
    const reason = str(req.body ?? {}, 'reason', { required: true, max: 1000 });
    if (!reason) throw badRequest('missing_field', 'Say why it is refused.', { field: 'reason' });
    const job = await prisma.serviceJob.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        number: true,
        status: true,
        approvedAt: true,
        movedVehicle: true,
        vehicleId: true,
        works: { select: { id: true, approvedAt: true, rejectedAt: true } },
        parts: { where: { kind: 'bought' }, select: { id: true, kind: true, approvedAt: true, rejectedAt: true } },
      },
    });
    if (!job) throw notFound('job_not_found', 'No such repair job.');
    if (job.status !== 'draft') throw conflict('job_not_waiting', 'This repair is not waiting for approval.', { status: job.status });
    const now = new Date();
    const today = todayISO(now, env.TZ);
    if (job.approvedAt == null) {
      let back = 0;
      await prisma.$transaction(async (tx) => {
        back = await returnServiceParts(tx, { jobId: job.id, occurredOn: today, actorId: actor.id, reason: `${job.number}: ${reason}`.slice(0, 1000) });
        await unfitTrackers(tx, job.id);
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
    // A bought part refused stays on the repair, struck through, and is not
    // paid back; it never passed the shelf (ADR-0036).
    const bought = job.parts.filter((p) => partLineState(p) === 'waiting').map((p) => p.id);
    await prisma.$transaction(async (tx) => {
      await tx.serviceWork.updateMany({ where: { id: { in: waiting } }, data: { rejectedById: actor.id, rejectedAt: now, rejectReason: reason } });
      await tx.servicePart.updateMany({ where: { id: { in: bought } }, data: { rejectedById: actor.id, rejectedAt: now, rejectReason: reason } });
      await tx.serviceJob.update({ where: { id: job.id }, data: { status: 'open', updatedAt: now } });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'service.reject', entityType: 'service_job', entityId: job.id, after: { number: job.number, status: 'open', works: waiting.length, parts: bought.length || undefined }, note: reason },
      });
    });
    return { ok: true, status: 'open', works: waiting.length, parts: bought.length };
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
   * is paid (ADR-0037 §5): what a payout paid for is not changed under it. A
   * work from the book keeps the norm it was written with.
   */
  app.patch<{ Params: { id: string; workId: string }; Body: Body }>('/api/service/:id/works/:workId', { config: { scope: 'service.norms' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const normSec = normSecFromMinutes(b.normMin as string | number | null | undefined);
    if (normSec == null) throw badRequest('bad_field', 'A norm is minutes above zero.', { field: 'normMin' });
    const line = await prisma.serviceWork.findUnique({ where: { id: req.params.workId }, include: { job: { select: { id: true, number: true, status: true, paidInPayoutId: true } } } });
    if (!line || line.jobId !== req.params.id) throw notFound('work_line_not_found', 'No such work on this repair.');
    if (line.workTypeId) throw conflict('norm_from_book', 'A work from the book keeps the norm it was written with.');
    if (line.job.status === 'cancelled') throw conflict('job_closed', 'A cancelled repair is a record; it is not edited.');
    refusePaid(line.job);
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

  /** The shelf as the workshop reads it (ADR-0036): what there is and how many, never what it cost. */
  app.get('/api/service/shelf', { config: { scope: 'service.work' } }, async () => {
    const rows = await partRows();
    return { parts: rows.map((p) => ({ id: p.id, sku: p.sku, name: p.name, nameKa: p.nameKa, unit: p.unit, onHand: p.onHand, isTracker: p.isTracker })) };
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
  app.get<{ Querystring: { q?: string; donor?: string } }>('/api/service/vehicles', { config: { scope: 'service.work' } }, async (req) => {
    const raw = (req.query.q ?? '').trim();
    // A donor is often a moped written off after an accident: it is looked for too (ADR-0036).
    const donor = req.query.donor === '1';
    // «8» is EV-008: a sticker's number may be one digit, a VIN's tail is two characters at least.
    const q = readQuery(raw);
    const number = readFleetNumber(raw, { digitsToo: true });
    if (!q && number == null) return { vehicles: [] };
    const all = await prisma.vehicle.findMany({
      where: { archived: false, state: { notIn: donor ? ['sold'] : ['sold', 'out'] } },
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

  /**
   * A line of parts on a repair (SRV-01; stage 4, ADR-0036). Off the shelf, as
   * it always was; bought by the mechanic, with the receipt; a working part
   * taken off this moped onto the shelf; or one taken off a donor and fitted
   * here. The owner writes into a repair in work, as before; a mechanic into
   * his own while it waits or is in work. A tracker fitted asks for its IMEI and
   * SIM. A bought line waits for approval like a work found later; nobody's
   * shelf is a reason to refuse a repair, and a short one goes into the red.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/service/:id/parts', { config: { scope: 'service.work' }, bodyLimit: JOB_BODY_LIMIT }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const job = await writableJob(actor, req.params.id);
    const kind = oneOf(b, 'kind', SERVICE_PART_KINDS) ?? 'stock';
    const owner = hasPerm(actor, 'service.manage');

    // A line may take the part off the shelf, or just name it. A repair on a
    // part nobody keeps in stock is still a repair.
    const catalogueId = str(b, 'partId');
    const catalogue = catalogueId ? await prisma.part.findUnique({ where: { id: catalogueId } }) : null;
    if (catalogueId && !catalogue) throw notFound('part_not_found', 'No such part.');
    // The shelf needs a name it knows: only a part of the catalogue goes onto it,
    // and a mechanic takes off it only what it holds.
    if (!catalogue && (kind === 'removed' || (kind === 'stock' && !owner))) throw badRequest('missing_field', 'Pick the part from the catalogue.', { field: 'partId' });
    const name = catalogue?.name ?? str(b, 'name', { required: true, max: 200 })!;
    const qty = int(b, 'qty', { min: 1, max: 999 }) ?? 1;
    const today = todayISO(new Date(), env.TZ);
    const here = `${fleetNumber(job.vehicle.fleetNo) ?? `···${job.vehicle.vin.slice(-6)}`} · ${job.number}`;

    // A tracker fitted is somebody's: its IMEI and SIM, one per moped (ADR-0036).
    const fitsTracker = catalogue?.isTracker === true && kind !== 'removed';
    if (catalogue?.isTracker && kind === 'removed') throw conflict('tracker_remove_apart', 'A tracker comes off by «снять трекер», which closes it on the moped.');
    const tracker = fitsTracker ? readTracker(b, qty) : null;

    let donor: { id: string; fleetNo: number | null; vin: string } | null = null;
    if (kind === 'donor') {
      const donorId = str(b, 'donorVehicleId', { required: true })!;
      donor = await prisma.vehicle.findUnique({ where: { id: donorId }, select: { id: true, fleetNo: true, vin: true, state: true } });
      if (!donor) throw notFound('vehicle_not_found', 'No such moped.');
      if (donor.id === job.vehicleId) throw conflict('donor_is_this_moped', 'A donor is another moped.');
    }

    // What the line is priced at. The shelf's line, as before: what the shelf
    // paid for a company repair, retail for a customer's; a price is typed only
    // by whoever sees prices. Off a donor: nought to the company, retail to a
    // customer. Bought: the receipt. Taken off: nothing.
    let unitPriceTetri: number;
    let unitCostTetri: number | null;
    let paidTetri: number | null = null;
    if (kind === 'stock') {
      const shelf = catalogue ? await shelfPrice(catalogue.id, job.payer as Payer) : null;
      const typed = owner ? tetri(b, 'unitPriceTetri', { min: 0 }) : null;
      const price = typed ?? shelf?.unitPriceTetri ?? (owner ? null : 0);
      if (price == null) throw badRequest('missing_field', 'unitPriceTetri is required', { field: 'unitPriceTetri' });
      unitPriceTetri = price;
      unitCostTetri = shelf?.unitCostTetri ?? null;
    } else if (kind === 'bought') {
      paidTetri = tetri(b, 'paidTetri', { required: true, min: 1 })!;
      unitPriceTetri = Math.round(paidTetri / qty);
      unitCostTetri = unitPriceTetri;
    } else if (kind === 'donor') {
      unitPriceTetri = job.payer === 'customer' ? (catalogue?.salePriceTetri ?? 0) : 0;
      unitCostTetri = 0;
    } else {
      unitPriceTetri = 0;
      unitCostTetri = 0;
    }
    const receipt = kind === 'bought' ? jobPhoto(b.receiptPhoto, 'receiptPhoto') : null;
    if (kind === 'bought' && !receipt) throw badRequest('receipt_photo_missing', 'A part bought goes in with the photo of its receipt.', { field: 'receiptPhoto' });
    // The money goes back to whoever bought it: the mechanic who writes it, or
    // — an owner writing it for him — the repair's mechanic.
    const reimburseToId = kind === 'bought' ? (owner ? job.mechanicId : actor.id) : null;
    if (kind === 'bought' && !reimburseToId) throw conflict('job_no_mechanic', 'This repair has no mechanic to pay back.');
    // Like a work found later (ADR-0035): bought by whoever may approve, into a
    // repair in work, it is approved as it is written; otherwise it waits.
    const approvedNow = kind === 'bought' && job.status === 'open' && hasPerm(actor, 'service.approve');
    const waits = kind === 'bought' && !approvedNow;

    const line = await prisma.$transaction(async (tx) => {
      const photo = receipt
        ? await tx.storedFile.create({
            data: {
              kind: 'service_photo',
              serviceJobId: job.id,
              tag: 'receipt',
              label: `receipt-${name}`.slice(0, 200),
              mimeType: receipt.mime,
              sizeBytes: receipt.bytes.length,
              sha256: createHash('sha256').update(receipt.bytes).digest('hex'),
              bytes: new Uint8Array(receipt.bytes),
              uploadedById: actor.id,
            },
            select: { id: true },
          })
        : null;
      const created = await tx.servicePart.create({
        data: {
          jobId: job.id,
          name,
          qty,
          unitPriceTetri,
          unitCostTetri,
          partId: catalogue?.id ?? null,
          kind,
          donorVehicleId: donor?.id ?? null,
          paidTetri,
          receiptPhotoId: photo?.id ?? null,
          reimburseToId,
          createdById: actor.id,
          ...(approvedNow ? { approvedById: actor.id, approvedAt: new Date() } : {}),
        },
        select: { id: true, createdAt: true },
      });
      if (catalogue) {
        if (kind === 'stock') {
          // Dated the day the repair opened, as a shelf line always was.
          await issueForServicePart(tx, { servicePartId: created.id, partId: catalogue.id, qty, occurredOn: isoDate(job.openedOn)!, actorId: actor.id });
        } else if (kind === 'removed') {
          await receiveRemoved(tx, { servicePartId: created.id, partId: catalogue.id, qty, occurredOn: today, actorId: actor.id, reason: `снято с ${here}` });
        } else if (kind === 'donor') {
          await passThrough(tx, { servicePartId: created.id, partId: catalogue.id, qty, unitCostTetri: 0, occurredOn: today, actorId: actor.id, reason: `с донора ${fleetNumber(donor!.fleetNo) ?? `···${donor!.vin.slice(-6)}`} → ${here}` });
        } else if (approvedNow) {
          await boughtThrough(tx, { id: created.id, partId: catalogue.id, qty, paidTetri, createdAt: created.createdAt }, job.number, actor.id);
        }
      }
      if (tracker) await fitTracker(tx, { job, partId: catalogue!.id, servicePartId: created.id, donorVehicleId: donor?.id ?? null, imei: tracker.imei, simPhone: tracker.simPhone, on: today, actorId: actor.id });
      if (waits && job.status !== 'draft') await tx.serviceJob.update({ where: { id: job.id }, data: { status: 'draft', updatedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'service.part.add',
          entityType: 'service_job',
          entityId: job.id,
          after: {
            number: job.number,
            partId: created.id,
            name,
            qty,
            kind,
            paidTetri: paidTetri ?? undefined,
            donor: donor ? (fleetNumber(donor.fleetNo) ?? donor.vin) : undefined,
            imei: tracker ? `···${tracker.imei.slice(-4)}` : undefined,
            waits: waits || undefined,
          },
        },
      });
      return created;
    });
    return reply.code(201).send({ id: line.id, status: waits ? 'draft' : job.status });
  });

  app.delete<{ Params: { id: string; partId: string } }>('/api/service/:id/parts/:partId', { config: { scope: 'service.work' } }, async (req) => {
    const actor = actorOf(req);
    const job = await writableJob(actor, req.params.id);
    const part = await prisma.servicePart.findUnique({ where: { id: req.params.partId }, include: { trackers: { where: { removedOn: null }, select: { id: true, imei: true } } } });
    if (!part || part.jobId !== job.id) throw notFound('part_not_found', 'No such part on this job.');
    // A part bought and approved is money owed to the mechanic: whoever approved
    // it may take it off, he may not.
    if (part.kind === 'bought' && part.approvedAt != null && !hasPerm(actor, 'service.approve')) {
      throw conflict('line_approved', 'This part is approved; the chief mechanic takes it off.');
    }
    // Taking the line off the job puts the parts back on the shelf — as a
    // movement of its own, not by rubbing out the one that issued them
    // (QA-W5-18). In "Движения" of that part both are visible: that they
    // were taken, and that they came back.
    const today = todayISO(new Date(), env.TZ);
    await prisma.$transaction(async (tx) => {
      await returnServicePart(tx, { servicePartId: part.id, occurredOn: today, actorId: actor.id, reason: `возврат из ремонта ${job.number}` });
      // A tracker fitted by this line was never fitted; one moved off a donor goes back on it.
      for (const t of part.trackers) {
        await tx.vehicleTracker.delete({ where: { id: t.id } });
        if (part.donorVehicleId) {
          await tx.vehicleTracker.updateMany({
            where: { vehicleId: part.donorVehicleId, imei: t.imei, removedJobId: job.id },
            data: { removedOn: null, removedJobId: null, removedById: null },
          });
        }
      }
      await tx.servicePart.delete({ where: { id: part.id } });
      await settleIfNothingWaits(tx, job.id);
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'service.part.remove', entityType: 'service_job', entityId: job.id, before: { name: part.name, qty: part.qty, kind: part.kind } },
      });
    });
    return { ok: true };
  });

  /**
   * The tracker comes off the moped (ADR-0036): it is closed on the moped with
   * the day and the repair, and — working — goes onto the shelf at a nought,
   * as any part taken off does. A broken one is only closed.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/service/:id/tracker/remove', { config: { scope: 'service.work' } }, async (req, reply) => {
    const actor = actorOf(req);
    const job = await writableJob(actor, req.params.id);
    const working = (req.body ?? {}).working === true;
    const tracker = await prisma.vehicleTracker.findFirst({ where: { vehicleId: job.vehicleId, removedOn: null }, include: { part: { select: { id: true, name: true } } } });
    if (!tracker) throw notFound('tracker_none', 'No tracker is on this moped.');
    const today = todayISO(new Date(), env.TZ);
    if (today < isoDate(tracker.installedOn)!) throw conflict('tracker_removed_before_fitted', 'A tracker cannot come off before it was fitted.');
    const here = `${fleetNumber(job.vehicle.fleetNo) ?? `···${job.vehicle.vin.slice(-6)}`} · ${job.number}`;
    await prisma.$transaction(async (tx) => {
      await tx.vehicleTracker.update({ where: { id: tracker.id }, data: { removedOn: dateFromISO(today)!, removedJobId: job.id, removedById: actor.id } });
      if (working && tracker.part) {
        const line = await tx.servicePart.create({
          data: { jobId: job.id, name: tracker.part.name, qty: 1, unitPriceTetri: 0, unitCostTetri: 0, partId: tracker.part.id, kind: 'removed', createdById: actor.id },
          select: { id: true },
        });
        await receiveRemoved(tx, { servicePartId: line.id, partId: tracker.part.id, qty: 1, occurredOn: today, actorId: actor.id, reason: `снято с ${here}` });
      }
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'tracker.remove', entityType: 'service_job', entityId: job.id, after: { number: job.number, imei: `···${tracker.imei.slice(-4)}`, working } },
      });
    });
    return reply.code(201).send({ ok: true, toShelf: working && tracker.part != null });
  });

  /**
   * A battery or a charger taken to repair, or brought back from it, by this
   * repair (ADR-0036): a movement of their own count (ADR-0025), not of the
   * shelf of parts — by number, without serials (17.09.2026).
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/service/:id/batteries', { config: { scope: 'service.work' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const job = await writableJob(actor, req.params.id);
    const item = oneOf(b, 'item', ['battery', 'charger'] as const, { required: true })!;
    const kind = oneOf(b, 'kind', ['to_repair', 'from_repair'] as const, { required: true })!;
    const qty = int(b, 'qty', { required: true, min: 1, max: 50 })!;
    const today = todayISO(new Date(), env.TZ);
    const row = await prisma.$transaction(async (tx) => {
      const made = await tx.batteryMove.create({
        data: { item, kind, qty, reason: job.number, serviceJobId: job.id, occurredOn: dateFromISO(today)!, createdById: actor.id },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: item === 'charger' ? 'charger.move' : 'battery.move', entityType: item, entityId: made.id, after: { kind, qty, job: job.number } },
      });
      return made;
    });
    return reply.code(201).send(row);
  });

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
    const job = await prisma.serviceJob.findFirst({ where: { id: req.params.id, ...(owner ? {} : mine(actor)) }, include: { parts: true, works: { select: WORK_MONEY } } });
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
    // A customer's repair is charged labour and parts; the company's own also costs its mechanic's work (ADR-0037 §6).
    const total = repairTotalTetri(job);
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
      await unfitTrackers(tx, job.id);
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
