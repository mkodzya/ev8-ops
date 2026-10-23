import { MAX_SHIFT_DAYS, isShiftDays, rentWeekday, shiftMoneyTetri, shiftedPayWeekday, shorterEndsBeforeToday, weekShiftPlan, weekSurplusFreed, weeksAnchor } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { badRequest, conflict, notFound } from './errors.js';
import { recomputeRental } from './payments.js';
import { openWeeks, settleCredit } from './periods.js';

type Tx = Prisma.TransactionClient;

export interface ShiftInput {
  actorId: string;
  rentalId: string;
  seq: number;
  /** −6 … 6: above nought the days the week gains, below nought the days it loses; 0 takes a move back. */
  days: number;
  /**
   * What the days are worth, a sum above nought: the extra for days gained,
   * the discount for days lost (stored with the days' sign). Null — not said,
   * which only 0 days may leave.
   */
  extraTetri: number | null;
  reason: string | null;
  today: string;
}

export interface ShiftDone {
  endsOn: string;
  amountTetri: number;
  payWeekday: number | null;
  /** What was paid on the week above its new price, freed as the customer's credit. */
  freedTetri: number;
}

function checkInput(input: ShiftInput): void {
  if (!isShiftDays(input.days)) {
    throw badRequest('shift_days_range', `A week is made 1 to ${MAX_SHIFT_DAYS} days longer or shorter.`, { field: 'days' });
  }
  if (!input.reason) throw badRequest('missing_field', 'Say why the week is moved.', { field: 'reason' });
}

/**
 * The running week of a rental made 1–6 days longer or shorter, with a reason
 * (ADR-0041 and its addendum of 23.10.2026). The case of the call of
 * 21.10.2026: a courier paid for his week three days late and paid for the
 * three days on top. Mika's answer «А» the same day: the week becomes those
 * days longer and costs the extra a person types (the sheet suggests rate ÷ 7
 * × days); every later week and the pay day start as many days later; money
 * already on earlier weeks stays where it is. The director's issue #12 and
 * Mika's «А» of 23.10.2026: the same move makes a week shorter, for a
 * discount a person types, when the renter wants to pay on an earlier day —
 * never ending before today; a manager moves it too; and what is paid on the
 * week above its new price is freed, newest money first, as the customer's
 * credit, which the settling lays on the next week. The system never does
 * this by itself from the size of a payment — a bank line comes without a
 * name, and 214 may be a week and three days, money ahead, or a fine.
 *
 * Only the last week of a running rental is moved: no other row changes its
 * dates, and a week exists only once it has begun (ADR-0016). A move is set,
 * not added — a second one replaces the first, and 0 days takes it back, as a
 * discount does (ADR-0020).
 *
 * Inside a transaction the caller holds: «Разнести» moves the week and writes
 * the bank line's payments in one (issue #12). The caller runs
 * `settleAfterShift` once it has committed.
 */
