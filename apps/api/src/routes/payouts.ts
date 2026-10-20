import { LABOUR_RATE_TETRI, fleetNumber, jobPayState, partLineState, todayISO, workLineState, worksTotal, type PayState } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../generated/prisma/client.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { int, str } from '../lib/validate.js';

// Paying the mechanic (stage 5 of docs/spec/mechanic-in-erp-plan.md; ADR-0037).
//
// «К оплате» is what each mechanic is owed: his closed repairs that nothing
// holds back, their approved work by the norm, each repair rounded once, and
// the receipts he paid himself — paid back to whoever paid them, in whoever's
// repair they were. «Оплачено» is the owner's mark, not a payment: no payment
// row, no expense, nothing in «Деньги» (§3). The screen and the mark ask the
// one function below, so the owner pays exactly what he saw, and a repair is
// paid once — the database holds a repair to one payout of its own mechanic.

type Body = Record<string, unknown>;
type Db = Prisma.TransactionClient;

/** A bought line approved, not refused and not yet paid back (ADR-0036). */
const UNPAID_RECEIPT = { kind: 'bought', approvedAt: { not: null }, rejectedAt: null, paidInPayoutId: null } as const;

/**
 * The repairs a receipt is paid back from: closed — or called off, which keeps
 * the part it got (ADR-0036: bought parts stay as they are), so the money the
 * mechanic laid out for it is still his. A refused repair pays nothing
 * (ADR-0035 §3, ADR-0037 §2); only a cancelled repair can be refused.
 */
const RECEIPT_JOB: Prisma.ServiceJobWhereInput = { status: { in: ['done', 'cancelled'] }, rejectedAt: null };

/** The money a repair's lines carry, and what holds it back (jobPayState). */
const PAY_JOB = {
  id: true,
  number: true,
  status: true,
  paidInPayoutId: true,
  closedOn: true,
  vehicle: { select: { id: true, vin: true, fleetNo: true, model: { select: { brand: true, name: true } } } },
  works: {
    orderBy: { createdAt: 'asc' },
    select: { qty: true, normSec: true, rateTetri: true, approvedAt: true, rejectedAt: true, freeText: true, workType: { select: { code: true } } },
  },
  parts: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, kind: true, paidTetri: true, approvedAt: true, rejectedAt: true, reimburseToId: true, paidInPayoutId: true },
  },
} as const;

/** What jobPayState reads of a repair a receipt is in. */
const PAY_STATE = {
  id: true,
  number: true,
  status: true,
  paidInPayoutId: true,
  works: { select: { normSec: true, approvedAt: true, rejectedAt: true } },
  parts: { select: { kind: true, approvedAt: true, rejectedAt: true } },
} as const;

const PAYOUT = {
  id: true,
  paidOn: true,
  labourTetri: true,
  reimburseTetri: true,
  markedAt: true,
  voidedAt: true,
  voidReason: true,
  mechanic: { select: { id: true, name: true } },
  markedBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
  jobs: { orderBy: { number: 'asc' }, select: { id: true, number: true } },
  _count: { select: { parts: true } },
} as const;

type PayoutRow = Prisma.MechanicPayoutGetPayload<{ select: typeof PAYOUT }>;

interface Receipt {
  id: string;
  name: string;
  paidTetri: number;
}

export interface PayJob {
  id: string;
  number: string;
  vehicle: { id: string; vin: string; number: string | null; model: string };
  closedOn: string | null;
  seconds: number;
  /** Its approved work, rounded once for the repair (ADR-0037 §8). */
  workTetri: number;
  works: { code: string | null; freeText: string | null; qty: number }[];
  /** His own receipts in it. */
  receipts: Receipt[];
  totalTetri: number;
}

export interface MechanicDue {
  id: string;
  name: string;
  role: string;
  /** His rate now, or the company's — to read by; every line keeps the rate it was written at. */
  rateTetri: number;
  jobs: PayJob[];
  /**
   * Receipts not paid with a repair of his on this screen: those he paid in
   * somebody else's repair — they come back to him, not to its mechanic — and
   * those in a repair called off.
   */
  otherReceipts: (Receipt & { jobId: string; jobNumber: string })[];
  seconds: number;
  workTetri: number;
  reimburseTetri: number;
  totalTetri: number;
  jobIds: string[];
  partIds: string[];
}

/**
 * A receipt waits for its repair: closed and nothing on it undecided — or its
 * mechanic already paid; one in a repair called off waits for nothing.
 */
