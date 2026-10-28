import { scheduleCounts, todayISO, weekOf, type NavCounts } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { calendarAnswer } from '../lib/calendar.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { mayView } from '../lib/guard.js';
import { migrationLeft } from './migration.js';

// The numbers beside the sections (issue #15 of the director, ADR-0048): the
// rail, the phone bar and the section tabs read them from this one request.
// Each is counted only for whoever has the section, and each the way its
// screen counts it, so a number never says more or less than the list it
// opens (ux №10): «Оплаты по графику» from the calendar's own answer for the
// week of today, «Разобрать» from the queue, the till from the hand-overs.
// "Today" keeps its badge from /api/today, the queue it counts.

export function navRoutes(app: FastifyInstance): void {
  app.get('/api/nav/counts', { config: { scope: 'fleet.view' } }, async (req): Promise<NavCounts> => {
    const today = todayISO(new Date(), env.TZ);
    const owner = mayView(req, 'payments.reconcile');
    const [schedule, lines, till, migration] = await Promise.all([
      mayView(req, 'payments.schedule') ? calendarAnswer(weekOf(today), today).then(scheduleCounts) : null,
      mayView(req, 'payments.sort.customer') || owner ? prisma.statementLine.groupBy({ by: ['direction'], where: { status: 'unmatched' }, _count: { _all: true } }) : null,
      owner ? prisma.cashHandover.count({ where: { status: 'pending' } }) : null,
      // «До EV8 Ops» shows while it has something left (issue #18, B6) — the tab of whoever reads it.
      mayView(req, 'users.manage') ? migrationLeft() : null,
    ]);
    const of = (d: 'in' | 'out') => lines?.find((l) => l.direction === d)?._count._all ?? 0;
    return {
      schedule,
      // A manager sorts the money coming in; going out is an owner's, and so is its number.
      sort: lines ? { in: of('in'), out: owner ? of('out') : null } : null,
      till,
      migration,
    };
  });
}
