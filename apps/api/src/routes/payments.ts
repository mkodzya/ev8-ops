import { acquiringFee, acquiringGross, customerBalance, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { hasPerm } from '../lib/auth.js';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, forbidden } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { recordPayment, voidPayment } from '../lib/payments.js';
import { date, oneOf, str, tetri } from '../lib/validate.js';

// Money in (PAY-04, PAY-05, PAY-06). Statements and automatic matching come
// next; this is the part a person does: cash at the counter, and a transfer
// or card payment an owner enters from the bank.

const CHANNELS = ['transfer', 'acquiring', 'cash'] as const;
type Body = Record<string, unknown>;

export function paymentRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { customerId?: string; rentalId?: string } }>(
    '/api/payments',
    { config: { scope: 'fleet.view' } },
    async (req) => {
      const actor = actorOf(req);
      const scoped = Boolean(req.query.customerId || req.query.rentalId);
      // The whole list is the owners'. A manager sees the cash they took
      // themselves — their till — and the payments on a rental or customer
      // card they have open (redesign §2.1; the till proper is wave 2).
      const mineOnly = !scoped && !hasPerm(actor, 'payments.view');
      const where = {
        ...(req.query.customerId ? { customerId: req.query.customerId } : {}),
        ...(req.query.rentalId ? { rentalId: req.query.rentalId } : {}),
        ...(mineOnly ? { createdById: actor.id, channel: 'cash' as const } : {}),
      };
      const payments = await prisma.payment.findMany({
        where,
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        take: 300,
        include: {
          customer: { select: { id: true, name: true, nameKa: true, nameLat: true } },
          rental: { select: { id: true, number: true } },
          createdBy: { select: { name: true } },
          allocations: { select: { amountTetri: true } },
        },
      });
      return {
        payments: payments.map((p) => ({
          id: p.id,
          occurredOn: isoDate(p.occurredOn),
          channel: p.channel,
          grossTetri: p.grossTetri,
          feeTetri: p.feeTetri,
          netTetri: p.netTetri,
          customer: p.customer,
          rental: p.rental,
          bankText: p.bankText,
          note: p.note,
          source: p.source,
          allocatedTetri: p.allocations.reduce((n, a) => n + a.amountTetri, 0),
          voided: p.voidedAt != null,
          voidReason: p.voidReason,
          createdBy: p.createdBy?.name ?? null,
        })),
      };
    },
  );

  app.post<{ Body: Body }>('/api/payments', { config: { scope: 'cash.record' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const channel = oneOf(b, 'channel', CHANNELS, { required: true })!;
    // A manager takes cash. Anything that arrives through a bank is entered
    // by whoever reconciles the bank (spec §3).
    if (channel !== 'cash' && !hasPerm(actor, 'payments.reconcile')) {
      throw forbidden('reconcile_required', 'Only an owner enters bank payments.');
    }

    // For acquiring either figure may be the one at hand: the counter knows
    // the gross the customer paid, a statement line knows the net credited.
    const gross = tetri(b, 'grossTetri', { min: 1 });
    const net = tetri(b, 'netTetri', { min: 1 });
    if (gross == null && net == null) throw badRequest('missing_field', 'grossTetri or netTetri is required', { field: 'grossTetri' });
    let grossTetri: number;
    let feeTetri: number;
    if (channel === 'acquiring') {
      if (gross != null) {
        grossTetri = gross;
        feeTetri = acquiringFee(gross);
      } else {
        const recovered = acquiringGross(net!);
        if (recovered == null) throw badRequest('bad_field', 'That net does not come from a whole-tetri gross.', { field: 'netTetri' });
        grossTetri = recovered;
        feeTetri = recovered - net!;
      }
    } else {
      grossTetri = gross ?? net!;
      feeTetri = 0;
    }

    const result = await recordPayment({
      actorId: actor.id,
      occurredOn: date(b, 'occurredOn') ?? todayISO(new Date(), env.TZ),
      channel,
      grossTetri,
      feeTetri,
      customerId: str(b, 'customerId'),
      rentalId: str(b, 'rentalId'),
      bankText: str(b, 'bankText', { max: 500 }),
      note: str(b, 'note', { max: 1000 }),
      source: 'manual',
    });
    return reply.code(201).send(result);
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/payments/:id/void', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const reason = str(req.body ?? {}, 'reason', { required: true, max: 1000 })!;
    await voidPayment({ actorId: actor.id, paymentId: req.params.id, reason });
    return { ok: true };
  });

  /** What a customer owes, has paid, and what we hold for them (PAY-06). */
  app.get<{ Params: { id: string } }>('/api/customers/:id/balance', { config: { scope: 'fleet.view' } }, async (req) => {
    const rentals = await prisma.rental.findMany({
      where: { customerId: req.params.id },
      select: {
        status: true,
        periods: { select: { amountTetri: true, paidTetri: true } },
        deposit: { select: { amountTetri: true, paidTetri: true, status: true } },
      },
    });
    const sales = await prisma.sale.findMany({
      where: { customerId: req.params.id, status: { not: 'cancelled' } },
      select: { instalments: { select: { amountTetri: true, paidTetri: true } } },
    });
    const paid = await prisma.payment.aggregate({
      where: { customerId: req.params.id, voidedAt: null, direction: 'in' },
      _sum: { grossTetri: true },
    });
    const balance = customerBalance({
      periods: rentals.flatMap((r) => r.periods),
      instalments: sales.flatMap((s) => s.instalments),
      deposits: rentals.flatMap((r) => (r.deposit ? [{ ...r.deposit, held: r.deposit.status === 'held' }] : [])),
      paidTetri: paid._sum.grossTetri ?? 0,
    });
    return balance;
  });
}

export { conflict };
