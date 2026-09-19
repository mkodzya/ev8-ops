import { customerDebt, todayISO, type Debt } from '@ev8/shared';
import { isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';

// The database side of the one debt figure (B7-02): read what a customer's
// records ask for and what their money has taken, and hand it to the one
// function in shared. Many customers are read in one pass, so a list of
// seventy never becomes seventy round trips.

const OPEN = new Set(['booked', 'active', 'overdue', 'paused', 'disputed']);

export async function debtsOf(customerIds: string[]): Promise<Map<string, Debt>> {
  const out = new Map<string, Debt>();
  if (customerIds.length === 0) return out;
  const ids = [...new Set(customerIds)];
  const today = todayISO(new Date(), env.TZ);

  const [rentals, sales, jobs, payments] = await Promise.all([
    prisma.rental.findMany({
      where: { customerId: { in: ids } },
      select: {
        id: true,
        number: true,
        status: true,
        customerId: true,
        periods: { select: { startsOn: true, amountTetri: true, paidTetri: true } },
        charges: { where: { voidedAt: null }, select: { amountTetri: true, allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } } },
        deposit: {
          select: { amountTetri: true, paidTetri: true, withheldTetri: true, paidOutBeforeTetri: true, payouts: { where: { voidedAt: null }, select: { grossTetri: true } } },
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
  return out;
}

export async function debtOf(customerId: string): Promise<Debt> {
  return (await debtsOf([customerId])).get(customerId)!;
}
