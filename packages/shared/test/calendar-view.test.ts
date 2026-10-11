// What the payments calendar's screen decides (docs/redesign/payments-calendar.md
// §3.3, §3.5). Literal dates throughout: "today" is Wednesday 14.10.2026, its
// week is 12–18.10 and the grid of October is 28.09 – 01.11. Screens have no
// tests, so the rules a screen would otherwise keep to itself are checked here.
import { describe, expect, it } from 'vitest';
import { calendarEntriesOn, calendarGrid, calendarWeekOf, paymentsCalendar, type CalendarEntry, type CalendarLate, type CalendarState } from '../src/calendar.js';
import {
  CALENDAR_LATE_SHOWN,
  calendarCanStep,
  calendarCellKind,
  calendarCells,
  calendarDayRows,
  calendarDebtWeeks,
  calendarFold,
  calendarHoldsWeek,
  calendarLateShown,
  calendarLegend,
  calendarLimits,
  calendarReceivedPeriod,
  calendarStep,
  calendarViewOf,
  calendarViewParams,
  calendarWeekday,
  type CalendarView,
} from '../src/calendar-view.js';

const TODAY = '2026-10-14';

/** An address as the page reads it. */
const address = (query: string) => {
  const params = new URLSearchParams(query);
  return (key: 'm' | 'd' | 'all') => params.get(key);
};

const view = (query: string): CalendarView => calendarViewOf(address(query), TODAY);

describe('the address of the calendar (§3.5.1)', () => {
  it('with nothing in it is today, this month, one week', () => {
    expect(view('')).toEqual({ day: TODAY, all: false });
  });

  it('takes the day from `d`, and the open month from `all=1`', () => {
    expect(view('d=2026-10-16')).toEqual({ day: '2026-10-16', all: false });
    expect(view('d=2026-10-16&all=1')).toEqual({ day: '2026-10-16', all: true });
  });

  it('with `m` alone is today in the current month and the 1st in any other', () => {
    expect(view('m=2026-10').day).toBe(TODAY);
    expect(view('m=2026-11').day).toBe('2026-11-01');
    expect(view('m=2026-09&all=1')).toEqual({ day: '2026-09-01', all: true });
  });

  it('lets a day outside `m` choose the month', () => {
    expect(view('m=2026-10&d=2026-11-16').day).toBe('2026-11-16');
  });

  it('counts a value that does not read as absent', () => {
    expect(view('d=2026-13-40&m=october&all=yes')).toEqual({ day: TODAY, all: false });
    expect(view('d=16.10.2026').day).toBe(TODAY);
    // An unreadable day leaves the month to speak.
    expect(view('m=2026-11&d=tomorrow').day).toBe('2026-11-01');
  });

  // The API refuses a range more than a year ahead, and the arrows stop three
  // months ahead: a link beyond that opens today rather than a refusal.
  it('counts a day past the forward limit as absent', () => {
    expect(view('d=2027-01-31').day).toBe('2027-01-31');
    expect(view('d=2027-02-01').day).toBe(TODAY);
    expect(view('m=2027-02').day).toBe(TODAY);
  });

  // The limit's own week runs on past it when the month ends mid-week
  // (31.03.2027 is a Wednesday). A phone draws those days as cells, so `d`
  // reads them; `m` alone still stops at the limit's month.
  it('reads a day of the week the forward limit falls in, and no further', () => {
    const at = (query: string) => calendarViewOf(address(query), '2026-12-14').day;
    expect(at('d=2027-03-31')).toBe('2027-03-31');
    expect(at('m=2027-04&d=2027-04-02')).toBe('2027-04-02');
    expect(at('d=2027-04-04')).toBe('2027-04-04');
    expect(at('d=2027-04-05')).toBe('2026-12-14');
    expect(at('m=2027-04')).toBe('2026-12-14');
  });

  // The API's floor (CALENDAR_FIRST_DAY). January 2000 itself is out: its 1st
  // is a Saturday, and the Monday of that week is in 1999.
  it('never asks for a month the API cannot count', () => {
    expect(view('d=0000-01-15').day).toBe(TODAY);
    expect(view('m=0000-01').day).toBe(TODAY);
    expect(view('m=1999-12').day).toBe(TODAY);
    expect(view('d=2000-01-15').day).toBe(TODAY);
    expect(view('d=2000-02-15').day).toBe('2000-02-15');
  });

  it('writes only what differs from the plain screen, month first', () => {
    expect(calendarViewParams({ day: TODAY, all: false }, TODAY)).toEqual({});
    expect(calendarViewParams({ day: '2026-10-16', all: false }, TODAY)).toEqual({ d: '2026-10-16' });
    expect(calendarViewParams({ day: '2026-11-16', all: false }, TODAY)).toEqual({ m: '2026-11', d: '2026-11-16' });
    expect(calendarViewParams({ day: TODAY, all: true }, TODAY)).toEqual({ all: '1' });
    expect(Object.keys(calendarViewParams({ day: '2026-11-16', all: true }, TODAY))).toEqual(['m', 'd', 'all']);
  });

  it('reads back what it wrote', () => {
    const views: CalendarView[] = [
      { day: TODAY, all: false },
      { day: TODAY, all: true },
      { day: '2026-10-01', all: false },
      { day: '2026-11-01', all: true },
      { day: '2026-09-30', all: false },
      { day: '2027-01-31', all: true },
    ];
    for (const v of views) {
      const written: Record<string, string | undefined> = calendarViewParams(v, TODAY);
      expect(calendarViewOf((key) => written[key] ?? null, TODAY)).toEqual(v);
    }
  });
});

