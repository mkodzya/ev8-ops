import { VEHICLE_STATES, todayISO, type VehicleState } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { dateFromISO } from '../lib/dates.js';
import { depositsOverview } from '../lib/deposits.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { mayTotal, mayView } from '../lib/guard.js';
import { rentalsNow } from '../lib/overdue.js';

// The numbers on "Today" (DSH-01). Every figure here is also a list one
// click away; nothing is computed that the lists cannot reproduce.

export function summaryRoutes(app: FastifyInstance): void {
  app.get('/api/summary', { config: { scope: 'fleet.view' } }, async (req) => {
    const today = todayISO(new Date(), env.TZ);
    const day = dateFromISO(today)!;
    const [vehicles, rentals, customers, pickedUpToday, unmatchedLines, openServiceJobs, overdueInstalments, dueBackToday] = await Promise.all([
      prisma.vehicle.groupBy({ by: ['state'], where: { archived: false }, _count: { _all: true } }),
      // Who is behind and by how much: the one scan the week's report reads too.
      rentalsNow(),
      prisma.customer.count({ where: { archived: false } }),
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
    const { dueToday, overdue: overdueList, active, withoutVin } = rentals;

    const deposits = mayView(req, 'deposit.decide') ? await depositsOverview() : null;

    // Returns a manager closed: the deposit waits for an owner (wave 3 §3.5, D8).
    const undecided = mayView(req, 'deposit.decide')
      ? await prisma.rental.findMany({
          where: { status: 'returned', deposit: { status: 'held', decidedById: null, paidTetri: { gt: 0 } } },
          select: { id: true, number: true, returnedOn: true, customer: { select: { name: true } } },
          orderBy: { returnedOn: 'asc' },
        })
      : [];
    return {
      // Every rental whose week began today (ADR-0017) — the hand-over day was its only case before.
      dueToday,
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
      // The same one function every other screen reads (`lib/deposits.ts`).
      // A second count of this figure is how "Сегодня" came to disagree with
      // "Деньги → Залоги" by 3 160 ₾ (QA-W6-21).
      deposits: { held: deposits?.totals.rentals ?? 0, heldTetri: deposits?.totals.heldTetri ?? null },
      // What today asks a person to do, not only what it counts (DSH-01).
      unmatchedLines,
      openServiceJobs,
      // Sales behind their schedule (SAL-02), in money rather than in rows —
      // every buyer's together, an owner's (Mika's «да» of 25.10.2026, ADR-0048 addendum).
      salesOverdueTetri: mayTotal(req) ? overdueInstalments.reduce((n, i) => n + (i.amountTetri - i.paidTetri), 0) : null,
      pickedUpToday: pickedUpToday.map((r) => ({ id: r.id, number: r.number, customer: r.customer.name })),
      dueBackToday: dueBackToday.map((r) => ({ id: r.id, number: r.number, customer: r.customer.name })),
    };
  });
}
