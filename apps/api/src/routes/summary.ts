import { VEHICLE_STATES, effectiveRentalStatus, todayISO, type VehicleState } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';

// The numbers on "Today" (DSH-01). Every figure here is also a list one
// click away; nothing is computed that the lists cannot reproduce.

export function summaryRoutes(app: FastifyInstance): void {
  app.get('/api/summary', { config: { scope: 'session' } }, async () => {
    const today = todayISO(new Date(), env.TZ);
    const [vehicles, rentals, customers, depositsHeld] = await Promise.all([
      prisma.vehicle.groupBy({ by: ['state'], where: { archived: false }, _count: { _all: true } }),
      prisma.rental.findMany({
        where: { status: { in: ['active', 'overdue'] } },
        select: { id: true, status: true, pickedUpOn: true, paidThrough: true, vinUnconfirmed: true },
      }),
      prisma.customer.count({ where: { archived: false } }),
      prisma.deposit.aggregate({ where: { status: 'held' }, _sum: { amountTetri: true }, _count: { _all: true } }),
    ]);
    const fleet = Object.fromEntries(VEHICLE_STATES.map((s) => [s, 0])) as Record<VehicleState, number>;
    for (const g of vehicles) fleet[g.state as VehicleState] = g._count._all;
    let overdue = 0;
    let active = 0;
    let withoutVin = 0;
    for (const r of rentals) {
      const status = effectiveRentalStatus(r.status, isoDate(r.paidThrough), isoDate(r.pickedUpOn), today);
      if (status === 'overdue') overdue++;
      else active++;
      if (r.vinUnconfirmed) withoutVin++;
    }
    return {
      today,
      fleet,
      rentals: { active, overdue, withoutVin },
      customers,
      deposits: { held: depositsHeld._count._all, heldTetri: depositsHeld._sum.amountTetri ?? 0 },
    };
  });
}
