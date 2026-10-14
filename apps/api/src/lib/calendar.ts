import {
  calendarSpans,
  paymentsCalendar,
  todayISO,
  type CalendarChannel,
  type CalendarCredit,
  type CalendarPayment,
  type CalendarRental,
  type CalendarRentalCard,
  type PaymentsCalendarAnswer,
  type Period,
  type RentalStatus,
} from '@ev8/shared';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { debtsOf, rentalDebt } from './debt.js';
import { env } from './env.js';
import { payOffsetOf } from './rentState.js';
import { paymentsOfPeriod } from './week.js';

// The data side of "Деньги → Календарь" (docs/redesign/payments-calendar.md,
// ADR-0016). The schedule, its states and every total are worked out in
// `packages/shared/src/calendar.ts`; here we only read the rows it needs,
// borrow the figures other screens already own, and attach the names.
//
// Nothing is recomputed that another screen answers: the debt of a late
// rental is the one figure (`debt.ts`), "Пришло денег" is read by the reader
// of the week's report (`week.ts`).
//
// Annulled money is kept out three times, each on its own — who paid a week,
// the credit, and what was received. The credit is the dangerous one: a
// voided payment loses its allocations before it is stamped void, so without
// the filter its whole sum would read as money waiting for the next week.

/** The later of two payments, in the order `settleCredit` spends them. */
const later = (a: CalendarPayment, b: CalendarPayment): boolean =>
  a.occurredOn > b.occurredOn || (a.occurredOn === b.occurredOn && a.createdAt > b.createdAt);

