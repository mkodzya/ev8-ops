import { isoDate } from './dates.js';
import { prisma } from './db.js';
import { badRequest, conflict, notFound } from './errors.js';
import { recomputeRental } from './payments.js';

/**
 * An owner takes an amount off one rental week, with a reason (meeting of
 * Mika and Kardu, 14.10.2026: the moped stood a day in the workshop, the
 * customer paid 125 for a 150 week). The week's price becomes the full price
 * less the discount, and everything that reads the price — the debt, the
 * calendar, "paid through" — follows by itself. A discount is set, not added:
 * a second one replaces the first, and nought takes it away.
 *
 * Only the unpaid part of a week can be taken off: money already placed on
 * the week stays where it is. A week brought over as paid before the
 * transfer has no unpaid part.
 */
export async function discountWeek(input: { actorId: string; rentalId: string; seq: number; discountTetri: number; reason: string | null }): Promise<{ amountTetri: number }> {
  return prisma.$transaction(async (tx) => {
    const week = await tx.rentalPeriod.findUnique({ where: { rentalId_seq: { rentalId: input.rentalId, seq: input.seq } } });
    if (!week) throw notFound('week_not_found', 'No such week in this rental.');
    if (week.paidBeforeTransfer) throw conflict('week_paid_before_transfer', 'This week was paid before the rental was carried over.');
    const full = week.amountTetri + week.discountTetri;
    if (input.discountTetri > full) throw conflict('discount_over_week', 'A discount cannot be more than the week.', { fullTetri: full });
    const amount = full - input.discountTetri;
    if (amount < week.paidTetri) throw conflict('discount_over_paid', 'That much of the week is paid already.', { paidTetri: week.paidTetri, fullTetri: full });
    if (input.discountTetri > 0 && !input.reason) throw badRequest('missing_field', 'Say why the week is cheaper.', { field: 'reason' });

    await tx.rentalPeriod.update({
      where: { id: week.id },
      data: {
        amountTetri: amount,
        discountTetri: input.discountTetri,
        discountReason: input.discountTetri > 0 ? input.reason : null,
        discountedById: input.discountTetri > 0 ? input.actorId : null,
        discountedAt: input.discountTetri > 0 ? new Date() : null,
        updatedAt: new Date(),
      },
    });
    await recomputeRental(tx, input.rentalId);
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'rental.week.discount',
        entityType: 'rental',
        entityId: input.rentalId,
        before: { seq: week.seq, startsOn: isoDate(week.startsOn), amountTetri: week.amountTetri, discountTetri: week.discountTetri },
        after: { seq: week.seq, startsOn: isoDate(week.startsOn), amountTetri: amount, discountTetri: input.discountTetri },
        note: input.reason,
      },
    });
    return { amountTetri: amount };
  });
}