const RECEIPT_DUE: readonly PayState[] = ['payable', 'paid', 'cancelled'];

/**
 * What one person is owed now, or null when nothing. The one place this is
 * worked out: «К оплате» shows it, «Оплачено» recomputes it inside its
 * transaction and refuses when it is not what the owner saw.
 */
async function payableFor(db: Db, mechanicId: string): Promise<MechanicDue | null> {
  // One after another: inside a transaction the queries share one connection.
  const person = await db.user.findUnique({ where: { id: mechanicId }, select: { id: true, name: true, role: true, labourRateTetri: true } });
  if (!person) return null;
  const jobs = await db.serviceJob.findMany({
    where: { mechanicId, status: 'done', paidInPayoutId: null },
    orderBy: [{ closedOn: 'asc' }, { number: 'asc' }],
    select: PAY_JOB,
  });
  const bought = await db.servicePart.findMany({
    where: { ...UNPAID_RECEIPT, reimburseToId: mechanicId, job: RECEIPT_JOB },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, paidTetri: true, jobId: true, job: { select: PAY_STATE } },
  });
  const receipts = bought.filter((p) => RECEIPT_DUE.includes(jobPayState(p.job)));
  const receipt = (p: (typeof receipts)[number]): Receipt => ({ id: p.id, name: p.name, paidTetri: p.paidTetri ?? 0 });

  const out: PayJob[] = [];
  for (const j of jobs) {
    if (jobPayState(j) !== 'payable') continue;
    const done = worksTotal(j.works.filter((w) => workLineState(w) === 'approved'));
    const own = receipts.filter((p) => p.jobId === j.id).map(receipt);
    if (done.tetri <= 0 && own.length === 0) continue;
    const back = own.reduce((n, p) => n + p.paidTetri, 0);
    out.push({
      id: j.id,
      number: j.number,
      vehicle: { id: j.vehicle.id, vin: j.vehicle.vin, number: fleetNumber(j.vehicle.fleetNo), model: `${j.vehicle.model.brand} ${j.vehicle.model.name}` },
      closedOn: isoDate(j.closedOn),
      seconds: done.seconds,
      workTetri: done.tetri,
      works: j.works.filter((w) => workLineState(w) === 'approved').map((w) => ({ code: w.workType?.code ?? null, freeText: w.freeText, qty: w.qty })),
      receipts: own,
      totalTetri: done.tetri + back,
    });
  }
  const listed = new Set(out.map((j) => j.id));
  const otherReceipts = receipts.filter((p) => !listed.has(p.jobId)).map((p) => ({ ...receipt(p), jobId: p.jobId, jobNumber: p.job.number }));
  if (out.length === 0 && otherReceipts.length === 0) return null;

  const workTetri = out.reduce((n, j) => n + j.workTetri, 0);
  const reimburseTetri = out.reduce((n, j) => n + j.receipts.reduce((m, p) => m + p.paidTetri, 0), 0) + otherReceipts.reduce((n, p) => n + p.paidTetri, 0);
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    rateTetri: person.labourRateTetri ?? LABOUR_RATE_TETRI,
    jobs: out,
    otherReceipts,
    seconds: out.reduce((n, j) => n + j.seconds, 0),
    workTetri,
    reimburseTetri,
    totalTetri: workTetri + reimburseTetri,
    jobIds: out.map((j) => j.id),
    partIds: [...out.flatMap((j) => j.receipts.map((p) => p.id)), ...otherReceipts.map((p) => p.id)],
  };
}

/** Nothing owed: the same shape, empty — a mechanic's balance always has one. */
function nothingDue(person: { id: string; name: string; role: string; labourRateTetri: number | null }): MechanicDue {
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    rateTetri: person.labourRateTetri ?? LABOUR_RATE_TETRI,
    jobs: [],
    otherReceipts: [],
    seconds: 0,
    workTetri: 0,
    reimburseTetri: 0,
    totalTetri: 0,
    jobIds: [],
    partIds: [],
  };
}

/**
 * Payouts as the list shows them. A voided one let go of its repairs, so what
 * it had paid is read back from the journal lines its voiding wrote — the
 * payout still says which repairs it was (ADR-0037 §3).
 */
