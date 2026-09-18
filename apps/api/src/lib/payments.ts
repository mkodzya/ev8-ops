import { paidThrough, spreadOverOwed, type PeriodPayStatus } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { dateFromISO, isoDate } from './dates.js';
import { rentalOwed, spreadRental, writeAllocations } from './rentalMoney.js';
import { prisma } from './db.js';
import { conflict, notFound } from './errors.js';

type Tx = Prisma.TransactionClient;

/** The same, for a sale: each instalment's paid amount and status. */
export async function recomputeSale(tx: Tx, saleId: string): Promise<void> {
  const instalments = await tx.saleInstalment.findMany({
    where: { saleId },
    include: { allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } },
  });
  for (const i of instalments) {
    const paid = i.allocations.reduce((n, a) => n + a.amountTetri, 0);
    const payStatus: PeriodPayStatus = paid <= 0 ? 'unpaid' : paid >= i.amountTetri ? 'paid' : 'partial';
    if (paid !== i.paidTetri || payStatus !== i.payStatus) {
      await tx.saleInstalment.update({ where: { id: i.id }, data: { paidTetri: paid, payStatus, updatedAt: new Date() } });
    }
  }
}

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
    // A week brought over as paid before the transfer is paid without a payment (B3-02, Q3).
    const paid = p.paidBeforeTransfer ? p.amountTetri : p.allocations.reduce((n, a) => n + a.amountTetri, 0);
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
    const paid = deposit.receivedBeforeTransferTetri + deposit.allocations.reduce((n, a) => n + a.amountTetri, 0);
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
  saleId?: string | null;
  bankText: string | null;
  note: string | null;
  source: 'manual' | 'statement' | 'log';
  /** Defaults from the links: a sale → sale, a rental → rent, else on account. */
  kind?: 'rent' | 'sale' | 'on_account';
  /** The statement line this payment is, set in the same transaction (B2-02). */
  statementLineId?: string | null;
  backdateReason?: string | null;
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
  return prisma.$transaction((tx) => recordPaymentTx(tx, input));
}

/** The same, inside a transaction the caller holds — a statement line and its payment go in together. */
export async function recordPaymentTx(tx: Tx, input: RecordPaymentInput): Promise<{ id: string; allocated: number; leftover: number }> {
  if (input.rentalId) {
    const r = await tx.rental.findUnique({ where: { id: input.rentalId }, select: { id: true, customerId: true } });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    if (input.customerId && input.customerId !== r.customerId) {
      throw conflict('customer_mismatch', 'That rental belongs to a different customer.');
    }
    input.customerId = r.customerId;
  }
  if (input.saleId) {
    const sale = await tx.sale.findUnique({ where: { id: input.saleId }, select: { customerId: true } });
    if (!sale) throw notFound('sale_not_found', 'No such sale.');
    input.customerId = sale.customerId;
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
      saleId: input.saleId ?? null,
      bankText: input.bankText,
      note: input.note,
      source: input.source,
      createdById: input.actorId,
      kind: input.kind ?? (input.saleId ? 'sale' : input.rentalId ? 'rent' : 'on_account'),
      statementLineId: input.statementLineId ?? null,
      backdateReason: input.backdateReason ?? null,
    },
  });

  // A payment made for a sale settles that sale's schedule and nothing
  // else: rent and a purchase are different debts.
  if (input.saleId) {
    const instalments = await tx.saleInstalment.findMany({ where: { saleId: input.saleId }, orderBy: { seq: 'asc' } });
    const spread = spreadOverOwed(
      input.grossTetri,
      instalments.map((i) => ({ id: i.id, seq: i.seq, amountTetri: i.amountTetri, paidTetri: i.paidTetri })),
      'instalment',
    );
    for (const a of spread.allocations) {
      await tx.paymentAllocation.create({
        data: { paymentId: payment.id, target: 'instalment', instalmentId: a.id, amountTetri: a.amountTetri },
      });
    }
    await recomputeSale(tx, input.saleId);
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'payment.record',
        entityType: 'payment',
        entityId: payment.id,
        after: { occurredOn: input.occurredOn, channel: input.channel, grossTetri: input.grossTetri, saleId: input.saleId, allocated: input.grossTetri - spread.leftoverTetri },
      },
    });
    return { id: payment.id, allocated: input.grossTetri - spread.leftoverTetri, leftover: spread.leftoverTetri };
  }

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
    const spread = spreadRental(left, await rentalOwed(tx, id));
    await writeAllocations(tx, payment.id, spread.allocations);
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
}

/** A payment entered by mistake. Nothing is deleted: it is voided with a reason. */
export async function voidPayment(input: { actorId: string; paymentId: string; reason: string; kind?: 'void' | 'undo' }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({
      where: { id: input.paymentId },
      include: {
        allocations: {
          select: { target: true, amountTetri: true, periodId: true, instalmentId: true, deposit: { select: { rentalId: true } }, period: { select: { seq: true, startsOn: true, endsOn: true } }, instalment: { select: { seq: true } } },
        },
      },
    });
    if (!p) throw notFound('payment_not_found', 'No such payment.');
    if (p.voidedAt) throw conflict('already_voided', 'This payment is already void.');

    const touched = new Set<string>();
    for (const a of p.allocations) {
      if (a.deposit?.rentalId) touched.add(a.deposit.rentalId);
    }
    const saleIds = new Set<string>();
    if (p.saleId) saleIds.add(p.saleId);
    const instalmentIds = p.allocations.map((a) => a.instalmentId).filter((id): id is string => !!id);
    if (instalmentIds.length > 0) {
      for (const i of await tx.saleInstalment.findMany({ where: { id: { in: instalmentIds } }, select: { saleId: true } })) {
        saleIds.add(i.saleId);
      }
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
      data: { voidedAt: new Date(), voidReason: input.reason, voidedById: input.actorId, voidKind: input.kind ?? 'void' },
    });
    // The bank line this payment was goes back to the queue, to be attached
    // to the right record (B2-07).
    if (p.statementLineId) {
      await tx.statementLine.update({
        where: { id: p.statementLineId },
        data: { status: 'unmatched', matchedRule: null, paymentId: null, resolution: null, resolutionReason: null },
      });
    }
    for (const rentalId of touched) await recomputeRental(tx, rentalId);
    for (const saleId of saleIds) await recomputeSale(tx, saleId);

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.kind === 'undo' ? 'payment.undo' : 'payment.void',
        entityType: 'payment',
        entityId: p.id,
        // What it closed stays in the journal after the allocations are gone.
        before: {
          grossTetri: p.grossTetri,
          channel: p.channel,
          kind: p.kind,
          rentalId: p.rentalId,
          saleId: p.saleId,
          statementLineId: p.statementLineId,
          closed: p.allocations.map((a) => ({
            target: a.target,
            amountTetri: a.amountTetri,
            seq: a.period?.seq ?? a.instalment?.seq ?? null,
            startsOn: a.period ? isoDate(a.period.startsOn) : null,
            endsOn: a.period ? isoDate(a.period.endsOn) : null,
          })),
        },
        note: input.reason,
      },
    });
  });
}
