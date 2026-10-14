// The day of the week a rental's rent is due (ADR-0022).
//
// Literal dates: Monday 12.10.2026 … Sunday 18.10.2026. The two renters of the
// decision, with made-up rentals: one picked up on a Tuesday who pays on
// Wednesday, one picked up on a Monday who pays on Thursday.
import { describe, expect, it } from 'vitest';
import {
  customerDebt,
  effectiveRentalStatus,
  isoWeekday,
  overdueDays,
  payOffsetDays,
  rentDueOn,
  weekDue,
  weekDueOn,
} from '../src/index.js';

const TUE_PICKUP = '2026-05-19';
const MON_PICKUP = '2026-08-03';

describe('the pay day of a rental (ADR-0022)', () => {
  it('knows the weekday of a date, Monday 1 … Sunday 7', () => {
    expect(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map(isoWeekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(isoWeekday(TUE_PICKUP)).toBe(2);
    expect(isoWeekday(MON_PICKUP)).toBe(1);
  });

  it('says how many days into its week the rent is due', () => {
    expect(payOffsetDays(TUE_PICKUP, 3)).toBe(1);
    expect(payOffsetDays(MON_PICKUP, 4)).toBe(3);
    // No pay day, or the pickup's own weekday: the first day, as for every rental.
    expect(payOffsetDays(TUE_PICKUP, null)).toBe(0);
    expect(payOffsetDays(TUE_PICKUP, 2)).toBe(0);
    expect(payOffsetDays(null, 3)).toBe(0);
    // A pay day earlier in the calendar week falls later in the rental's week.
    expect(payOffsetDays('2026-10-15', 1)).toBe(4);
    expect(weekDueOn('2026-10-13', 1)).toBe('2026-10-14');
    expect(weekDueOn('2026-10-13')).toBe('2026-10-13');
  });

  it('moves the due day, and with it the first day of lateness, but not the weeks', () => {
    // Paid through Monday 12.10: the week 13–19.10 is due on Wednesday 14.10.
    expect(rentDueOn('2026-10-12', TUE_PICKUP, 1)).toBe('2026-10-14');
    expect(rentDueOn('2026-10-12', TUE_PICKUP)).toBe('2026-10-13');
    const status = (today: string, offset: number) => effectiveRentalStatus('active', '2026-10-12', TUE_PICKUP, today, offset);
    expect([status('2026-10-13', 1), status('2026-10-14', 1), status('2026-10-15', 1)]).toEqual(['active', 'due_today', 'overdue']);
    expect([status('2026-10-13', 0), status('2026-10-14', 0)]).toEqual(['due_today', 'overdue']);
    expect(overdueDays('2026-10-12', TUE_PICKUP, '2026-10-14', 1)).toBe(0);
    expect(overdueDays('2026-10-12', TUE_PICKUP, '2026-10-16', 1)).toBe(2);
    // Paid through Sunday 11.10, Thursday payer: not late on Monday or Wednesday, due on Thursday 15.10.
    const mon = (today: string) => effectiveRentalStatus('overdue', '2026-10-11', MON_PICKUP, today, 3);
    expect([mon('2026-10-12'), mon('2026-10-14'), mon('2026-10-15'), mon('2026-10-16')]).toEqual(['active', 'active', 'due_today', 'overdue']);
    // A decision is not touched by a pay day.
    expect(effectiveRentalStatus('paused', '2026-10-11', MON_PICKUP, '2026-10-20', 3)).toBe('paused');
  });

  it('the one debt figure holds a week from its pay day', () => {
    const debt = (today: string, payOffsetDays?: number) =>
      customerDebt({
        today,
        rentals: [
          {
            id: 'r1',
            number: 'R-1',
            open: true,
            periods: [
              { startsOn: '2026-10-06', amountTetri: 14000, paidTetri: 14000 },
              { startsOn: '2026-10-13', amountTetri: 14000, paidTetri: 0 },
            ],
            payOffsetDays,
            deposit: null,
          },
        ],
        sales: [],
        repairs: [],
        unplacedTetri: 0,
        depositHeldTetri: 0,
      }).owesTetri;
    expect(debt('2026-10-13', 1)).toBe(0);
    expect(debt('2026-10-14', 1)).toBe(14000);
    expect(debt('2026-10-13')).toBe(14000);
  });

  it('a week on the rental card is ahead, due or late by its pay day', () => {
    const weeks = [
      { seq: 1, startsOn: '2026-10-06', amountTetri: 15000, paidTetri: 15000 },
      { seq: 2, startsOn: '2026-10-13', amountTetri: 15000, paidTetri: 0 },
    ];
    expect(weekDue(weeks[1], weeks, '2026-10-13', 1)).toBe('ahead');
    expect(weekDue(weeks[1], weeks, '2026-10-14', 1)).toBe('due_today');
    expect(weekDue(weeks[1], weeks, '2026-10-15', 1)).toBe('late');
    expect(weekDue(weeks[1], weeks, '2026-10-14')).toBe('late');
  });
});