async function payoutsOut(rows: PayoutRow[]) {
  const voided = rows.filter((r) => r.voidedAt != null).map((r) => r.id);
  const undone = new Map<string, { jobs: { id: string; number: string }[]; receipts: number }>();
  if (voided.length > 0) {
    const byPayout = voided.map((id) => ({ after: { path: ['payoutId'], equals: id } }));
    const [unpaid, voids] = await Promise.all([
      prisma.auditLog.findMany({ where: { action: 'service.unpaid', entityType: 'service_job', OR: byPayout }, select: { entityId: true, after: true } }),
      prisma.auditLog.findMany({ where: { action: 'mechanic.payout.void', entityType: 'user', OR: byPayout }, select: { after: true } }),
    ]);
    for (const id of voided) undone.set(id, { jobs: [], receipts: 0 });
    for (const u of unpaid) {
      const a = (u.after ?? {}) as { payoutId?: string; number?: string };
      if (a.payoutId && u.entityId && a.number) undone.get(a.payoutId)?.jobs.push({ id: u.entityId, number: a.number });
    }
    for (const v of voids) {
      const a = (v.after ?? {}) as { payoutId?: string; receipts?: number };
      const slot = a.payoutId ? undone.get(a.payoutId) : undefined;
      if (slot) slot.receipts = a.receipts ?? 0;
    }
    for (const slot of undone.values()) slot.jobs.sort((x, y) => x.number.localeCompare(y.number));
  }
  return rows.map((r) => {
    const was = undone.get(r.id);
    return {
      id: r.id,
      mechanic: r.mechanic,
      paidOn: isoDate(r.paidOn) as string,
      labourTetri: r.labourTetri,
      reimburseTetri: r.reimburseTetri,
      totalTetri: r.labourTetri + r.reimburseTetri,
      jobs: was ? was.jobs : r.jobs,
      receiptsCount: was ? was.receipts : r._count.parts,
      markedBy: r.markedBy,
      markedAt: r.markedAt.toISOString(),
      voided: r.voidedAt ? { at: r.voidedAt.toISOString(), by: r.voidedBy ?? null, reason: r.voidReason ?? '' } : null,
    };
  });
}

/** A list of ids as the body sends it; none is an empty list. */
function idList(b: Body, key: string): string[] {
  const v = b[key];
  if (v == null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x === '')) throw badRequest('bad_field', `${key} is a list of ids.`, { field: key });
  return v as string[];
}

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const x = new Set(a);
  return x.size === a.length && a.length === b.length && b.every((id) => x.has(id));
};

/** The work a repair not yet payable comes to: every line not refused, by the norm it has so far. */
function heldTetri(job: { works: { qty: number; normSec: number | null; rateTetri: number; rejectedAt: Date | null }[] }): number {
  return worksTotal(job.works.filter((w) => w.rejectedAt == null)).tetri;
}

const HELD: readonly PayState[] = ['unnormed', 'waiting', 'open'];