export async function calendarAnswer(range: Period, today: string = todayISO(new Date(), env.TZ)): Promise<PaymentsCalendarAnswer> {
  // The days the answer covers: whole weeks, the week of today, a day after
  // each. Two stretches when the month asked for stands apart from today —
  // nothing between them is shown, so nothing between them is read.
  const spans = calendarSpans(range.from, range.to, today);

  const [rows, received, unsortedIn] = await Promise.all([
    // Literally the roll's filter and the roll's order (`periods.ts`), with
    // every week row of each rental: a missing seq is a week by calculation.
    prisma.rental.findMany({
      where: { status: { in: ['active', 'overdue'] }, pickedUpOn: { not: null }, returnedOn: null },
      orderBy: [{ pickedUpOn: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        status: true,
        customerId: true,
        pickedUpOn: true,
        returnedOn: true,
        weeklyRateTetri: true,
        paidThrough: true,
        payWeekday: true,
        customer: { select: { id: true, name: true, nameKa: true, nameLat: true, phone: true } },
        vehicle: { select: { id: true, vin: true, model: { select: { brand: true, name: true } } } },
        deposit: { select: { amountTetri: true, paidTetri: true } },
        charges: { where: { voidedAt: null }, select: { amountTetri: true, allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } } },
        periods: { orderBy: { seq: 'asc' }, select: { id: true, seq: true, startsOn: true, endsOn: true, amountTetri: true, paidTetri: true, paidBeforeTransfer: true } },
      },
    }),
    Promise.all(spans.map((s) => paymentsOfPeriod(s.from, s.to))),
    // Incoming only: an unsorted line going out cannot be somebody's rent.
    prisma.statementLine.count({ where: { status: 'unmatched', direction: 'in' } }),
  ]);
  const payments = received.flat();
  const rentalIds = rows.map((r) => r.id);
  const customerIds = [...new Set(rows.map((r) => r.customerId))];

  const [paidBy, unplaced, debts] = await Promise.all([
    // Who paid the weeks that will be shown.
    prisma.paymentAllocation.findMany({
      where: {
        target: 'period',
        payment: { voidedAt: null },
        period: { rentalId: { in: rentalIds }, OR: spans.map((s) => ({ startsOn: { gte: dateFromISO(s.from)!, lte: dateFromISO(s.to)! } })) },
      },
      select: { periodId: true, payment: { select: { id: true, occurredOn: true, createdAt: true, channel: true } } },
    }),
    // The credit: the `where` of `settleCredit`, for every rental at once.
    prisma.payment.findMany({
      where: {
        voidedAt: null,
        direction: 'in',
        kind: { in: ['rent', 'on_account'] },
        OR: [{ rentalId: { in: rentalIds } }, { customerId: { in: customerIds }, rentalId: null }],
      },
      orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, occurredOn: true, createdAt: true, channel: true, grossTetri: true, customerId: true, rentalId: true, allocations: { select: { amountTetri: true } } },
    }),
    debtsOf(customerIds, today),
  ]);

  const lastPayment = new Map<string, CalendarPayment>();
  for (const a of paidBy) {
    if (!a.periodId) continue;
    const p: CalendarPayment = {
      paymentId: a.payment.id,
      occurredOn: isoDate(a.payment.occurredOn)!,
      createdAt: a.payment.createdAt.toISOString(),
      channel: a.payment.channel as CalendarChannel,
    };
    const have = lastPayment.get(a.periodId);
    if (!have || later(p, have)) lastPayment.set(a.periodId, p);
  }

  const customerOf = new Map(rows.map((r) => [r.id, r.customerId]));
  const credits: CalendarCredit[] = [];
  for (const p of unplaced) {
    // The gross the customer paid, never the net the bank credited: the
    // acquirer's cut is the company's expense, not a week left half paid.
    const creditTetri = p.grossTetri - p.allocations.reduce((n, a) => n + a.amountTetri, 0);
    const customerId = p.customerId ?? (p.rentalId ? customerOf.get(p.rentalId) : undefined);
    if (creditTetri <= 0 || !customerId) continue;
    credits.push({
      paymentId: p.id,
      occurredOn: isoDate(p.occurredOn)!,
      createdAt: p.createdAt.toISOString(),
      channel: p.channel as CalendarChannel,
      creditTetri,
      customerId,
      // As stored, null included: money that names a rental pays that rental only.
      rentalId: p.rentalId,
    });
  }

  const debtOf = (r: { id: string; customerId: string }): number => rentalDebt(debts.get(r.customerId), r.id);
  const rentals: CalendarRental[] = rows.map((r) => ({
    id: r.id,
    number: r.number,
    customerId: r.customerId,
    status: r.status as RentalStatus,
    pickedUpOn: isoDate(r.pickedUpOn),
    returnedOn: isoDate(r.returnedOn),
    weeklyRateTetri: r.weeklyRateTetri,
    payOffsetDays: payOffsetOf(r),
    periods: r.periods.map((p) => ({
      seq: p.seq,
      startsOn: isoDate(p.startsOn)!,
      endsOn: isoDate(p.endsOn)!,
      amountTetri: p.amountTetri,
      paidTetri: p.paidTetri,
      paidBeforeTransfer: p.paidBeforeTransfer,
      lastPayment: lastPayment.get(p.id) ?? null,
    })),
    depositShortTetri: r.deposit ? Math.max(0, r.deposit.amountTetri - r.deposit.paidTetri) : 0,
    chargesOpenTetri: r.charges.reduce((n, c) => n + Math.max(0, c.amountTetri - c.allocations.reduce((m, a) => m + a.amountTetri, 0)), 0),
    debtTetri: debtOf(r),
  }));

  const calendar = paymentsCalendar({ today, from: range.from, to: range.to, rentals, credits, payments });

  // A card for every rental the answer names, and for no other.
  const named = new Set([...calendar.entries.map((e) => e.rentalId), ...calendar.late.rentals.map((l) => l.rentalId)]);
  const cards: CalendarRentalCard[] = rows
    .filter((r) => named.has(r.id))
    .map((r) => ({
      id: r.id,
      number: r.number,
      customer: r.customer,
      vehicle: r.vehicle ? { id: r.vehicle.id, vin: r.vehicle.vin, model: `${r.vehicle.model.brand} ${r.vehicle.model.name}` } : null,
      weeklyRateTetri: r.weeklyRateTetri,
      pickedUpOn: isoDate(r.pickedUpOn),
      paidThrough: isoDate(r.paidThrough),
      debtTetri: debtOf(r),
    }));

  return { ...calendar, rentals: cards, unsortedIn };
}
