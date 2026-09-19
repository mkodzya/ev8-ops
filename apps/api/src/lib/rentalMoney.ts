import { spreadOverOwed, spreadPayment, type Allocation, type Spread } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';

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

/** The deposit (while the rental runs), the weeks, then the charges. */
export function spreadRental(amountTetri: number, owed: RentalOwed, opts: { deposit?: boolean } = {}): Spread {
  const first = spreadPayment(amountTetri, owed.periods, opts.deposit === false ? null : owed.deposit);
  const rest = spreadOverOwed(first.leftoverTetri, owed.charges, 'charge');
  return { allocations: [...first.allocations, ...rest.allocations], leftoverTetri: rest.leftoverTetri };
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
