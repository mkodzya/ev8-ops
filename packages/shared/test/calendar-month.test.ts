// The month's totals and its weeks on "Деньги → Календарь" (director, 22.10.2026).
// Literal dates: "today" is Thursday 22.10.2026; the grid of October is
// 28.09 – 01.11. Every figure is made up.
import { describe, expect, it } from 'vitest';
import { calendarMonthTotals, type CalendarEntry, type CalendarWeek } from '../src/calendar.js';

const entry = (dueOn: string, amountTetri: number, paidTetri: number): CalendarEntry => ({
  rentalId: `r-${dueOn}-${paidTetri}`,
  seq: 1,
  dueOn,
  endsOn: dueOn,
  amountTetri,
  paidTetri,
  leftTetri: amountTetri - paidTetri,
  state: paidTetri === amountTetri ? 'paid' : 'expected',
  paidOn: null,
  channel: null,
  paymentId: null,
  projected: false,
  creditTetri: 0,
});

const week = (from: string, to: string): CalendarWeek => {
  const nought = { count: 0, tetri: 0 };
  return { from, to, expected: nought, paid: nought, paidAhead: nought, partTetri: 0, left: nought, overdue: nought, dueToday: nought, upcoming: nought, heaviest: null, receivedTetri: 0 };
};

const weeks = [
  week('2026-09-28', '2026-10-04'),
  week('2026-10-05', '2026-10-11'),
  week('2026-10-12', '2026-10-18'),
  week('2026-10-19', '2026-10-25'),
  week('2026-10-26', '2026-11-01'),
];

describe('calendarMonthTotals', () => {
  const entries = [
    entry('2026-09-30', 15000, 0), // September: not October's, though its week is
    entry('2026-10-01', 15000, 15000),
    entry('2026-10-15', 15000, 0), // short: due before today, nothing came
    entry('2026-10-21', 15000, 5000), // short by 100
    entry('2026-10-22', 15000, 15000), // today, paid
    entry('2026-10-23', 15000, 0), // still awaited
    entry('2026-11-01', 15000, 0), // November: in the grid, not in the month
  ];
  const m = calendarMonthTotals({ entries, weeks }, '2026-10-22', '2026-10-22');

  it('counts only the month’s own days', () => {
    expect(m.month).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(m.total.due).toEqual({ count: 5, tetri: 75000 });
  });

  it('adds up: due = paid + short + waiting', () => {
    const { due, paid, short, waiting } = m.total;
    expect(paid).toEqual({ count: 2, tetri: 35000 });
    expect(short).toEqual({ count: 2, tetri: 25000 });
    expect(waiting).toEqual({ count: 1, tetri: 15000 });
    expect(paid.tetri + short.tetri + waiting.tetri).toBe(due.tetri);
  });

  it('cuts the edge weeks to the month', () => {
    expect(m.weeks.map((w) => [w.from, w.to])).toEqual([
      ['2026-10-01', '2026-10-04'],
      ['2026-10-05', '2026-10-11'],
      ['2026-10-12', '2026-10-18'],
      ['2026-10-19', '2026-10-25'],
      ['2026-10-26', '2026-10-31'],
    ]);
    expect(m.weeks[0].due.tetri).toBe(15000);
    expect(m.weeks[3].short.tetri).toBe(10000);
    expect(m.weeks[4].due.count).toBe(0);
  });
});
