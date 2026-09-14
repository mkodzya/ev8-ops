import { VEHICLE_STATES, effectiveRentalStatus, overdueDays, todayISO, type VehicleState } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';

// The numbers on "Today" (DSH-01). Every figure here is also a list one
// click away; nothing is computed that the lists cannot reproduce.

export function summaryRoutes(app: FastifyInstance): void {
  app.get('/api/summary', { config: { scope: 'session' } }, async () => {
    const today = todayISO(new Date(), env.TZ);
    const day = dateFromISO(today)!;
    const [vehicles, rentals, customers, depositsHeld, pickedUpToday, unmatchedLines, openServiceJobs, overdueInstalments, dueBackToday] = await Promise.all([
      prisma.vehicle.groupBy({ by: ['state'], where: { archived: false }, _count: { _all: true } }),
      prisma.rental.findMany({
        where: { status: { in: ['active', 'overdue'] } },
        select: {
          id: true,
          number: true,
          status: true,
          pickedUpOn: true,
          paidThrough: true,
          vinUnconfirmed: true,
          customer: { select: { id: true, name: true, phone: true } },
          // What is owed comes from the periods that were not paid, like
          // everywhere else — there is no stored debt to disagree with them.
          periods: { where: { payStatus: { not: 'paid' } }, select: { amountTetri: true, paidTetri: true } },
        },
      }),
      prisma.customer.count({ where: { archived: false } }),
      prisma.deposit.aggregate({ where: { status: 'held' }, _sum: { amountTetri: true }, _count: { _all: true } }),
      prisma.rental.findMany({
        where: { pickedUpOn: day },
        select: { id: true, number: true, customer: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.statementLine.count({ where: { status: 'unmatched' } }),
      prisma.serviceJob.count({ where: { status: 'open' } }),
      prisma.saleInstalment.findMany({
        where: { dueOn: { lt: day }, payStatus: { not: 'paid' }, sale: { status: { not: 'cancelled' } } },
        select: { amountTetri: true, paidTetri: true },
      }),
      prisma.rental.findMany({
        where: { expectedReturnOn: day, returnedOn: null },
        select: { id: true, number: true, customer: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const fleet = Object.fromEntries(VEHICLE_STATES.map((s) => [s, 0])) as Record<VehicleState, number>;
    for (const g of vehicles) fleet[g.state as VehicleState] = g._count._all;
    let overdue = 0;
    let active = 0;
    let withoutVin = 0;
    // The overdue rentals themselves, deepest first: a count tells nobody who
    // to call (U2). The days come from the same rule the rental card uses.
    const overdueList: { id: string; number: string; customer: { id: string; name: string; phone: string | null }; days: number; debtTetri: number }[] = [];
    for (const r of rentals) {
      const pickedUpOn = isoDate(r.pickedUpOn);
      const paidThroughDate = isoDate(r.paidThrough);
      const status = effectiveRentalStatus(r.status, paidThroughDate, pickedUpOn, today);
      if (status === 'overdue') {
        overdue++;
        overdueList.push({
          id: r.id,
          number: r.number,
          customer: r.customer,
          days: pickedUpOn ? overdueDays(paidThroughDate, pickedUpOn, today) : 0,
          debtTetri: r.periods.reduce((n, p) => n + (p.amountTetri - p.paidTetri), 0),
        });
      } else active++;
      if (r.vinUnconfirmed) withoutVin++;
    }
    overdueList.sort((a, b) => b.days - a.days || b.debtTetri - a.debtTetri);
    return {
      today,
      fleet,
      rentals: { active, overdue, withoutVin },
      overdueList,
      customers,
      deposits: { held: depositsHeld._count._all, heldTetri: depositsHeld._sum.amountTetri ?? 0 },
      // What today asks a person to do, not only what it counts (DSH-01).
      unmatchedLines,
      openServiceJobs,
      // Sales behind their schedule (SAL-02), in money rather than in rows.
      salesOverdueTetri: overdueInstalments.reduce((n, i) => n + (i.amountTetri - i.paidTetri), 0),
      pickedUpToday: pickedUpToday.map((r) => ({ id: r.id, number: r.number, customer: r.customer.name })),
      dueBackToday: dueBackToday.map((r) => ({ id: r.id, number: r.number, customer: r.customer.name })),
    };
  });
}