export async function shiftWeekTx(tx: Tx, input: ShiftInput): Promise<ShiftDone> {
  checkInput(input);
  const found = await tx.rental.findUnique({ where: { id: input.rentalId }, select: { id: true } });
  if (!found) throw notFound('rental_not_found', 'No such rental.');
  // One change of a rental's money at a time: what a move frees is taken off
  // the week under the rental's lock, as a deposit marked received earlier is (ADR-0044).
  await tx.$queryRaw`SELECT 1 FROM rentals WHERE id = ${found.id}::uuid FOR UPDATE`;
  const r = await tx.rental.findUniqueOrThrow({
    where: { id: found.id },
    select: { id: true, status: true, pickedUpOn: true, returnedOn: true, weeklyRateTetri: true, payWeekday: true, periods: { select: { seq: true, extraDays: true } } },
  });
  const pickedUpOn = isoDate(r.pickedUpOn);
  // A paused or disputed rental opens no weeks, and a returned one has its last.
  if ((r.status !== 'active' && r.status !== 'overdue') || r.returnedOn || !pickedUpOn) {
    throw conflict('rental_not_running', 'Only a running rental has its week moved.');
  }
  const week = await tx.rentalPeriod.findUnique({ where: { rentalId_seq: { rentalId: r.id, seq: input.seq } } });
  if (!week) throw notFound('week_not_found', 'No such week in this rental.');
  if (r.periods.some((p) => p.seq > week.seq)) throw conflict('week_not_last', 'Only the last week is moved: the next one has begun.');
  if (week.paidBeforeTransfer) throw conflict('week_paid_before_transfer', 'This week was paid before the rental was carried over.');
  // The week's own price, without the move's money: a week at nothing — a
  // pause lifted, a discount of all of it — has nothing to move. A week
  // moved already may always have its move changed or taken back, even
  // after a discount ate into it.
  if (week.extraDays === 0 && week.amountTetri - week.extraTetri <= 0) throw conflict('week_at_nothing', 'A week at nothing is not moved.');
  if (input.days === 0 && week.extraDays === 0) {
    throw badRequest('shift_days_range', `A week is made 1 to ${MAX_SHIFT_DAYS} days longer or shorter.`, { field: 'days' });
  }
  if (input.days !== 0 && input.extraTetri == null) throw badRequest('missing_field', 'Say what the days are worth.', { field: 'extraTetri' });
  // Kept with the days' sign: on top for days gained, off for days lost.
  const extra = shiftMoneyTetri(input.days, input.extraTetri ?? 0);
  const amount = week.amountTetri - week.extraTetri + extra;
  // A discount given on the longer week may cover part of its extra: with
  // less extra it would be more than the week itself — and so would a
  // discount for days lost bigger than what the week costs.
  if (amount < 0) {
    throw conflict('discount_over_week', 'The week\'s discount would be more than the week.', { field: 'extraTetri', discountTetri: week.discountTetri });
  }

  const startsOn = isoDate(week.startsOn)!;
  const plan = weekShiftPlan({ startsOn, days: input.days, weeklyRateTetri: r.weeklyRateTetri });
  // A shorter week ends today at the earliest: its next week must not have begun in the past.
  if (shorterEndsBeforeToday(input.days, plan.endsOn, input.today)) {
    throw conflict('week_ends_before_today', 'A week made shorter ends today at the earliest.', { field: 'days', today: input.today });
  }
  // Every week of the rental, this one as it will be: the weekday the weeks run on after the move.
  const shiftDays = r.periods.reduce((n, p) => n + (p.seq === week.seq ? input.days : p.extraDays), 0);
  const payWeekday = shiftedPayWeekday(r.payWeekday, input.days - week.extraDays, weeksAnchor(pickedUpOn, shiftDays)!);
  // The day the rent falls due on, before and after, whether the rental has
  // one of its own or not: with none, the weeks' new weekday is the new pay
  // day, and the journal says so (QA 21.10.2026: «день оплаты: пятница →
  // понедельник» was missing on a rental with no pay day of its own).
  const payDayBefore = rentWeekday(pickedUpOn, r.periods.reduce((n, p) => n + p.extraDays, 0), r.payWeekday);
  const payDayAfter = rentWeekday(pickedUpOn, shiftDays, payWeekday);
  const moved = input.days !== 0;

  // Paid above the new price — a shorter week, less extra, a move taken back:
  // the money the week no longer needs is freed, the newest first, and is the
  // customer's credit (Mika's «А» of 23.10.2026). It used to be refused. The
  // parts of one bank line are written in one go: the later part is the newer.
  const parts = await tx.paymentAllocation.findMany({
    where: { periodId: week.id, payment: { voidedAt: null } },
    orderBy: [{ createdAt: 'asc' }, { payment: { occurredOn: 'asc' } }, { payment: { statementPart: 'asc' } }, { id: 'asc' }],
    select: { id: true, paymentId: true, amountTetri: true },
  });
  const freed = weekSurplusFreed(parts, amount);
  for (const f of freed) {
    const a = parts.find((p) => p.id === f.id)!;
    if (f.amountTetri >= a.amountTetri) await tx.paymentAllocation.delete({ where: { id: a.id } });
    else await tx.paymentAllocation.update({ where: { id: a.id }, data: { amountTetri: a.amountTetri - f.amountTetri } });
  }
  const freedTetri = freed.reduce((n, f) => n + f.amountTetri, 0);

  await tx.rentalPeriod.update({
    where: { id: week.id },
    data: {
      endsOn: dateFromISO(plan.endsOn)!,
      amountTetri: amount,
      extraDays: input.days,
      extraTetri: extra,
      shiftReason: moved ? input.reason : null,
      shiftedById: moved ? input.actorId : null,
      shiftedAt: moved ? new Date() : null,
      updatedAt: new Date(),
    },
  });
  if (payWeekday !== r.payWeekday) await tx.rental.update({ where: { id: r.id }, data: { payWeekday, updatedAt: new Date() } });
  // "Paid through", the week's status and the days the weeks gained or lost.
  await recomputeRental(tx, r.id);
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      // Taking a move back is its own line, not one more «week moved».
      action: moved ? 'rental.week.shift' : 'rental.week.shift.undo',
      entityType: 'rental',
      entityId: r.id,
      // `payWeekday` as stored (null — none of its own); `payDay` the weekday it falls due on, which the screen reads.
      before: { seq: week.seq, startsOn, endsOn: isoDate(week.endsOn), amountTetri: week.amountTetri, extraDays: week.extraDays, extraTetri: week.extraTetri, payWeekday: r.payWeekday, payDay: payDayBefore },
      after: {
        seq: week.seq,
        startsOn,
        endsOn: plan.endsOn,
        amountTetri: amount,
        extraDays: input.days,
        extraTetri: extra,
        payWeekday,
        payDay: payDayAfter,
        // What became the customer's credit: the settling after the commit places it.
        ...(freedTetri > 0 ? { freedTetri } : {}),
      },
      note: input.reason,
    },
  });
  return { endsOn: plan.endsOn, amountTetri: amount, payWeekday, freedTetri };
}

/**
 * What the night would do, now, once a move has committed: a week made
 * shorter again may have let the next one begin, and money of the
 * customer's not yet placed — a move's freed surplus among it — goes onto
 * the weeks today, not at 00:10, which would leave the rental «overdue» or
 * its credit idle until then (ADR-0016 on daytime runs).
 */
export async function settleAfterShift(rentalId: string, today: string): Promise<void> {
  await openWeeks(rentalId, today);
  await settleCredit(rentalId);
}

/** The move on its own: the rental card's «Сдвинуть неделю» (ADR-0041). */
export async function shiftWeek(input: ShiftInput): Promise<ShiftDone> {
  checkInput(input);
  const done = await prisma.$transaction((tx) => shiftWeekTx(tx, input));
  await settleAfterShift(input.rentalId, input.today);
  return done;
}
