import {
  moneyChange,
  payOffsetDays,
  pickupDateMoney,
  pickupDatePlan,
  rentWeekday,
  settleMoney,
  weeksAnchor,
  type MoneyChange,
  type PickupDatePlan,
  type PickupDateRefusal,
} from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { badRequest, conflict, notFound, type ApiError } from './errors.js';
import { recomputeRental } from './payments.js';
import { settleCredit } from './periods.js';
import { rentalMoneyOf } from './rentalMoney.js';

type Tx = Prisma.TransactionClient;

// The pickup date of an open rental put right (issue #10 of the director,
// Mika's «А» of 23.10.2026; ADR-0044 §1). The weeks are counted again from
// the true day; each week row keeps its number and the money on it; a week
// not begun by the new day goes and its money is placed again by the one
// order (`settleCredit`). The hand-over act and the moped's hand-over event
// take the new day, so its state and its history read from it. The sheet
// shows all of it first — the same study the write makes.

export interface PickupDateInput {
  rentalId: string;
  pickedUpOn: string;
  /** «Оплачено до переноса по» said again, for a rental carried over; undefined — the one it has. */
  paidBeforeThrough?: string | null;
  today: string;
}

/** A refusal of the plan, in the API's words; one literal call each, so the errors guard sees every code. */
const REFUSED: Record<PickupDateRefusal, (plan: PickupDatePlan) => ApiError> = {
  pickup_date_future: () => badRequest('pickup_date_future', 'A moped is not handed over tomorrow.', { field: 'pickedUpOn' }),
  pickup_date_same: () => badRequest('pickup_date_same', 'That is the pickup date the rental has.', { field: 'pickedUpOn' }),
  pickup_date_week_shifted: (p) =>
    conflict('pickup_date_week_shifted', 'A week made longer would not have begun by this date; take its move back first.', { field: 'pickedUpOn', seq: p.refusal?.seq ?? null }),
  pickup_date_week_discounted: (p) =>
    conflict('pickup_date_week_discounted', 'A week with a discount would not have begun by this date; take the discount back first.', { field: 'pickedUpOn', seq: p.refusal?.seq ?? null }),
  transfer_paid_through_week_end: (p) =>
    badRequest('transfer_paid_through_week_end', 'Paid through before the transfer is no week’s end on these dates; say it again.', { field: 'paidBeforeThrough', options: p.weekEnds }),
};

/**
 * Everything the change is, read and worked out without writing: the weeks,
 * where the money goes, the debt before and after. The preview answers with
 * it; the write applies it inside its transaction, under the rental's lock.
 * Refusals about the moped and the rental are thrown; the plan's own — a day
 * after today, the same day, a week that would have to go — come back in it,
 * so the sheet can say them beside the date.
 */
