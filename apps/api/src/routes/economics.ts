// Per-moped economics (DSH-03) and how busy the rental fleet was (M-10).
import { goodsEconomics, monthOf, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { isoDate } from '../lib/dates.js';
import { fleetEconomics, goodsLinesOf } from '../lib/economics.js';
import { env } from '../lib/env.js';
import { badRequest, notFound } from '../lib/errors.js';
import { lifetimeUtilisation, utilisationOf } from '../lib/utilisation.js';
import { date } from '../lib/validate.js';

export function economicsRoutes(app: FastifyInstance): void {
  /**
   * M-10 over a period (wave 6 §3.2). Both ends are days, both included;
   * without them it answers for the last 30 days, which is what the screen
   * opens on.
   */
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/reports/utilisation', { config: { scope: 'reports.view' } }, async (req) => {
    const to = date(req.query, 'to') ?? todayISO(new Date(), env.TZ);
    const from = date(req.query, 'from') ?? isoDate(new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000))!;
    if (from > to) throw badRequest('bad_period', 'The period starts after it ends.', { field: 'from' });
    return utilisationOf(from, to);
  });

  /**
   * Goods sold over the counter (issue #11, ADR-0045): revenue with its VAT,
   * the net, the cost and the margin of the lines whose cost is known, by the
   * day of the sale. This month unless a period is asked; `all=1` — all time.
   */
  app.get<{ Querystring: { from?: string; to?: string; all?: string } }>('/api/economics/goods', { config: { scope: 'reports.view' } }, async (req) => {
    const month = monthOf(todayISO(new Date(), env.TZ));
    const period = req.query.all === '1' ? null : { from: date(req.query, 'from') ?? month.from, to: date(req.query, 'to') ?? month.to };
    if (period && period.from > period.to) throw badRequest('bad_period', 'The period starts after it ends.', { field: 'from' });
    return { period, ...goodsEconomics(await goodsLinesOf(), period) };
  });

  app.get('/api/economics', { config: { scope: 'reports.view' } }, async () => {
    const [plain, busy] = await Promise.all([fleetEconomics(), lifetimeUtilisation()]);
    // How busy each one was is M-10 over its whole life (§3.3): the same
    // function the utilisation screen uses, never a second count of days.
    const rows = plain.map((r) => ({ ...r, utilisation: busy.get(r.id)?.percent ?? null }));
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
    const busy = (await lifetimeUtilisation()).get(row.id) ?? null;
    return { economics: { ...row, utilisation: busy?.percent ?? null } };
  });
}
