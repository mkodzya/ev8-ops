// Per-moped economics (DSH-03).
import type { FastifyInstance } from 'fastify';
import { fleetEconomics } from '../lib/economics.js';
import { notFound } from '../lib/errors.js';

export function economicsRoutes(app: FastifyInstance): void {
  app.get('/api/economics', { config: { scope: 'reports.view' } }, async () => {
    const rows = await fleetEconomics();
    // Mopeds nobody priced are counted apart rather than folded in at zero,
    // so a total is never quietly short of what it claims to cover.
    const priced = rows.filter((r) => r.costTetri != null);
    const totals = {
      vehicles: rows.length,
      unpriced: rows.length - priced.length,
      costTetri: priced.reduce((n, r) => n + (r.costTetri ?? 0), 0),
      rentalRevenueTetri: rows.reduce((n, r) => n + r.rentalRevenueTetri, 0),
      saleRevenueTetri: rows.reduce((n, r) => n + r.saleRevenueTetri, 0),
      buyBackTetri: rows.reduce((n, r) => n + r.buyBackTetri, 0),
      serviceCompanyTetri: rows.reduce((n, r) => n + r.serviceCompanyTetri, 0),
      marginTetri: priced.reduce((n, r) => n + (r.marginTetri ?? 0), 0),
      rentedDays: rows.reduce((n, r) => n + r.days.rented, 0),
      idleDays: rows.reduce((n, r) => n + r.idleDays, 0),
    };
    return { rows, totals };
  });

  app.get<{ Params: { id: string } }>('/api/fleet/:id/economics', { config: { scope: 'reports.view' } }, async (req) => {
    const [row] = await fleetEconomics({ vehicleIds: [req.params.id] });
    if (!row) throw notFound('vehicle_not_found', 'No such vehicle.');
    return { economics: row };
  });
}
