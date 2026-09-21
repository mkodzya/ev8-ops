import { VEHICLE_STATES, todayISO, type VehicleState } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { dateFromISO } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { mayView } from '../lib/guard.js';
import { rentalsNow } from '../lib/overdue.js';

// The numbers on "Today" (DSH-01). Every figure here is also a list one
// click away; nothing is computed that the lists cannot reproduce.

export function summaryRoutes(app: FastifyInstance): void {
  app.get('/api/summary', { config: { scope: 'session' } }, async (req) => {
    const today = todayISO(new Date(), env.TZ);
    const day = dateFromISO(today)!;
    const [vehicles, rentals, customers, depositsHeld, pickedUpToday, unmatchedLines, openServiceJobs, overdueInstalments, dueBackToday] = await Promise.all([
      prisma.vehicle.groupBy({ by: ['state'], where: { archived: false }, _count: { _all: true } }),
      // Who is behind and by how much: the one scan the week's report reads too.
      rentalsNow(),
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
    const { awaitingPayment, overdue: overdueList, active, withoutVin } = rentals;

    // Returns a manager closed: the deposit waits for an owner (wave 3 §3.5, D8).
    const undecided = mayView(req, 'deposit.decide')
      ? await prisma.rental.findMany({
          where: { status: 'returned', deposit: { status: 'held', decidedById: null, paidTetri: { gt: 0 } } },
          select: { id: true, number: true, returnedOn: true, customer: { select: { name: true } } },
          orderBy: { returnedOn: 'asc' },
        })
      : [];
    return {
      awaitingPayment,
      depositsUndecided: undecided.map((r) => ({
        id: r.id,
        number: r.number,
        customer: r.customer.name,
        days: r.returnedOn ? Math.max(0, Math.round((day.getTime() - r.returnedOn.getTime()) / 86_400_000)) : 0,
      })),
      today,
      fleet,
      rentals: { active, overdue: overdueList.length, withoutVin },
      overdueList,
      customers,
      // How much deposit money is held is the owners' number (redesign §2.1).
      deposits: { held: depositsHeld._count._all, heldTetri: mayView(req, 'deposit.decide') ? (depositsHeld._sum.amountTetri ?? 0) : null },
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
