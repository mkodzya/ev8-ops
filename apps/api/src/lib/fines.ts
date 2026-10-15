import { prisma } from './db.js';
import { badRequest, conflict, notFound } from './errors.js';

/**
 * A fine on a rental (Mika, 15.10.2026, ADR-0023): damage, a dirty moped —
 * an amount an owner charges with a reason, while the rental runs. Until now
 * a charge came only with a return (a key, days of delay, what the deposit
 * did not cover). A fine is a charge like those: it is part of the
 * customer's debt, a payment to the rental reaches it after the weeks, and
 * "Разделить" can put a part of a bank line on it alone.
 *
 * A fine nobody has paid can be taken back, with a reason; a paid one stays —
 * void its payment first.
 */
export async function addFine(input: { actorId: string; rentalId: string; amountTetri: number; reason: string | null }): Promise<{ id: string }> {
  if (!Number.isInteger(input.amountTetri) || input.amountTetri <= 0) throw badRequest('bad_field', 'A fine is a sum above zero.', { field: 'amountTetri' });
  if (!input.reason) throw badRequest('missing_field', 'Say what the fine is for.', { field: 'reason' });
  return prisma.$transaction(async (tx) => {
    const rental = await tx.rental.findUnique({ where: { id: input.rentalId }, select: { id: true } });
    if (!rental) throw notFound('rental_not_found', 'No such rental.');
    const charge = await tx.rentalCharge.create({ data: { rentalId: rental.id, kind: 'fine', amountTetri: input.amountTetri, note: input.reason, createdById: input.actorId }, select: { id: true } });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'rental.charge.add',
        entityType: 'rental',
        entityId: rental.id,
        after: { chargeId: charge.id, kind: 'fine', amountTetri: input.amountTetri },
        note: input.reason,
      },
    });
    return charge;
  });
}

export async function voidFine(input: { actorId: string; rentalId: string; chargeId: string; reason: string | null }): Promise<void> {
  if (!input.reason) throw badRequest('missing_field', 'Say why the fine is taken back.', { field: 'reason' });
  await prisma.$transaction(async (tx) => {
    const c = await tx.rentalCharge.findUnique({
      where: { id: input.chargeId },
      include: { allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } },
    });
    if (!c || c.rentalId !== input.rentalId || c.kind !== 'fine' || c.voidedAt) throw notFound('charge_not_found', 'No such fine on the rental.');
    if (c.allocations.length > 0) throw conflict('fine_paid', 'Money has gone on this fine: take that payment back first.');
    await tx.rentalCharge.update({ where: { id: c.id }, data: { voidedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'rental.charge.void',
        entityType: 'rental',
        entityId: input.rentalId,
        before: { chargeId: c.id, kind: c.kind, amountTetri: c.amountTetri },
        note: input.reason,
      },
    });
  });
}
