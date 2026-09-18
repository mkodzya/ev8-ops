import { periodsThrough, todayISO } from '@ev8/shared';
import { audit } from './audit.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { recomputeRental } from './payments.js';
import { rentalOwed, spreadRental, writeAllocations } from './rentalMoney.js';

// The nightly job (RNT-02, PAY-06), and the reason it lives in the API
// rather than in the worker: the worker is the clock, this is the brain.
// Rolling a week forward and settling a customer's credit against it are
// money rules, and there is one copy of those.

/**
 * Money a customer has paid that no period or deposit has taken yet.
 *
 * It is not an anomaly: the first payment of a rental is often rent plus
 * deposit plus a bit, and a customer who pays two weeks in one go is ahead
 * until the second week exists. The spec says that money goes onto the next
 * period by itself (PAY-06), so this is how it gets there.
 */
export async function settleCredit(rentalId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const rental = await tx.rental.findUnique({ where: { id: rentalId }, select: { id: true, customerId: true } });
    if (!rental) return 0;

    // Payments of this rental first, then the customer's payments that were
    // never tied to a rental. Oldest first, the order a debt is paid off in.
    const payments = await tx.payment.findMany({
      where: {
        voidedAt: null,
        direction: 'in',
        // A sale's or a repair's payment is that record's own: it never pays
        // rent, however much of it is left over (B2-08).
        kind: { in: ['rent', 'on_account'] },
        OR: [{ rentalId }, { customerId: rental.customerId, rentalId: null }],
      },
      orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
      include: { allocations: { select: { amountTetri: true } } },
    });

    let placed = 0;
    for (const p of payments) {
      const credit = p.grossTetri - p.allocations.reduce((n, a) => n + a.amountTetri, 0);
      if (credit <= 0) continue;

      const spread = spreadRental(credit, await rentalOwed(tx, rentalId));
      if (spread.allocations.length === 0) continue;
      await writeAllocations(tx, p.id, spread.allocations);
      placed += spread.allocations.reduce((n, a) => n + a.amountTetri, 0);
      await recomputeRental(tx, rentalId);
    }
    return placed;
  });
}

export interface RollResult {
  rentals: number;
  created: number;
  settledTetri: number;
  repaired: number;
}

/**
 * `paidThrough` on a rental and `payStatus` on a week are the two derived
 * facts this system does store, and stored derived facts drift — an
 * allocation removed by hand, a repair, a restore from a dump. Recomputing
 * them from the allocations is idempotent and costs one pass over a rental's
 * own weeks, so the nightly job is where the drift dies rather than becoming
 * a number nobody can explain. Every rental, not only the open ones: a
 * disputed or returned rental's figure is read on its card just the same.
 */
async function repairDerived(): Promise<number> {
  const all = await prisma.rental.findMany({ where: { pickedUpOn: { not: null } }, select: { id: true } });
  let repaired = 0;
  for (const r of all) {
    await prisma.$transaction(async (tx) => {
      await recomputeRental(tx, r.id);
    });
    repaired++;
  }
  return repaired;
}

/**
 * Open every week that should exist by `asOf`, then let any credit pay for
 * it. Idempotent: a period that is already there is left alone, so this can
 * run as often as it likes.
 */
export async function rollPeriods(asOf: string = todayISO(new Date(), env.TZ)): Promise<RollResult> {
  const open = await prisma.rental.findMany({
    where: { status: { in: ['active', 'overdue'] }, pickedUpOn: { not: null }, returnedOn: null },
    select: { id: true, pickedUpOn: true, weeklyRateTetri: true, periods: { select: { seq: true } } },
  });

  let created = 0;
  let settledTetri = 0;
  for (const r of open) {
    const have = new Set(r.periods.map((p) => p.seq));
    const wanted = periodsThrough(isoDate(r.pickedUpOn)!, asOf);
    let added = 0;
    for (const p of wanted) {
      if (have.has(p.seq)) continue;
      await prisma.rentalPeriod.create({
        data: {
          rentalId: r.id,
          seq: p.seq,
          startsOn: dateFromISO(p.startsOn)!,
          endsOn: dateFromISO(p.endsOn)!,
          amountTetri: r.weeklyRateTetri,
        },
      });
      added++;
    }
    created += added;
    // Even with no new week, a correction elsewhere may have freed credit.
    settledTetri += await settleCredit(r.id);
  }
  const repaired = await repairDerived();
  if (created > 0 || settledTetri > 0) {
    await audit({
      actorId: null,
      action: 'periods.roll',
      entityType: 'rental',
      entityId: null,
      after: { asOf, rentals: open.length, created, settledTetri },
    });
  }
  return { rentals: open.length, created, settledTetri, repaired };
}
