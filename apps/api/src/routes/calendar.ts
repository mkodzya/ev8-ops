import { CALENDAR_FIRST_DAY, CALENDAR_HORIZON_DAYS, CALENDAR_MAX_DAYS, addDays, calendarGrid, daysBetween, scheduleOf, todayISO, type CalendarAnswer, type Period } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { calendarAnswer } from '../lib/calendar.js';
import { env } from '../lib/env.js';
import { badRequest } from '../lib/errors.js';
import { mayView } from '../lib/guard.js';
import { date } from '../lib/validate.js';

// «Оплаты по графику» (issue #15; was "Деньги → Календарь",
// docs/redesign/payments-calendar.md): who pays today,
// who pays tomorrow, who is late, and what a week should bring. One request
// per month shown — the answer carries every week of the grid and the week of
// today, so choosing another day on the screen is a lookup, not a request.
//
// It sits beside the money form (`/api/money`) and not under `/api/payments`:
// it is not a list of payments, and `/api/payments/calendar` would be read as
// `/api/payments/:id`.

type Query = { from?: string; to?: string };

/** The range asked for, or the grid of the month today is in. */
function rangeOf(query: Query, today: string): Period {
  const from = date(query, 'from');
  const to = date(query, 'to');
  if (from == null && to == null) return calendarGrid(today);
  if (from == null) throw badRequest('missing_field', 'from is required', { field: 'from' });
  if (to == null) throw badRequest('missing_field', 'to is required', { field: 'to' });
  // Before anything is counted from it: `0000-01-01` reads as a date, and the
  // walk over its weeks would never end.
  if (from < CALENDAR_FIRST_DAY) throw badRequest('bad_period', 'The calendar does not reach that far back.', { field: 'from' });
  if (from > to) throw badRequest('bad_period', 'The period starts after it ends.', { field: 'from' });
  if (daysBetween(from, to) + 1 > CALENDAR_MAX_DAYS) {
    throw badRequest('bad_period', `The calendar shows at most ${CALENDAR_MAX_DAYS} days at once.`, { field: 'to' });
  }
  if (to > addDays(today, CALENDAR_HORIZON_DAYS)) {
    throw badRequest('bad_period', 'The calendar does not reach that far ahead.', { field: 'to' });
  }
  // The schedule starts at each rental's hand-over whatever `from` is. The
  // days need not be a Monday and a Sunday — the answer widens to whole weeks.
  return { from, to };
}

export function calendarRoutes(app: FastifyInstance): void {
  /**
   * Whoever calls those who pay reads the rows (`payments.schedule`, a
   * manager too since issue #15); the week's and the month's figures, a
   * day's total and the money received go only to whoever reads Money
   * (`payments.view`). The cut is made here, on the server — the screen
   * that hides a sum it was sent hides nothing (ADR-0048).
   */
  app.get<{ Querystring: Query }>('/api/money/calendar', { config: { scope: 'payments.schedule' } }, async (req): Promise<CalendarAnswer> => {
    const today = todayISO(new Date(), env.TZ);
    const answer = await calendarAnswer(rangeOf(req.query, today), today);
    return mayView(req, 'payments.view') ? { ...answer, totals: true } : scheduleOf(answer);
  });
}
