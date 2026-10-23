import { depositBeforePlan, depositPaidTetri, moneyChange, settleMoney, type MoneyChange } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { isoDate } from './dates.js';
import { prisma } from './db.js';
import { badRequest, conflict, notFound } from './errors.js';
import { recomputeRental } from './payments.js';
import { settleCredit } from './periods.js';
import { payOffsetOf } from './rentState.js';
import { rentalMoneyOf } from './rentalMoney.js';

type Tx = Prisma.TransactionClient;

// «Залог получен раньше» on an open rental (issue #10 of the director, Mika's
// «А» of 23.10.2026; ADR-0044 §2). Until now only a rental carried over could
// say its deposit came before EV8 Ops (`transfer.depositReceivedTetri`). An
// owner now sets it on any open rental, with a reason, and takes it off the
// same way. It is no money: no payment, nothing in «Пришло денег», the till or
// what the bank is expected to bring — the deposit's received figure counts it,
// as it counts a carried-over one, and the return hands it back. What payments
// put on the deposit beyond its sum is freed, oldest first, and the one order
// places it on the weeks (`settleCredit`); taken off, the deposit is owed
// again and closes first, as the order says.

export interface DepositBeforeInput {
  rentalId: string;
  /** What came before EV8 Ops; 0 — the mark taken off. */
  receivedBeforeTetri: number;
  today: string;
}

/** Everything the mark is, worked out without writing: the preview's answer and the write's plan alike. */
async function study(tx: Tx, input: DepositBeforeInput) {
  const r = await tx.rental.findUnique({
    where: { id: input.rentalId },
    select: {
      id: true,
      customerId: true,
      status: true,
      pickedUpOn: true,
      payWeekday: true,
      weekShiftDays: true,
      deposit: {
        select: {
          id: true,
          amountTetri: true,
          status: true,
          receivedBeforeTransferTetri: true,
          paidOutBeforeTetri: true,
          migrationDecision: true,
          withholdings: { where: { voidedAt: null }, select: { amountTetri: true } },
          payouts: { where: { voidedAt: null }, select: { grossTetri: true } },
        },
      },
    },
  });
  if (!r) throw notFound('rental_not_found', 'No such rental.');
  // After the return the deposit is the decision's (B5-08): what it held is decided there.
  if (r.status === 'returned') throw conflict('already_returned', 'This rental is already closed.');
  const d = r.deposit;
  if (!d) throw notFound('deposit_not_found', 'No deposit on this rental.');
  if (d.migrationDecision || d.status !== 'held') throw conflict('deposit_decided', 'This deposit is already decided.');
  const x = input.receivedBeforeTetri;
  if (x > d.amountTetri) throw badRequest('deposit_before_over', 'More received earlier than the deposit is.', { field: 'receivedBeforeTetri', amountTetri: d.amountTetri });
  if (x === d.receivedBeforeTransferTetri) throw badRequest('deposit_before_same', 'The deposit already says this much was received earlier.', { field: 'receivedBeforeTetri' });

  const was = await rentalMoneyOf(tx, r);
  const plan = depositBeforePlan(was, x);
  const after = settleMoney(plan.money);
  // What a repair kept from the deposit, and what went back from it, stay
  // covered: the deposit is never made to hold less than they took (B5-04).
  const takenTetri = d.withholdings.reduce((n, w) => n + w.amountTetri, 0) + d.paidOutBeforeTetri + d.payouts.reduce((n, p) => n + p.grossTetri, 0);
  if (depositPaidTetri(after.deposit!) < takenTetri) {
    throw conflict('deposit_before_held', 'The deposit would hold less than was already kept from it.', { field: 'receivedBeforeTetri', keptTetri: takenTetri });
  }
  const offset = payOffsetOf(r);
  const change = moneyChange(was, after, { today: input.today, payOffsetWas: offset, payOffsetNow: offset });
  return { r, d, plan, change };
}

async function paymentsOf(tx: Tx, change: MoneyChange) {
  const ids = change.moves.map((m) => m.paymentId);
  if (ids.length === 0) return [];
  const rows = await tx.payment.findMany({ where: { id: { in: ids } }, select: { id: true, occurredOn: true, grossTetri: true, channel: true } });
  return rows.map((p) => ({ id: p.id, occurredOn: isoDate(p.occurredOn), grossTetri: p.grossTetri, channel: p.channel }));
}

/** What the mark would do, written nowhere (the sheet's «было → стало»). */
export async function depositBeforePreview(input: DepositBeforeInput) {
  return prisma.$transaction(async (tx) => {
    const s = await study(tx, input);
    return {
      receivedBefore: { was: s.d.receivedBeforeTransferTetri, now: input.receivedBeforeTetri },
      freedTetri: s.plan.freedTetri,
      money: s.change,
      payments: await paymentsOf(tx, s.change),
    };
  });
}

/**
 * An owner marks an open rental's deposit received before EV8 Ops — or takes
 * the mark off with 0 — with a reason. One transaction under the rental's
 * lock: the mark, the payments' parts on the deposit beyond its sum freed;
 * then the settling places what was freed, or lays the customer's money not
 * yet placed on a deposit owed again.
 */
export async function setDepositBefore(input: DepositBeforeInput & { actorId: string; reason: string | null }) {
  if (!input.reason) throw badRequest('missing_field', 'Say why the deposit was received earlier.', { field: 'reason' });
  const done = await prisma.$transaction(async (tx) => {
    const found = await tx.rental.findUnique({ where: { id: input.rentalId }, select: { id: true } });
    if (!found) throw notFound('rental_not_found', 'No such rental.');
    await tx.$queryRaw`SELECT 1 FROM rentals WHERE id = ${found.id}::uuid FOR UPDATE`;
    const s = await study(tx, input);
    // The payments' parts the mark frees, the oldest first: a part freed whole goes, one freed in part is made smaller.
    const rows = new Map(s.plan.freed.map((f) => [f.id!, f.amountTetri]));
    const had = await tx.paymentAllocation.findMany({ where: { id: { in: [...rows.keys()] } }, select: { id: true, amountTetri: true } });
    for (const a of had) {
      const free = rows.get(a.id) ?? 0;
      if (free >= a.amountTetri) await tx.paymentAllocation.delete({ where: { id: a.id } });
      else await tx.paymentAllocation.update({ where: { id: a.id }, data: { amountTetri: a.amountTetri - free } });
    }
    await tx.deposit.update({ where: { id: s.d.id }, data: { receivedBeforeTransferTetri: input.receivedBeforeTetri, updatedAt: new Date() } });
    await recomputeRental(tx, s.r.id);
    const marked = input.receivedBeforeTetri > 0;
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        // Taking the mark off is its own line, as a move of a week taken back is (ADR-0041).
        action: marked ? 'deposit.before' : 'deposit.before.undo',
        entityType: 'deposit',
        entityId: s.d.id,
        // The figures by name on both sides; the debt after is what the settling below comes to.
        before: { receivedBeforeTetri: s.d.receivedBeforeTransferTetri, paidTetri: s.change.deposit?.paidWas ?? null, debtTetri: s.change.owes.was },
        after: { receivedBeforeTetri: input.receivedBeforeTetri, paidTetri: s.change.deposit?.paidNow ?? null, debtTetri: s.change.owes.now, freedTetri: s.plan.freedTetri },
        note: input.reason,
      },
    });
    return { receivedBeforeTetri: input.receivedBeforeTetri, freedTetri: s.plan.freedTetri, debtTetri: s.change.owes.now };
  });
  await settleCredit(input.rentalId);
  return done;
}