describe('the arrows (§3.5.2, §3.5.3, §3.5.13)', () => {
  it('step a week to the same weekday, across a month and across a year', () => {
    expect(calendarStep('2026-10-28', 1, 'week')).toBe('2026-11-04');
    expect(calendarStep('2026-10-02', -1, 'week')).toBe('2026-09-25');
    expect(calendarStep('2026-12-30', 1, 'week')).toBe('2027-01-06');
    expect(calendarStep('2027-01-03', -1, 'week')).toBe('2026-12-27');
  });

  it('step a month to the same number, or to the last day when the month has none', () => {
    expect(calendarStep('2026-10-15', 1, 'month')).toBe('2026-11-15');
    expect(calendarStep('2026-10-31', 1, 'month')).toBe('2026-11-30');
    expect(calendarStep('2027-01-31', 1, 'month')).toBe('2027-02-28');
    expect(calendarStep('2027-03-31', -1, 'month')).toBe('2027-02-28');
    expect(calendarStep('2028-03-31', -1, 'month')).toBe('2028-02-29');
    expect(calendarStep('2026-12-15', 1, 'month')).toBe('2027-01-15');
  });

  it('go back to the month of the earliest hand-over and three months ahead', () => {
    expect(calendarLimits(TODAY, '2026-09-30')).toEqual({ from: '2026-09-01', to: '2027-01-31' });
    // Nobody rents: the current month is as far back as there is anything.
    expect(calendarLimits(TODAY, null)).toEqual({ from: '2026-10-01', to: '2027-01-31' });
  });

  it('are off exactly at the edge, by the month and by the week', () => {
    const limits = calendarLimits(TODAY, '2026-09-30');
    expect(calendarCanStep('2026-10-14', -1, 'month', limits)).toBe(true);
    expect(calendarCanStep('2026-09-14', -1, 'month', limits)).toBe(false);
    expect(calendarCanStep('2026-12-14', 1, 'month', limits)).toBe(true);
    expect(calendarCanStep('2027-01-14', 1, 'month', limits)).toBe(false);

    // 01.09.2026 is a Tuesday: its week, 31.08 – 06.09, holds the limit's first days.
    expect(calendarCanStep('2026-09-08', -1, 'week', limits)).toBe(true);
    expect(calendarCanStep('2026-09-07', -1, 'week', limits)).toBe(true);
    expect(calendarCanStep('2026-09-06', -1, 'week', limits)).toBe(false);
    expect(calendarCanStep('2026-08-31', -1, 'week', limits)).toBe(false);
    // 31.01.2027 is a Sunday: the limit ends with its week.
    expect(calendarCanStep('2027-01-24', 1, 'week', limits)).toBe(true);
    expect(calendarCanStep('2027-01-25', 1, 'week', limits)).toBe(false);
  });

  // A phone's row is a week, so the arrow is measured by the week it lands in:
  // by the day, six weekdays of seven could not reach a month's first days
  // when it begins late in a week.
  it('reach the week a limit falls in from any weekday', () => {
    const back = calendarLimits('2026-11-18', '2026-11-03');
    expect(back.from).toBe('2026-11-01'); // a Sunday: the week is 26.10 – 01.11
    for (const day of ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-08']) {
      expect(calendarCanStep(day, -1, 'week', back)).toBe(true);
    }
    expect(calendarCanStep('2026-11-01', -1, 'week', back)).toBe(false);

    // From December the forward limit is Wednesday 31.03.2027; its week is 29.03 – 04.04.
    const ahead = calendarLimits('2026-12-14', '2026-12-01');
    expect(ahead.to).toBe('2027-03-31');
    for (const day of ['2027-03-22', '2027-03-25', '2027-03-28']) {
      expect(calendarCanStep(day, 1, 'week', ahead)).toBe(true);
    }
    for (const day of ['2027-03-29', '2027-03-31', '2027-04-02', '2027-04-04']) {
      expect(calendarCanStep(day, 1, 'week', ahead)).toBe(false);
    }
    // By the month the limit is the day itself, as before.
    expect(calendarCanStep('2027-02-28', 1, 'month', ahead)).toBe(true);
    expect(calendarCanStep('2027-03-31', 1, 'month', ahead)).toBe(false);
  });

  // Every day an arrow can land on, and every cell of the row it shows, is an
  // address the page reads back — or a tap would throw the screen to today.
  it('never lead to a day the address refuses', () => {
    const today = '2026-12-14';
    const limits = calendarLimits(today, '2026-12-01');
    const at = (query: string) => calendarViewOf(address(query), today).day;
    for (const from of ['2027-03-22', '2027-03-25', '2027-03-28']) {
      const to = calendarStep(from, 1, 'week');
      expect(calendarCanStep(from, 1, 'week', limits)).toBe(true);
      for (const cell of calendarCells(to, 'week')) expect(at(`d=${cell}`)).toBe(cell);
    }
  });

  // An address typed by hand (crit. 36): the month is shown, "‹" is off, and
  // "›" still leads back towards the months that have something in them.
  it('lead back in from a month before the back limit', () => {
    const limits = calendarLimits(TODAY, '2026-09-30');
    expect(calendarCanStep('2026-07-14', -1, 'month', limits)).toBe(false);
    expect(calendarCanStep('2026-07-14', 1, 'month', limits)).toBe(true);
  });
});

