import { MAX_SHIFT_DAYS, shiftedPayWeekday, weekShiftPlan, weeksAnchor } from '@ev8/shared';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { badRequest, conflict, notFound } from './errors.js';
import { recomputeRental } from './payments.js';
import { openWeeks, settleCredit } from './periods.js';

/**
 * An owner makes the running week of a rental 1–6 days longer, with a reason
 * (ADR-0041). The case of the call of 21.10.2026: a courier paid for his week
 * three days late and paid for the three days on top. Mika's answer «А» the
 * same day: the week becomes those days longer and costs the extra a person
 * types (the sheet suggests rate ÷ 7 × days); every later week and the pay day
 * start as many days later; money already on earlier weeks stays where it is.
 * The system never does this by itself from the size of a payment — a bank
 * line comes without a name, and 214 may be a week and three days, money
 * ahead, or a fine.
 *
 * Only the last week of a running rental is moved: no other row changes its
 * dates, and a week exists only once it has begun (ADR-0016). A move is set,
 * not added — a second one replaces the first, and 0 days takes it back, as a
 * discount does (ADR-0020). The week cannot become cheaper than what is
 * already paid on it.
 */
export async function shiftWeek(input: {
  actorId: string;
  rentalId: string;
  seq: number;
  days: number;
  /** What the extra days cost; null — not said, which only 0 days may leave. */
  extraTetri: number | null;
  reason: string | null;
  today: string;
}): Promise<{ endsOn: string; amountTetri: number; payWeekday: number | null }> {
  if (!Number.isInteger(input.days) || input.days < 0 || input.days > MAX_SHIFT_DAYS) {
    throw badRequest('shift_days_range', `A week is made 1 to ${MAX_SHIFT_DAYS} days longer.`, { field: 'days' });
  }
  if (!input.reason) throw badRequest('missing_field', 'Say why the week is moved.', { field: 'reason' });

  const done = await prisma.$transaction(async (tx) => {
    const r = await tx.rental.findUnique({
      where: { id: input.rentalId },
      select: { id: true, status: true, pickedUpOn: true, returnedOn: true, weeklyRateTetri: true, payWeekday: true, periods: { select: { seq: true, extraDays: true } } },
    });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    const pickedUpOn = isoDate(r.pickedUpOn);
    // A paused or disputed rental opens no weeks, and a returned one has its last.
    if ((r.status !== 'active' && r.status !== 'overdue') || r.returnedOn || !pickedUpOn) {
      throw conflict('rental_not_running', 'Only a running rental has its week moved.');
    }
    const week = await tx.rentalPeriod.findUnique({ where: { rentalId_seq: { rentalId: r.id, seq: input.seq } } });
    if (!week) throw notFound('week_not_found', 'No such week in this rental.');
    if (r.periods.some((p) => p.seq > week.seq)) throw conflict('week_not_last', 'Only the last week is moved: the next one has begun.');
    if (week.paidBeforeTransfer) throw conflict('week_paid_before_transfer', 'This week was paid before the rental was carried over.');
    // The week's own price, without the extra days: a week at nothing — a
    // pause lifted, a discount of all of it — has nothing to lengthen.
    if (week.amountTetri - week.extraTetri <= 0) throw conflict('week_at_nothing', 'A week at nothing is not moved.');
    if (input.days === 0 && week.extraDays === 0) {
      throw badRequest('shift_days_range', `A week is made 1 to ${MAX_SHIFT_DAYS} days longer.`, { field: 'days' });
    }
    const extra = input.days === 0 ? 0 : input.extraTetri;
    if (extra == null) throw badRequest('missing_field', 'Say what the extra days cost.', { field: 'extraTetri' });
    const amount = week.amountTetri - week.extraTetri + extra;
    if (amount < week.paidTetri) {
      throw conflict('shift_over_paid', 'That much of the week is paid already.', { field: 'extraTetri', paidTetri: week.paidTetri });
    }

    const startsOn = isoDate(week.startsOn)!;
    const plan = weekShiftPlan({ startsOn, days: input.days, weeklyRateTetri: r.weeklyRateTetri });
    // Every week of the rental, this one as it will be: the weekday the weeks run on after the move.
    const shiftDays = r.periods.reduce((n, p) => n + (p.seq === week.seq ? input.days : p.extraDays), 0);
    const payWeekday = shiftedPayWeekday(r.payWeekday, input.days - week.extraDays, weeksAnchor(pickedUpOn, shiftDays)!);
    const moved = input.days > 0;

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
    // "Paid through", the week's status and the days the weeks gained.
    await recomputeRental(tx, r.id);
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'rental.week.shift',
        entityType: 'rental',
        entityId: r.id,
        before: { seq: week.seq, startsOn, endsOn: isoDate(week.endsOn), amountTetri: week.amountTetri, extraDays: week.extraDays, extraTetri: week.extraTetri, payWeekday: r.payWeekday },
        after: { seq: week.seq, startsOn, endsOn: plan.endsOn, amountTetri: amount, extraDays: input.days, extraTetri: extra, payWeekday },
        note: input.reason,
      },
    });
    return { endsOn: plan.endsOn, amountTetri: amount, payWeekday };
  });

  // What the night would do, now: a week made shorter again may have let the
  // next one begin, and money of the customer's not yet placed goes onto the
  // extra days today — not at 00:10, which would leave the rental «overdue»
  // until then (ADR-0016 on daytime runs).
  await openWeeks(input.rentalId, input.today);
  await settleCredit(input.rentalId);
  return done;
}
