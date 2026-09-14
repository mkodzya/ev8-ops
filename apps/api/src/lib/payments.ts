import { paidThrough, spreadPayment, type PeriodPayStatus } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { conflict, notFound } from './errors.js';

type Tx = Prisma.TransactionClient;

/**
 * Re-derive everything a rental's money says about it: each period's paid
 * amount and status, and the rental's "paid through" date.
 *
 * Derived, never stored by hand. A payment can be added, corrected or
 * voided, and the answer has to come out the same either way — which it
 * only does if there is one place that works it out.
 */
export async function recomputeRental(tx: Tx, rentalId: string): Promise<void> {
  const periods = await tx.rentalPeriod.findMany({
    where: { rentalId },
    orderBy: { seq: 'asc' },
    include: { allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } },
  });
  const rows: { seq: number; endsOn: string; payStatus: PeriodPayStatus }[] = [];
  for (const p of periods) {
    const paid = p.allocations.reduce((n, a) => n + a.amountTetri, 0);
    const payStatus: PeriodPayStatus = paid <= 0 ? 'unpaid' : paid >= p.amountTetri ? 'paid' : 'partial';
    if (paid !== p.paidTetri || payStatus !== p.payStatus) {
      await tx.rentalPeriod.update({ where: { id: p.id }, data: { paidTetri: paid, payStatus, updatedAt: new Date() } });
    }
    rows.push({ seq: p.seq, endsOn: isoDate(p.endsOn)!, payStatus });
  }
  const deposit = await tx.deposit.findUnique({
    where: { rentalId },
    include: { allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } },
  });
  if (deposit) {
    const paid = deposit.allocations.reduce((n, a) => n + a.amountTetri, 0);
    if (paid !== deposit.paidTetri) {
      await tx.deposit.update({ where: { id: deposit.id }, data: { paidTetri: paid, updatedAt: new Date() } });
    }
  }
  const through = paidThrough(rows);
  await tx.rental.update({ where: { id: rentalId }, data: { paidThrough: dateFromISO(through), updatedAt: new Date() } });
}

export interface RecordPaymentInput {
  actorId: string;
  occurredOn: string;
  channel: 'transfer' | 'acquiring' | 'cash';
  /** What the customer handed over. One of gross or net is given; see the route. */
  grossTetri: number;
  feeTetri: number;
  customerId: string | null;
  rentalId: string | null;
  bankText: string | null;
  note: string | null;
  source: 'manual' | 'statement' | 'log';
}

/**
 * Record a payment and let it close what it can.
 *
 * A payment tied to a rental is spread over that rental's deposit and
 * periods, oldest first. A payment tied only to a customer is spread over
 * their open rentals in the same order. What it cannot place stays as the
 * customer's credit and lands on the next period the worker creates.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<{ id: string; allocated: number; leftover: number }> {
  return prisma.$transaction(async (tx) => {
    if (input.rentalId) {
      const r = await tx.rental.findUnique({ where: { id: input.rentalId }, select: { id: true, customerId: true } });
      if (!r) throw notFound('rental_not_found', 'No such rental.');
      if (input.customerId && input.customerId !== r.customerId) {
        throw conflict('customer_mismatch', 'That rental belongs to a different customer.');
      }
      input.customerId = r.customerId;
    }
    const payment = await tx.payment.create({
      data: {
        occurredOn: dateFromISO(input.occurredOn)!,
        direction: 'in',
        channel: input.channel,
        grossTetri: input.grossTetri,
        feeTetri: input.feeTetri,
        netTetri: input.grossTetri - input.feeTetri,
        customerId: input.customerId,
        rentalId: input.rentalId,
        bankText: input.bankText,
        note: input.note,
        source: input.source,
        createdById: input.actorId,
      },
    });

    const rentalIds = input.rentalId
      ? [input.rentalId]
      : input.customerId
        ? (
            await tx.rental.findMany({
              where: { customerId: input.customerId, status: { in: ['booked', 'active', 'overdue', 'paused', 'disputed'] } },
              orderBy: { pickedUpOn: 'asc' },
              select: { id: true },
            })
          ).map((r) => r.id)
        : [];

    let left = input.grossTetri;
    for (const id of rentalIds) {
      if (left <= 0) break;
      const periods = await tx.rentalPeriod.findMany({ where: { rentalId: id }, orderBy: { seq: 'asc' } });
      const deposit = await tx.deposit.findUnique({ where: { rentalId: id } });
      const spread = spreadPayment(
        left,
        periods.map((p) => ({ id: p.id, seq: p.seq, amountTetri: p.amountTetri, paidTetri: p.paidTetri })),
        deposit ? { id: deposit.id, amountTetri: deposit.amountTetri, paidTetri: deposit.paidTetri } : null,
      );
      for (const a of spread.allocations) {
        await tx.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            target: a.target,
            periodId: a.target === 'period' ? a.id : null,
            depositId: a.target === 'deposit' ? a.id : null,
            amountTetri: a.amountTetri,
          },
        });
      }
      left = spread.leftoverTetri;
      await recomputeRental(tx, id);
    }

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'payment.record',
        entityType: 'payment',
        entityId: payment.id,
        after: {
          occurredOn: input.occurredOn,
          channel: input.channel,
          grossTetri: input.grossTetri,
          feeTetri: input.feeTetri,
          customerId: input.customerId,
          rentalId: input.rentalId,
          allocated: input.grossTetri - left,
        },
      },
    });
    return { id: payment.id, allocated: input.grossTetri - left, leftover: left };
  });
}

/** A payment entered by mistake. Nothing is deleted: it is voided with a reason. */
export async function voidPayment(input: { actorId: string; paymentId: string; reason: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({
      where: { id: input.paymentId },
      include: { allocations: { select: { periodId: true, deposit: { select: { rentalId: true } } } } },
    });
    if (!p) throw notFound('payment_not_found', 'No such payment.');
    if (p.voidedAt) throw conflict('already_voided', 'This payment is already void.');

    const touched = new Set<string>();
    for (const a of p.allocations) {
      if (a.deposit?.rentalId) touched.add(a.deposit.rentalId);
    }
    const periodIds = p.allocations.map((a) => a.periodId).filter((id): id is string => !!id);
    if (periodIds.length > 0) {
      for (const r of await tx.rentalPeriod.findMany({ where: { id: { in: periodIds } }, select: { rentalId: true } })) {
        touched.add(r.rentalId);
      }
    }
    if (p.rentalId) touched.add(p.rentalId);

    await tx.paymentAllocation.deleteMany({ where: { paymentId: p.id } });
    await tx.payment.update({
      where: { id: p.id },
      data: { voidedAt: new Date(), voidReason: input.reason, voidedById: input.actorId },
    });
    for (const rentalId of touched) await recomputeRental(tx, rentalId);

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'payment.void',
        entityType: 'payment',
        entityId: p.id,
        before: { grossTetri: p.grossTetri, channel: p.channel, rentalId: p.rentalId },
        note: input.reason,
      },
    });
  });
}