export function payoutRoutes(app: FastifyInstance): void {
  /**
   * «К оплате» (ADR-0037 §2): each mechanic owed something, with the repairs
   * and receipts it is for; the repairs of mechanics not payable yet and why;
   * the last payouts. The owners' alone, and not from the workshop tablet.
   */
  app.get('/api/service/payouts', { config: { scope: 'service.payout' } }, async () => {
    const [carried, bought] = await Promise.all([
      prisma.serviceJob.findMany({ where: { status: 'done', paidInPayoutId: null, mechanicId: { not: null } }, distinct: ['mechanicId'], select: { mechanicId: true } }),
      prisma.servicePart.findMany({ where: { ...UNPAID_RECEIPT, reimburseToId: { not: null }, job: RECEIPT_JOB }, distinct: ['reimburseToId'], select: { reimburseToId: true } }),
    ]);
    const ids = [...new Set([...carried.map((j) => j.mechanicId), ...bought.map((p) => p.reimburseToId)].filter((id): id is string => id != null))];
    const due: MechanicDue[] = [];
    for (const id of ids) {
      const m = await payableFor(prisma, id);
      if (m) due.push(m);
    }
    due.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

    const [pending, payouts] = await Promise.all([
      prisma.serviceJob.findMany({
        where: { mechanicId: { not: null }, paidInPayoutId: null, status: { not: 'cancelled' } },
        orderBy: [{ openedOn: 'asc' }, { number: 'asc' }],
        select: {
          id: true,
          number: true,
          status: true,
          paidInPayoutId: true,
          mechanic: { select: { id: true, name: true } },
          works: { select: { qty: true, normSec: true, rateTetri: true, approvedAt: true, rejectedAt: true } },
          parts: { select: { kind: true, approvedAt: true, rejectedAt: true } },
        },
      }),
      prisma.mechanicPayout.findMany({ orderBy: [{ markedAt: 'desc' }, { id: 'asc' }], take: 50, select: PAYOUT }),
    ]);
    const held = pending.flatMap((j) => {
      const state = jobPayState(j);
      if (!HELD.includes(state) || !j.mechanic) return [];
      return [{ id: j.id, number: j.number, mechanic: j.mechanic, state: state as 'unnormed' | 'waiting' | 'open', amountTetri: heldTetri(j) }];
    });
    return {
      mechanics: due,
      held,
      payouts: await payoutsOut(payouts),
      totalTetri: due.reduce((n, m) => n + m.totalTetri, 0),
    };
  });

  /**
   * «Оплачено»: the owner marks one mechanic paid for exactly what the screen
   * showed him — the repairs, the receipts and the total he saw. Anything
   * closed, approved or paid in between refuses the mark with what is owed
   * now; nothing is paid that the owner did not see (ADR-0037 §4).
   */
  app.post<{ Body: Body }>('/api/service/payouts', { config: { scope: 'service.payout' } }, async (req, reply) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const mechanicId = str(b, 'mechanicId', { required: true });
    if (!mechanicId) throw badRequest('missing_field', 'Say which mechanic was paid.', { field: 'mechanicId' });
    const jobIds = idList(b, 'jobIds');
    const partIds = idList(b, 'partIds');
    const totalTetri = int(b, 'totalTetri', { required: true, min: 0 })!;
    const now = new Date();
    const paidOn = todayISO(now, env.TZ);

    const row = await prisma.$transaction(async (tx) => {
      // One mark for a mechanic at a time: a second one waits here, then finds
      // the repairs paid. The conditional writes below refuse it anyway.
      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${mechanicId}::uuid FOR NO KEY UPDATE`;
      // His closed repairs hold still while they are read and paid: a norm
      // given on one waits for this mark, then finds it paid (ADR-0037 §5).
      await tx.$queryRaw`SELECT 1 FROM service_jobs WHERE mechanic_id = ${mechanicId}::uuid AND status = 'done' AND paid_in_payout_id IS NULL FOR UPDATE`;
      const due = await payableFor(tx, mechanicId);
      if (!due) throw conflict('nothing_to_pay', 'Nothing is owed to this mechanic now.');
      if (!sameSet(jobIds, due.jobIds) || !sameSet(partIds, due.partIds) || totalTetri !== due.totalTetri) {
        throw conflict('payout_changed', 'What is owed changed since the screen was read; read it again.', { mechanic: due });
      }
      const payout = await tx.mechanicPayout.create({
        data: { mechanicId, paidOn: dateFromISO(paidOn)!, labourTetri: due.workTetri, reimburseTetri: due.reimburseTetri, markedById: actor.id, markedAt: now },
        select: { id: true },
      });
      const jobs = await tx.serviceJob.updateMany({
        where: { id: { in: due.jobIds }, paidInPayoutId: null, status: 'done', mechanicId },
        data: { paidInPayoutId: payout.id, updatedAt: now },
      });
      const parts = await tx.servicePart.updateMany({
        where: { id: { in: due.partIds }, ...UNPAID_RECEIPT, reimburseToId: mechanicId },
        data: { paidInPayoutId: payout.id },
      });
      // Paid by another mark a moment ago: this one is undone whole.
      if (jobs.count !== due.jobIds.length || parts.count !== due.partIds.length) throw conflict('already_paid', 'Some of this was paid a moment ago; read the screen again.');
      if (due.jobs.length > 0) {
        await tx.auditLog.createMany({
          data: due.jobs.map((j) => ({
            actorId: actor.id,
            action: 'service.paid',
            entityType: 'service_job',
            entityId: j.id,
            after: { number: j.number, payoutId: payout.id, workTetri: j.workTetri },
          })),
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'mechanic.payout',
          entityType: 'user',
          entityId: mechanicId,
          after: { payoutId: payout.id, paidOn, labourTetri: due.workTetri, reimburseTetri: due.reimburseTetri, jobs: due.jobs.map((j) => j.number), receipts: due.partIds.length },
        },
      });
      return tx.mechanicPayout.findUniqueOrThrow({ where: { id: payout.id }, select: PAYOUT });
    });
    reply.code(201);
    return { payout: (await payoutsOut([row]))[0] };
  });

  /**
   * A payout marked by mistake is voided with its reason (ADR-0037 §5): its
   * repairs and receipts let go of it and are owed again — and may be changed
   * again until they are paid.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/service/payouts/:id/void', { config: { scope: 'service.payout' } }, async (req) => {
    const actor = actorOf(req);
    // Spaces are no reason: the mechanic reads it in his balance.
    const reason = str(req.body ?? {}, 'reason', { required: true, max: 1000 });
    if (!reason) throw badRequest('missing_field', 'Say why the payout is voided.', { field: 'reason' });
    const found = await prisma.mechanicPayout.findUnique({ where: { id: req.params.id }, select: { id: true, mechanicId: true, voidedAt: true } });
    if (!found) throw notFound('payout_not_found', 'No such payout.');
    if (found.voidedAt) throw conflict('payout_voided', 'This payout is already voided.');
    const now = new Date();

    const row = await prisma.$transaction(async (tx) => {
      const marked = await tx.mechanicPayout.updateMany({ where: { id: found.id, voidedAt: null }, data: { voidedAt: now, voidedById: actor.id, voidReason: reason } });
      if (marked.count !== 1) throw conflict('payout_voided', 'This payout is already voided.');
      const jobs = await tx.serviceJob.findMany({ where: { paidInPayoutId: found.id }, orderBy: { number: 'asc' }, select: { id: true, number: true } });
      await tx.serviceJob.updateMany({ where: { paidInPayoutId: found.id }, data: { paidInPayoutId: null, updatedAt: now } });
      const parts = await tx.servicePart.updateMany({ where: { paidInPayoutId: found.id }, data: { paidInPayoutId: null } });
      if (jobs.length > 0) {
        await tx.auditLog.createMany({
          data: jobs.map((j) => ({ actorId: actor.id, action: 'service.unpaid', entityType: 'service_job', entityId: j.id, after: { number: j.number, payoutId: found.id }, note: reason })),
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'mechanic.payout.void',
          entityType: 'user',
          entityId: found.mechanicId,
          after: { payoutId: found.id, reason, jobs: jobs.map((j) => j.number), receipts: parts.count },
        },
      });
      return tx.mechanicPayout.findUniqueOrThrow({ where: { id: found.id }, select: PAYOUT });
    });
    return { payout: (await payoutsOut([row]))[0] };
  });

  /**
   * A mechanic's own money (spec, «баланс»): what is owed him now, what waits
   * for approval, what is still in work, what waits for a norm, and his last
   * payouts. Only his — the repairs he carries and the receipts he paid; an
   * owner, who carries none, reads it empty.
   */
  app.get('/api/service/balance', { config: { scope: 'service.work' } }, async (req) => {
    const actor = actorOf(req);
    const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { id: true, name: true, role: true, labourRateTetri: true } });
    const [due, jobs, payouts] = await Promise.all([
      payableFor(prisma, me.id),
      prisma.serviceJob.findMany({
        where: { mechanicId: me.id, paidInPayoutId: null, status: { in: ['draft', 'open', 'done'] } },
        orderBy: [{ openedOn: 'asc' }, { number: 'asc' }],
        select: {
          id: true,
          number: true,
          status: true,
          paidInPayoutId: true,
          works: { select: { qty: true, normSec: true, rateTetri: true, approvedAt: true, rejectedAt: true } },
          parts: { select: { kind: true, approvedAt: true, rejectedAt: true, paidTetri: true, reimburseToId: true } },
        },
      }),
      prisma.mechanicPayout.findMany({ where: { mechanicId: me.id }, orderBy: [{ markedAt: 'desc' }, { id: 'asc' }], take: 20, select: PAYOUT }),
    ]);
    const bucket = (state: PayState) => {
      const list = jobs
        .filter((j) => jobPayState(j) === state)
        .map((j) => {
          const mine = j.parts.filter((p) => p.kind === 'bought' && partLineState(p) !== 'rejected' && p.reimburseToId === me.id);
          return { id: j.id, number: j.number, amountTetri: heldTetri(j) + mine.reduce((n, p) => n + (p.paidTetri ?? 0), 0) };
        });
      return { jobs: list, tetri: list.reduce((n, j) => n + j.amountTetri, 0) };
    };
    return {
      mechanic: { id: me.id, name: me.name, rateTetri: me.labourRateTetri ?? LABOUR_RATE_TETRI },
      payable: due ?? nothingDue(me),
      waiting: bucket('waiting'),
      open: bucket('open'),
      unnormed: { jobs: jobs.filter((j) => jobPayState(j) === 'unnormed').map((j) => ({ id: j.id, number: j.number })) },
      payouts: await payoutsOut(payouts),
    };
  });
}