describe('the cells of a grid (§3.3, crit. 17)', () => {
  const numbers = (cells: (string | null)[]) => cells.map((c) => (c === null ? null : Number(c.slice(8))));
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const blank = (n: number) => Array.from({ length: n }, () => null);

  it('October 2026: five rows, three empty cells, 1…31, one empty cell', () => {
    const cells = calendarCells(TODAY, 'month');
    expect(cells).toHaveLength(35);
    expect(numbers(cells)).toEqual([...blank(3), ...range(1, 31), ...blank(1)]);
    expect(cells[3]).toBe('2026-10-01');
  });

  it('November 2026: six rows — the 1st is a Sunday, the 30th a Monday', () => {
    const cells = calendarCells('2026-11-16', 'month');
    expect(cells).toHaveLength(42);
    expect(numbers(cells)).toEqual([...blank(6), ...range(1, 30), ...blank(6)]);
  });

  // Beyond the forward limit of the arrows, so this is its only check.
  it('February 2027: four rows and no empty cell', () => {
    const cells = calendarCells('2027-02-10', 'month');
    expect(numbers(cells)).toEqual(range(1, 28));
  });

  it('August 2026: six rows — the 1st is a Saturday', () => {
    const cells = calendarCells('2026-08-15', 'month');
    expect(cells).toHaveLength(42);
    expect(numbers(cells)).toEqual([...blank(5), ...range(1, 31), ...blank(6)]);
  });

  it('a week on the edge of two months is seven real days', () => {
    expect(calendarCells('2026-09-30', 'week')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    // The same week, asked from its October side.
    expect(calendarCells('2026-10-02', 'week')).toEqual(calendarCells('2026-09-30', 'week'));
  });

  it('know the weekday of a day, Monday first', () => {
    expect(calendarWeekday('2026-10-12')).toBe(0);
    expect(calendarWeekday('2026-10-14')).toBe(2);
    expect(calendarWeekday('2026-10-18')).toBe(6);
  });

  it('stand against the week of today, whichever day is chosen', () => {
    expect(calendarCellKind('2026-10-11', TODAY)).toBe('past');
    expect(calendarCellKind('2026-10-12', TODAY)).toBe('current');
    expect(calendarCellKind('2026-10-18', TODAY)).toBe('current');
    expect(calendarCellKind('2026-10-19', TODAY)).toBe('ahead');
    // On a Sunday the week is still the one that began on Monday.
    expect(calendarCellKind('2026-10-12', '2026-10-18')).toBe('current');
    expect(calendarCellKind('2026-10-19', '2026-10-18')).toBe('ahead');
  });
});

// A phone showing one week draws it from the answer it has while the month of
// a newly chosen day loads — a tap inside the row must not blank the row.
describe('the week an answer already holds (§3.5.14)', () => {
  /** What the API answers for the month `day` is in, asked on `today`: nobody rents, the days are what matters. */
  const answerFor = (day: string, today: string) => paymentsCalendar({ today, ...calendarGrid(day), rentals: [], credits: [], payments: [] });

  it('a week on the edge of two months is in the answer for either month', () => {
    const october = answerFor('2026-10-28', '2026-10-28');
    const november = answerFor('2026-11-01', '2026-10-28');
    // 26.10 – 01.11: chosen from its October side and from its November side.
    for (const day of ['2026-10-26', '2026-10-28', '2026-11-01']) {
      expect(calendarHoldsWeek(october, day)).toBe(true);
      expect(calendarHoldsWeek(november, day)).toBe(true);
    }
    expect(calendarHoldsWeek(october, '2026-11-02')).toBe(false);
    expect(calendarHoldsWeek(november, '2026-10-25')).toBe(false);
  });

  it('holds the week whole: its totals, each of its days, and the Monday after', () => {
    const october = answerFor('2026-10-28', '2026-10-28');
    expect(calendarWeekOf(october, '2026-11-01')).toMatchObject({ from: '2026-10-26', to: '2026-11-01' });
    const days = new Set(october.days.map((d) => d.date));
    for (const day of [...calendarCells('2026-11-01', 'week'), '2026-11-02']) expect(days.has(day!)).toBe(true);
    expect(calendarEntriesOn(october, '2026-11-01')).toEqual([]);
  });

  it('the week of today is in an answer for any month', () => {
    const august = answerFor('2026-08-10', TODAY);
    expect(calendarHoldsWeek(august, TODAY)).toBe(true);
    expect(calendarHoldsWeek(august, '2026-08-31')).toBe(true);
    expect(calendarHoldsWeek(august, '2026-09-07')).toBe(false);
  });
});

describe('the legend shows only the keys the cells justify (§3.5.6)', () => {
  it('the week of today: the count, overdue, today', () => {
    expect(calendarLegend(calendarCells(TODAY, 'week'), TODAY)).toEqual({ counts: true, allPaid: false, late: true, today: true, aheadOnly: false });
  });

  it('a past week: how the days ended', () => {
    expect(calendarLegend(calendarCells('2026-10-07', 'week'), TODAY)).toEqual({ counts: false, allPaid: true, late: true, today: false, aheadOnly: false });
  });

  it('a week ahead: nothing but the line about the calculation', () => {
    expect(calendarLegend(calendarCells('2026-10-21', 'week'), TODAY)).toEqual({ counts: false, allPaid: false, late: false, today: false, aheadOnly: true });
    expect(calendarLegend(calendarCells('2026-11-16', 'month'), TODAY).aheadOnly).toBe(true);
  });

  it('the month holding today: every key', () => {
    expect(calendarLegend(calendarCells(TODAY, 'month'), TODAY)).toEqual({ counts: true, allPaid: true, late: true, today: true, aheadOnly: false });
  });
});

describe('the days "Пришло денег" names (§4.6)', () => {
  it('Monday to today in the current week', () => {
    expect(calendarReceivedPeriod({ from: '2026-10-12', to: '2026-10-18' }, TODAY)).toEqual({ from: '2026-10-12', to: '2026-10-14' });
  });

  it('the whole of a past week', () => {
    expect(calendarReceivedPeriod({ from: '2026-10-05', to: '2026-10-11' }, TODAY)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });

  it('nothing for a week wholly ahead', () => {
    expect(calendarReceivedPeriod({ from: '2026-10-19', to: '2026-10-25' }, TODAY)).toBeNull();
  });

  it('one day on a Monday', () => {
    expect(calendarReceivedPeriod({ from: '2026-10-12', to: '2026-10-18' }, '2026-10-12')).toEqual({ from: '2026-10-12', to: '2026-10-12' });
  });
});

const entry = (rentalId: string, state: CalendarState, over: Partial<CalendarEntry> = {}): CalendarEntry => {
  const paid = state === 'paid' || state === 'paid_ahead';
  return {
    rentalId,
    seq: 1,
    dueOn: '2026-10-13',
    endsOn: '2026-10-19',
    amountTetri: 150_00,
    paidTetri: paid ? 150_00 : 0,
    leftTetri: paid ? 0 : 150_00,
    state,
    paidOn: null,
    channel: null,
    paymentId: null,
    projected: false,
    creditTetri: 0,
    ...over,
  };
};

const lateRow = (rentalId: string, days: number, debtTetri: number, over: Partial<CalendarLate> = {}): CalendarLate => ({
  rentalId,
  debtTetri,
  overdueTetri: debtTetri,
  weeks: 1,
  sinceOn: '2026-10-13',
  days,
  ...over,
});

const ids = (rows: CalendarEntry[]) => rows.map((e) => e.rentalId);
const abc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** The alphabet backwards: a function with an order of its own would not follow it. */
const zyx = (a: string, b: string): number => abc(b, a);

describe('the rows of a day (§3.5.9)', () => {
  // The approved example's 13.10: Г is late, Б paid on 10.10, В on the day.
  it('stand as in the prototype: who is late, then the paid ones as the money came', () => {
    const rows = [
      entry('В', 'paid', { paidOn: '2026-10-13', channel: 'transfer' }),
      entry('Б', 'paid_ahead', { paidOn: '2026-10-10', channel: 'transfer' }),
      entry('Г', 'overdue'),
    ];
    expect(ids(calendarDayRows(rows, [lateRow('Г', 1, 150_00)], abc))).toEqual(['Г', 'Б', 'В']);
  });

  it('put the longest overdue first, then the larger debt, then ask the comparator', () => {
    const late = [lateRow('m', 7, 300_00), lateRow('x', 7, 450_00), lateRow('y', 9, 150_00), lateRow('p', 7, 300_00), lateRow('q', 7, 300_00)];
    const rows = ['m', 'x', 'y', 'p', 'q'].map((id) => entry(id, 'overdue', { dueOn: TODAY }));
    expect(ids(calendarDayRows(rows, late, abc))).toEqual(['y', 'x', 'm', 'p', 'q']);
    expect(ids(calendarDayRows(rows, late, zyx))).toEqual(['y', 'x', 'q', 'p', 'm']);
  });

  it('keep an overdue row above "due today" above the paid', () => {
    const rows = [entry('a', 'paid', { dueOn: TODAY, paidOn: TODAY }), entry('b', 'due_today', { dueOn: TODAY }), entry('c', 'overdue', { dueOn: TODAY })];
    expect(ids(calendarDayRows(rows, [lateRow('c', 7, 300_00)], abc))).toEqual(['c', 'b', 'a']);
  });

  it('order who is expected with the comparator they are given, not with one of their own', () => {
    const rows = ['b', 'c', 'a'].map((id) => entry(id, 'expected', { dueOn: '2026-10-15' }));
    expect(ids(calendarDayRows(rows, [], abc))).toEqual(['a', 'b', 'c']);
    expect(ids(calendarDayRows(rows, [], zyx))).toEqual(['c', 'b', 'a']);
    const today = ['b', 'c', 'a'].map((id) => entry(id, 'due_today', { dueOn: TODAY }));
    expect(ids(calendarDayRows(today, [], zyx))).toEqual(['c', 'b', 'a']);
  });

  it('put a week paid with no payment after the dated ones', () => {
    const rows = [
      entry('b', 'paid'),
      entry('a', 'paid'),
      entry('d', 'paid', { paidOn: '2026-10-13' }),
      entry('c', 'paid_ahead', { paidOn: '2026-10-10' }),
    ];
    expect(ids(calendarDayRows(rows, [], abc))).toEqual(['c', 'd', 'a', 'b']);
    expect(ids(calendarDayRows(rows, [], zyx))).toEqual(['c', 'd', 'b', 'a']);
  });

  it('leave two weeks paid on one day in the order they came in', () => {
    const rows = [entry('b', 'paid', { paidOn: '2026-10-13' }), entry('a', 'paid', { paidOn: '2026-10-13' })];
    expect(ids(calendarDayRows(rows, [], abc))).toEqual(['b', 'a']);
  });

  it('do not reorder the list they were given', () => {
    const rows = [entry('b', 'paid', { paidOn: '2026-10-13' }), entry('a', 'overdue')];
    const before = [...rows];
    calendarDayRows(rows, [lateRow('a', 1, 150_00)], abc);
    expect(rows).toEqual(before);
  });
});

describe('a long day folds its paid rows (§3.5.8, crit. 27)', () => {
  const day = (unpaid: number, paid: number): CalendarEntry[] => [
    ...Array.from({ length: unpaid }, (_, i) => entry(`u${i}`, 'due_today')),
    ...Array.from({ length: paid }, (_, i) => entry(`p${i}`, i % 2 ? 'paid' : 'paid_ahead', { paidOn: '2026-10-13' })),
  ];

  it('six rows are shown as they are', () => {
    const rows = day(2, 4);
    expect(calendarFold(rows)).toEqual({ shown: rows, folded: [] });
  });

  it('thirteen rows with eight paid: five shown, eight folded', () => {
    const { shown, folded } = calendarFold(day(5, 8));
    expect(ids(shown)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4']);
    expect(folded).toHaveLength(8);
    expect(folded.every((e) => e.leftTetri === 0)).toBe(true);
  });

  it('seven rows nobody has paid are all shown', () => {
    const rows = day(7, 0);
    expect(calendarFold(rows)).toEqual({ shown: rows, folded: [] });
  });

  // A partly paid week keeps the state of its date, so it is never folded away.
  it('never folds a week with something left on it', () => {
    const rows = [...day(0, 8), entry('part', 'due_today', { paidTetri: 50_00, leftTetri: 100_00 })];
    expect(ids(calendarFold(rows).shown)).toEqual(['part']);
  });
});

describe('the laptop\'s "Просрочено" past five rows (§3.5.10, crit. 35)', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => `r${i + 1}`);

  it('shows five as they are', () => {
    expect(CALENDAR_LATE_SHOWN).toBe(5);
    expect(calendarLateShown(rows(5), false)).toEqual({ shown: rows(5), hidden: 0 });
  });

  it('shows the first five of twelve and says seven are hidden', () => {
    expect(calendarLateShown(rows(12), false)).toEqual({ shown: ['r1', 'r2', 'r3', 'r4', 'r5'], hidden: 7 });
  });

  it('shows all twelve when asked, in the order they came', () => {
    const twelve = rows(12);
    expect(calendarLateShown(twelve, true)).toEqual({ shown: twelve, hidden: 0 });
    expect(twelve).toEqual(rows(12));
  });
});

describe('"за N недели" follows the debt only when the debt is those weeks (§3.4, crit. 5, 34)', () => {
  const late = (weeks: number, debtTetri: number, overdueTetri: number) => lateRow('r', 7, debtTetri, { weeks, overdueTetri });

  it('two weeks, and the debt is exactly what they have left', () => {
    expect(calendarDebtWeeks(late(2, 300_00, 300_00))).toBe(2);
  });

  it('one week is never "for 1 week"', () => {
    expect(calendarDebtWeeks(late(1, 150_00, 150_00))).toBeNull();
  });

  it('an unpaid deposit inside the debt', () => {
    expect(calendarDebtWeeks(late(2, 480_00, 300_00))).toBeNull();
  });

  it('the week of today not in the debt yet — before the roll', () => {
    expect(calendarDebtWeeks(late(2, 150_00, 300_00))).toBeNull();
  });

  it('credit the roll has not placed yet', () => {
    expect(calendarDebtWeeks(late(2, 300_00, 250_00))).toBeNull();
  });
});
