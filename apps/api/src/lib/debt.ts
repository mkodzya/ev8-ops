import { customerDebt, dueTodayOf, todayISO, type Debt } from '@ev8/shared';
import { isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { rentStateOf } from './rentState.js';

// The database side of the one debt figure (B7-02): read what a customer's
// records ask for and what their money has taken, and hand it to the one
// function in shared. Many customers are read in one pass, so a list of
// seventy never becomes seventy round trips.

const OPEN = new Set(['booked', 'active', 'overdue', 'paused', 'disputed']);

/**
 * The one figure, and beside it what it is made of on a due day (ADR-0017).
 * Nothing here changes the figure: a week is owed from its first day, and
 * these three only say how much of `owesTetri` is awaited today and not late.
 */
export type CustomerDebt = Debt & {
  /** Of owesTetri: awaited today, not late (shared `dueTodayOf`). */
  dueTodayTetri: number;
  /** Of dueTodayTetri: the rent alone — what `handOverBlockTetri` reads. */
  dueTodayRentTetri: number;
  /** dueTodayTetri by rental id, before credit. */
  dueTodayBy: Record<string, number>;
};

export async function debtsOf(customerIds: string[], today: string = todayISO(new Date(), env.TZ)): Promise<Map<string, CustomerDebt>> {
  const out = new Map<string, Debt>();
  if (customerIds.length === 0) return new Map();
  const ids = [...new Set(customerIds)];

  const [rentals, sales, jobs, payments] = await Promise.all([
    prisma.rental.findMany({
      where: { customerId: { in: ids } },
      select: {
        id: true,
        number: true,
        status: true,
        customerId: true,
        // The two facts a rental's state is read from: for the due day only, never for the figure.
        paidThrough: true,
        pickedUpOn: true,
        periods: { select: { startsOn: true, amountTetri: true, paidTetri: true } },
        charges: { where: { voidedAt: null }, select: { amountTetri: true, allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } } },
        deposit: {
          select: { amountTetri: true, paidTetri: true, withheldTetri: true, paidOutBeforeTetri: true, migrationDecision: true, payouts: { where: { voidedAt: null }, select: { grossTetri: true } } },
        },
      },
    }),
    prisma.sale.findMany({
      where: { customerId: { in: ids } },
      select: { id: true, number: true, status: true, customerId: true, instalments: { select: { dueOn: true, amountTetri: true, paidTetri: true } } },
    }),
    prisma.serviceJob.findMany({
      where: { customerId: { in: ids }, payer: 'customer', status: 'done' },
      select: {
        id: true,
        number: true,
        customerId: true,
        labourTetri: true,
        withheldTetri: true,
        parts: { select: { qty: true, unitPriceTetri: true } },
        payments: { where: { voidedAt: null }, select: { grossTetri: true } },
      },
    }),
    // Money in that nothing has taken yet: rent and on-account payments less
    // their allocations. A sale's or a repair's payment is that record's own.
    prisma.payment.findMany({
      where: { customerId: { in: ids }, voidedAt: null, direction: 'in', kind: { in: ['rent', 'on_account'] } },
      select: { customerId: true, grossTetri: true, allocations: { select: { amountTetri: true } } },
    }),
  ]);

  for (const id of ids) {
    const mine = rentals.filter((r) => r.customerId === id);
    const held = mine.reduce((n, r) => {
      if (!r.deposit) return n;
      // Closed by a transfer decision: the company is not holding it (§3.7).
      if (r.deposit.migrationDecision) return n;
      const paidOut = r.deposit.paidOutBeforeTetri + r.deposit.payouts.reduce((m, p) => m + p.grossTetri, 0);
      return n + Math.max(0, r.deposit.paidTetri - r.deposit.withheldTetri - paidOut);
    }, 0);
    out.set(
      id,
      customerDebt({
        today,
        rentals: mine.map((r) => ({
          id: r.id,
          number: r.number,
          open: OPEN.has(r.status),
          periods: r.periods.map((p) => ({ startsOn: isoDate(p.startsOn)!, amountTetri: p.amountTetri, paidTetri: p.paidTetri })),
          deposit: r.deposit ? { amountTetri: r.deposit.amountTetri, paidTetri: r.deposit.paidTetri } : null,
          charges: r.charges.map((c) => ({ amountTetri: c.amountTetri, paidTetri: c.allocations.reduce((n, a) => n + a.amountTetri, 0) })),
        })),
        sales: sales
          .filter((s) => s.customerId === id)
          .map((s) => ({ id: s.id, number: s.number, status: s.status, instalments: s.instalments.map((i) => ({ dueOn: isoDate(i.dueOn)!, amountTetri: i.amountTetri, paidTetri: i.paidTetri })) })),
        repairs: jobs
          .filter((j) => j.customerId === id)
          .map((j) => {
            const total = j.labourTetri + j.parts.reduce((n, p) => n + p.qty * p.unitPriceTetri, 0);
            return { id: j.id, number: j.number, chargedTetri: Math.max(0, total - j.withheldTetri), paidTetri: j.payments.reduce((n, p) => n + p.grossTetri, 0) };
          }),
        unplacedTetri: payments
          .filter((p) => p.customerId === id)
          .reduce((n, p) => n + Math.max(0, p.grossTetri - p.allocations.reduce((m, a) => m + a.amountTetri, 0)), 0),
        depositHeldTetri: held,
      }),
    );
  }

  // Beside each figure, how much of it is awaited today. The figure is the
  // one worked out above, passed through as it is.
  const withDue = new Map<string, CustomerDebt>();
  for (const [id, debt] of out) {
    const mine = rentals.filter((r) => r.customerId === id).map((r) => ({ id: r.id, status: rentStateOf(r, today).status, pickedUpOn: isoDate(r.pickedUpOn) }));
    const due = dueTodayOf(debt, mine, today);
    withDue.set(id, { ...debt, dueTodayTetri: due.tetri, dueTodayRentTetri: due.rentTetri, dueTodayBy: due.byRental });
  }
  return withDue;
}

/**
 * A rental's part of its customer's one figure: its unpaid weeks, an unpaid
 * deposit and what its return charged — before the customer's credit.
 */
export function rentalDebt(debt: Debt | undefined, rentalId: string): number {
  return (debt?.parts ?? [])
    .filter((p) => p.id === rentalId && (p.kind === 'rent' || p.kind === 'deposit' || p.kind === 'charge'))
    .reduce((n, p) => n + p.owesTetri, 0);
}

/** Of a rental's debt: what is awaited today and not late — nought for a rental that is not due today. */
export function rentalDueToday(debt: CustomerDebt | undefined, rentalId: string): number {
  return debt?.dueTodayBy[rentalId] ?? 0;
}

/** One customer's figure. `today` — the day the caller reads its statuses for, so the two halves of an answer cannot part at midnight. */
export async function debtOf(customerId: string, today?: string): Promise<CustomerDebt> {
  return (await debtsOf([customerId], today)).get(customerId)!;
}
