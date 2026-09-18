import { todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { hasPerm } from '../lib/auth.js';
import { dateFromISO } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { onHandOf, tillRows } from '../lib/till.js';
import { date, oneOf, str, tetri } from '../lib/validate.js';

// The till (wave 2 §3.4): by person, a manager hands over, an owner accepts
// or says it does not add up, an owner takes cash to the bank.

type Body = Record<string, unknown>;

/** The period as the till reads it: whole days in Tbilisi, today by default. */
function period(q: { from?: string; to?: string }): { from: Date; to: Date; fromISO: string; toISO: string } {
  const today = todayISO(new Date(), env.TZ);
  const fromISO = q.from ?? today;
  const toISO = q.to ?? today;
  // Midnight to midnight in the company's zone; +04:00 all year in Tbilisi.
  return { from: new Date(`${fromISO}T00:00:00+04:00`), to: new Date(`${toISO}T23:59:59.999+04:00`), fromISO, toISO };
}

export function tillRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/till', { config: { scope: 'cash.record' } }, async (req) => {
    const actor = actorOf(req);
    const p = period(req.query);
    const owner = hasPerm(actor, 'payments.reconcile');
    const rows = await tillRows({ from: p.from, to: p.to, userIds: owner ? undefined : [actor.id] });
    // The cash this manager took, one by one — "список принятых наличных".
    const since = new Date(Math.max(p.from.getTime(), 0));
    const mine = await prisma.payment.findMany({
      where: { createdById: actor.id, channel: 'cash', voidedAt: null, createdAt: { gte: since, lte: p.to } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, direction: true, grossTetri: true, createdAt: true, kind: true, customer: { select: { name: true } }, rental: { select: { number: true } }, sale: { select: { number: true } } },
    });
    return {
      from: p.fromISO,
      to: p.toISO,
      owner,
      me: actor.id,
      rows: owner ? rows.filter((r) => r.cashInTetri || r.cashOutTetri || r.handedTetri || r.acceptedTetri || r.bankTetri || r.onHandTetri || r.pendingTetri || r.userId === actor.id) : rows,
      mine: mine.map((m) => ({ id: m.id, direction: m.direction, grossTetri: m.grossTetri, at: m.createdAt.toISOString(), kind: m.kind, customer: m.customer?.name ?? null, number: m.rental?.number ?? m.sale?.number ?? null })),
    };
  });

  /** "Сдал владельцу N": a manager hands over what they have on them, or part of it. */
  app.post<{ Body: Body }>('/api/till/handovers', { config: { scope: 'cash.record' } }, async (req, reply) => {
    const actor = actorOf(req);
    const amount = tetri(req.body ?? {}, 'amountTetri', { required: true, min: 1 })!;
    const onHand = await onHandOf(actor.id);
    if (amount > onHand) throw conflict('over_on_hand', 'More than you have on you cannot be handed over.', { field: 'amountTetri', onHandTetri: onHand });
    const h = await prisma.cashHandover.create({ data: { fromUserId: actor.id, amountTetri: amount }, select: { id: true } });
    await audit({ actorId: actor.id, action: 'till.handover', entityType: 'cash_handover', entityId: h.id, after: { amountTetri: amount } });
    return reply.code(201).send(h);
  });

  /** An owner takes it: counted, it adds up. */
  app.post<{ Params: { id: string } }>('/api/till/handovers/:id/accept', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const done = await prisma.cashHandover.updateMany({
      where: { id: req.params.id, status: 'pending' },
      data: { status: 'accepted', decidedById: actor.id, decidedAt: new Date() },
    });
    if (done.count === 0) throw conflict('handover_decided', 'This hand-over is already decided.');
    await audit({ actorId: actor.id, action: 'till.accept', entityType: 'cash_handover', entityId: req.params.id });
    return { ok: true };
  });

  /** "Не сходится": what was counted, and why — the difference stays the manager's to explain. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/till/handovers/:id/dispute', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const counted = tetri(b, 'countedTetri', { required: true, min: 0 })!;
    const reason = str(b, 'reason', { required: true, max: 500 })!;
    const h = await prisma.cashHandover.findUnique({ where: { id: req.params.id } });
    if (!h) throw notFound('handover_not_found', 'No such hand-over.');
    if (counted >= h.amountTetri) throw badRequest('bad_field', 'What was counted is not less: accept it instead.', { field: 'countedTetri' });
    const done = await prisma.cashHandover.updateMany({
      where: { id: h.id, status: 'pending' },
      data: { status: 'disputed', countedTetri: counted, reason, decidedById: actor.id, decidedAt: new Date() },
    });
    if (done.count === 0) throw conflict('handover_decided', 'This hand-over is already decided.');
    await audit({ actorId: actor.id, action: 'till.dispute', entityType: 'cash_handover', entityId: h.id, before: { amountTetri: h.amountTetri }, after: { countedTetri: counted, shortTetri: h.amountTetri - counted }, note: reason });
    return { ok: true };
  });

  /** "Внёс в банк": out of the owner's till; the statement's cash-deposit line finds it. */
  app.post<{ Body: Body }>('/api/till/bank-deposits', { config: { scope: 'payments.reconcile' } }, async (req, reply) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const amount = tetri(b, 'amountTetri', { required: true, min: 1 })!;
    const bank = oneOf(b, 'bank', ['bog', 'tbc', 'credo'] as const, { required: true })!;
    const occurredOn = date(b, 'occurredOn') ?? todayISO(new Date(), env.TZ);
    const onHand = await onHandOf(actor.id);
    if (amount > onHand) throw conflict('over_on_hand', 'More than you have on you cannot go to the bank.', { field: 'amountTetri', onHandTetri: onHand });
    const d = await prisma.bankCashDeposit.create({ data: { userId: actor.id, amountTetri: amount, bank, occurredOn: dateFromISO(occurredOn)! }, select: { id: true } });
    await audit({ actorId: actor.id, action: 'till.bank_deposit', entityType: 'bank_cash_deposit', entityId: d.id, after: { amountTetri: amount, bank, occurredOn } });
    return reply.code(201).send(d);
  });
}