async function study(tx: Tx, input: PickupDateInput) {
  const r = await tx.rental.findUnique({
    where: { id: input.rentalId },
    include: {
      periods: { orderBy: { seq: 'asc' } },
      acts: { select: { id: true, kind: true, occurredOn: true, vehicleId: true, createdAt: true }, orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!r) throw notFound('rental_not_found', 'No such rental.');
  if (r.status === 'returned') throw conflict('already_returned', 'This rental is already closed.');
  const from = isoDate(r.pickedUpOn);
  if (!from) throw badRequest('missing_field', 'This rental was never handed over.', { field: 'pickedUpOn' });
  const to = input.pickedUpOn;

  const running = r.status === 'active' || r.status === 'overdue';
  const plan = pickupDatePlan({
    pickedUpOn: from,
    to,
    today: input.today,
    weeks: r.periods.map((p) => ({
      seq: p.seq,
      startsOn: isoDate(p.startsOn)!,
      endsOn: isoDate(p.endsOn)!,
      extraDays: p.extraDays,
      discountTetri: p.discountTetri,
      paidBeforeTransfer: p.paidBeforeTransfer,
    })),
    payWeekday: r.payWeekday,
    running,
    // Only a rental carried over has «оплачено до переноса» to say again.
    paidBeforeThrough: r.transferredAt ? input.paidBeforeThrough : undefined,
  });

  // The moped the hand-over gave: the act's own (migration 0063), or the
  // rental's while no swap gave it another.
  const pickupAct = r.acts.find((a) => a.kind === 'pickup') ?? null;
  const firstSwap = r.acts.find((a) => a.kind === 'swap_out' || a.kind === 'swap_in') ?? null;
  const swappedOn = isoDate(firstSwap?.occurredOn);
  const mopedId = pickupAct?.vehicleId ?? (firstSwap ? null : r.vehicleId);
  const moped = mopedId ? await tx.vehicle.findUnique({ where: { id: mopedId }, select: { id: true, arrivedOn: true } }) : null;
  const events = moped
    ? await tx.vehicleEvent.findMany({
        where: { vehicleId: moped.id },
        orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, kind: true, occurredOn: true, rentalId: true, reason: true, createdAt: true },
      })
    : [];
  // The hand-over's own events: the moped's first pickup by this rental, and
  // the move to the rent park the hand-over made on its day (`pickUp`).
  const handOverEvent = events.find((e) => e.kind === 'pickup' && e.rentalId === r.id) ?? null;
  const poolEvent = events.find((e) => e.kind === 'to_rent' && e.reason === `hand-over ${r.number}` && isoDate(e.occurredOn) === from) ?? null;

  // Not into a stretch of the moped's history already written (the rule a
  // swap keeps): after the last thing before the hand-over, before the first
  // thing after it. Its arrival is checked by its own date — a rental carried
  // over may have moved that back (`pickUp`) and left the event as it was.
  let lastBefore: string | null = null;
  let firstAfter: string | null = null;
  if (handOverEvent) {
    const handedOn = isoDate(handOverEvent.occurredOn)!;
    for (const e of events) {
      if (e.id === handOverEvent.id || e.id === poolEvent?.id || e.kind === 'arrived') continue;
      const on = isoDate(e.occurredOn)!;
      const before = on < handedOn || (on === handedOn && e.createdAt < handOverEvent.createdAt);
      if (before) lastBefore = lastBefore == null || on > lastBefore ? on : lastBefore;
      else firstAfter = firstAfter == null || on < firstAfter ? on : firstAfter;
    }
  }

  // The plan's refusal of the day itself comes first: a day after today has no moped history to ask.
  const dayRefused = plan.refusal?.code === 'pickup_date_future' || plan.refusal?.code === 'pickup_date_same';
  if (!dayRefused) {
    const arrivedOn = isoDate(moped?.arrivedOn);
    if (arrivedOn && to < arrivedOn) throw conflict('pickup_before_arrival', 'The moped came after this date.', { field: 'pickedUpOn', arrivedOn });
    if (swappedOn && to > swappedOn) throw conflict('pickup_after_swap', 'The moped was changed before this date; the hand-over is before the swap.', { field: 'pickedUpOn', swappedOn });
    if (lastBefore && to < lastBefore) throw conflict('pickup_date_history', 'The date is before something already written in the moped’s history.', { field: 'pickedUpOn', on: lastBefore });
    if (firstAfter && to > firstAfter) throw conflict('pickup_date_history', 'The date is after something already written in the moped’s history.', { field: 'pickedUpOn', on: firstAfter });
  }

  const shiftDays = plan.shiftDays;
  const payDay = { was: rentWeekday(from, shiftDays, r.payWeekday), now: rentWeekday(to, shiftDays, plan.payWeekday) };
  const was = await rentalMoneyOf(tx, r);
  let change: MoneyChange | null = null;
  if (!plan.refusal) {
    const after = settleMoney(pickupDateMoney(was, plan, r.weeklyRateTetri).money);
    change = moneyChange(was, after, {
      today: input.today,
      payOffsetWas: payOffsetDays(weeksAnchor(from, shiftDays), r.payWeekday),
      payOffsetNow: payOffsetDays(weeksAnchor(to, shiftDays), plan.payWeekday),
    });
  }
  return { r, from, to, plan, change, payDay, pickupAct, handOverEvent, poolEvent, mopedId };
}

/** The payments the change moves, by what a person knows them by: the day, the sum, how they came. */
async function paymentsOf(tx: Tx, change: MoneyChange | null) {
  const ids = change?.moves.map((m) => m.paymentId) ?? [];
  if (ids.length === 0) return [];
  const rows = await tx.payment.findMany({ where: { id: { in: ids } }, select: { id: true, occurredOn: true, grossTetri: true, channel: true } });
  return rows.map((p) => ({ id: p.id, occurredOn: isoDate(p.occurredOn), grossTetri: p.grossTetri, channel: p.channel }));
}

/** What the new day would do, written nowhere (the sheet's «было → стало»). */
export async function pickupDatePreview(input: PickupDateInput) {
  return prisma.$transaction(async (tx) => {
    const s = await study(tx, input);
    return {
      pickedUpOn: { was: s.from, now: s.to },
      refusal: s.plan.refusal,
      // A rental carried over with weeks paid before the transfer: «оплачено по» stays a date, chosen again if it must be.
      transfer: s.r.transferredAt && s.plan.paidBeforeThrough.was ? { ...s.plan.paidBeforeThrough, options: s.plan.weekEnds } : null,
      payDay: s.payDay,
      payWeekday: { was: s.r.payWeekday, now: s.plan.payWeekday },
      weekShiftDays: s.plan.shiftDays,
      money: s.change,
      payments: await paymentsOf(tx, s.change),
    };
  });
}

/**
 * An owner gives an open rental its true day of hand-over, with a reason.
 * One transaction under the rental's lock: the weeks moved, those not begun
 * gone with what was paid on them freed, those begun opened, the pay day,
 * the act and the moped's events; then the night's settling, now, places the
 * money freed — as a week made longer does (ADR-0041 §7).
 */
export async function changePickupDate(input: PickupDateInput & { actorId: string; reason: string | null }) {
  if (!input.reason) throw badRequest('missing_field', 'Say why the pickup date changes.', { field: 'reason' });
  const done = await prisma.$transaction(async (tx) => {
    const found = await tx.rental.findUnique({ where: { id: input.rentalId }, select: { id: true } });
    if (!found) throw notFound('rental_not_found', 'No such rental.');
    // One correction at a time on a rental: what is checked is read again under the lock.
    await tx.$queryRaw`SELECT 1 FROM rentals WHERE id = ${found.id}::uuid FOR UPDATE`;
    const s = await study(tx, input);
    if (s.plan.refusal) throw REFUSED[s.plan.refusal.code](s.plan);
    const { r, from, to, plan } = s;
    const now = new Date();
    const rows = new Map(r.periods.map((p) => [p.seq, p]));

    // A week not begun by the new day goes; what was paid on it is the
    // customer's again. A week now paid before the transfer is paid without
    // a payment, and what payments put on it is freed too.
    const gone = plan.weeks.filter((w) => !w.to).map((w) => rows.get(w.seq)!.id);
    const paidBefore = plan.weeks.filter((w) => w.to && w.paidBeforeTransfer && !rows.get(w.seq)!.paidBeforeTransfer).map((w) => rows.get(w.seq)!.id);
    await tx.paymentAllocation.deleteMany({ where: { periodId: { in: [...gone, ...paidBefore] } } });
    await tx.rentalPeriod.deleteMany({ where: { id: { in: gone } } });
    for (const w of plan.weeks) {
      if (!w.to) continue;
      const row = rows.get(w.seq)!;
      await tx.rentalPeriod.update({
        where: { id: row.id },
        data: {
          startsOn: dateFromISO(w.to.startsOn)!,
          endsOn: dateFromISO(w.to.endsOn)!,
          paidBeforeTransfer: w.paidBeforeTransfer,
          // A week no longer paid before the transfer has no carried bank money (ADR-0023): the payment stays on it as a payment.
          carriedPaymentId: w.paidBeforeTransfer ? row.carriedPaymentId : null,
          updatedAt: now,
        },
      });
    }
    // The weeks begun by today on the new days, as the night opens them: at the rate.
    for (const b of plan.opened) {
      await tx.rentalPeriod.create({
        data: { rentalId: r.id, seq: b.seq, startsOn: dateFromISO(b.startsOn)!, endsOn: dateFromISO(b.endsOn)!, amountTetri: r.weeklyRateTetri, paidBeforeTransfer: b.paidBeforeTransfer },
      });
    }
    await tx.rental.update({ where: { id: r.id }, data: { pickedUpOn: dateFromISO(to)!, payWeekday: plan.payWeekday, updatedAt: now } });

    // The hand-over act and the moped's own history take the day too: its
    // state, its days rented and its maintenance read from them.
    if (s.pickupAct) await tx.act.update({ where: { id: s.pickupAct.id }, data: { occurredOn: dateFromISO(to)! } });
    if (s.handOverEvent) {
      // An event written on the hand-over's day moves with it; one written
      // later — a VIN confirmed after the hand-over — moves only if the new
      // day is later still.
      const on = isoDate(s.handOverEvent.occurredOn)!;
      const next = on === from || on < to ? to : on;
      if (next !== on) await tx.vehicleEvent.update({ where: { id: s.handOverEvent.id }, data: { occurredOn: dateFromISO(next)! } });
    }
    if (s.poolEvent) await tx.vehicleEvent.update({ where: { id: s.poolEvent.id }, data: { occurredOn: dateFromISO(to)! } });

    await recomputeRental(tx, r.id);
    const change = s.change!;
    const weeksBefore = r.periods.length;
    const weeksAfter = plan.weeks.filter((w) => w.to).length + plan.opened.length;
    const transfer = r.transferredAt && plan.paidBeforeThrough.was ? plan.paidBeforeThrough : null;
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'rental.pickup.date',
        entityType: 'rental',
        entityId: r.id,
        // Each figure by its name, on both sides: the journal pairs them. The
        // debt and «оплачено по» after are what the settling below comes to.
        before: {
          pickedUpOn: from,
          weeks: weeksBefore,
          paidThrough: change.paidThrough.was,
          debtTetri: change.owes.was,
          payWeekday: r.payWeekday,
          payDay: s.payDay.was,
          weekShiftDays: plan.shiftDays,
          ...(transfer ? { paidBeforeThrough: transfer.was } : {}),
          vehicleId: s.mopedId,
        },
        after: {
          pickedUpOn: to,
          weeks: weeksAfter,
          paidThrough: change.paidThrough.now,
          debtTetri: change.owes.now,
          payWeekday: plan.payWeekday,
          payDay: s.payDay.now,
          weekShiftDays: plan.shiftDays,
          ...(transfer ? { paidBeforeThrough: transfer.now } : {}),
          vehicleId: s.mopedId,
          movedPayments: change.moves.length,
        },
        note: input.reason,
      },
    });
    return { pickedUpOn: to, paidThrough: change.paidThrough.now, debtTetri: change.owes.now, payWeekday: plan.payWeekday };
  });

  // What the night would do, now: the money freed is placed by the one
  // order, oldest first (ADR-0016 on daytime runs).
  await settleCredit(input.rentalId);
  return done;
}
