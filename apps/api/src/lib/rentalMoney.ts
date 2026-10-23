import { spreadRentalOwed, type Allocation, type RentalMoney, type Spread } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { isoDate } from './dates.js';

// What a rental's money can close, in the one order the rules give (PAY-02,
// wave 3 §3.7): the deposit first while the rental runs, then the weeks from
// the oldest, then what a return charged — a key, days of delay, what was
// kept. After the return the deposit is the decision's, not a debt, and a
// payment does not go to it (B5-08).

type Tx = Prisma.TransactionClient;

export interface RentalOwed {
  rentalId: string;
  returned: boolean;
  deposit: { id: string; amountTetri: number; paidTetri: number } | null;
  periods: { id: string; seq: number; amountTetri: number; paidTetri: number; startsOn: Date; endsOn: Date }[];
  charges: { id: string; seq: number; amountTetri: number; paidTetri: number; kind: string }[];
}

export async function rentalOwed(tx: Tx, rentalId: string): Promise<RentalOwed> {
  const [rental, periods, deposit, charges] = await Promise.all([
    tx.rental.findUnique({ where: { id: rentalId }, select: { status: true } }),
    tx.rentalPeriod.findMany({ where: { rentalId }, orderBy: { seq: 'asc' } }),
    tx.deposit.findUnique({ where: { rentalId } }),
    tx.rentalCharge.findMany({
      where: { rentalId, voidedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } },
    }),
  ]);
  const returned = rental?.status === 'returned';
  return {
    rentalId,
    returned,
    deposit: deposit && !returned ? { id: deposit.id, amountTetri: deposit.amountTetri, paidTetri: deposit.paidTetri } : null,
    periods: periods.map((p) => ({ id: p.id, seq: p.seq, amountTetri: p.amountTetri, paidTetri: p.paidTetri, startsOn: p.startsOn, endsOn: p.endsOn })),
    charges: charges.map((c, i) => ({ id: c.id, seq: i + 1, kind: c.kind, amountTetri: c.amountTetri, paidTetri: c.allocations.reduce((n, a) => n + a.amountTetri, 0) })),
  };
}

/** The deposit (while the rental runs), the weeks, then the charges — the one order, in shared. */
export function spreadRental(amountTetri: number, owed: RentalOwed, opts: { deposit?: boolean } = {}): Spread {
  return spreadRentalOwed(amountTetri, owed, opts);
}

/**
 * The payments whose money not yet placed `settleCredit` lays on a rental:
 * this rental's, then the customer's tied to no rental — rent and money on
 * account only (B2-08), in, not voided.
 */
export function creditPaymentsWhere(rentalId: string, customerId: string): Prisma.PaymentWhereInput {
  return {
    voidedAt: null,
    direction: 'in',
    kind: { in: ['rent', 'on_account'] },
    OR: [{ rentalId }, { customerId, rentalId: null }],
  };
}

/**
 * A running rental's money as one picture (shared `RentalMoney`): its weeks
 * and deposit with whose payment closed what, its charges, and the payments
 * `settleCredit` would read, oldest first, with what of each is not placed —
 * here or anywhere. The sheet of a correction shows from it what will happen
 * (ADR-0044); the correction then writes it the usual way.
 */
export async function rentalMoneyOf(tx: Tx, rental: { id: string; customerId: string; status: string }): Promise<RentalMoney> {
  const live = { where: { payment: { voidedAt: null } } };
  const [periods, deposit, charges, payments] = await Promise.all([
    tx.rentalPeriod.findMany({
      where: { rentalId: rental.id },
      orderBy: { seq: 'asc' },
      include: { allocations: { ...live, orderBy: { createdAt: 'asc' }, select: { id: true, paymentId: true, amountTetri: true } } },
    }),
    tx.deposit.findUnique({
      where: { rentalId: rental.id },
      include: { allocations: { ...live, select: { id: true, paymentId: true, amountTetri: true, createdAt: true, payment: { select: { occurredOn: true, createdAt: true } } } } },
    }),
    tx.rentalCharge.findMany({
      where: { rentalId: rental.id, voidedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { allocations: { ...live, select: { id: true, paymentId: true, amountTetri: true } } },
    }),
    tx.payment.findMany({
      where: creditPaymentsWhere(rental.id, rental.customerId),
      orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, grossTetri: true, allocations: { select: { amountTetri: true } } },
    }),
  ]);
  // The deposit's parts in the order their payments came: a correction frees the oldest first.
  const at = (d: Date) => d.getTime();
  const depositParts = [...(deposit?.allocations ?? [])].sort(
    (a, b) => at(a.payment.occurredOn) - at(b.payment.occurredOn) || at(a.payment.createdAt) - at(b.payment.createdAt) || at(a.createdAt) - at(b.createdAt),
  );
  const part = (a: { id: string; paymentId: string; amountTetri: number }) => ({ id: a.id, paymentId: a.paymentId, amountTetri: a.amountTetri });
  return {
    weeks: periods.map((p) => ({
      id: p.id,
      seq: p.seq,
      startsOn: isoDate(p.startsOn)!,
      endsOn: isoDate(p.endsOn)!,
      amountTetri: p.amountTetri,
      paidBeforeTransfer: p.paidBeforeTransfer,
      parts: p.allocations.map(part),
    })),
    // After the return the deposit is the decision's, not a debt (B5-08), as `rentalOwed` has it.
    deposit:
      deposit && rental.status !== 'returned'
        ? { id: deposit.id, amountTetri: deposit.amountTetri, receivedBeforeTetri: deposit.receivedBeforeTransferTetri, parts: depositParts.map(part) }
        : null,
    charges: charges.map((c) => ({ id: c.id, amountTetri: c.amountTetri, parts: c.allocations.map(part) })),
    credit: payments.map((p) => ({ id: p.id, creditTetri: p.grossTetri - p.allocations.reduce((n, a) => n + a.amountTetri, 0) })),
  };
}

export async function writeAllocations(tx: Tx, paymentId: string, allocations: Allocation[]): Promise<void> {
  for (const a of allocations) {
    await tx.paymentAllocation.create({
      data: {
        paymentId,
        target: a.target,
        periodId: a.target === 'period' ? a.id : null,
        depositId: a.target === 'deposit' ? a.id : null,
        instalmentId: a.target === 'instalment' ? a.id : null,
        chargeId: a.target === 'charge' ? a.id : null,
        amountTetri: a.amountTetri,
      },
    });
  }
}

/**
 * The deposit's own figures, kept in step with its rows: what was kept is the
 * sum of the live withholdings (B5-04) — a repair's and a return's side by side.
 */
export async function syncDeposit(tx: Tx, depositId: string): Promise<void> {
  const rows = await tx.depositWithholding.findMany({ where: { depositId, voidedAt: null } });
  const withheld = rows.reduce((n, r) => n + r.amountTetri, 0);
  await tx.deposit.update({
    where: { id: depositId },
    data: {
      withheldTetri: withheld,
      withheldGrounds: [...new Set(rows.flatMap((r) => r.grounds))],
      withheldReason: rows.map((r) => r.reason).join('; ').slice(0, 1000) || null,
      updatedAt: new Date(),
    },
  });
}
