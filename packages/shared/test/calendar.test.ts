// The payments calendar (docs/redesign/payments-calendar.md §4; ADR-0016).
//
// Literal dates throughout: "today" is Wednesday 14.10.2026, its week is
// 12–18.10 and the grid of October is 28.09 – 01.11. The first test is the
// approved example itself — the twelve rentals of the prototype, checked
// against the prototype's own figures. Names are made up.
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_STATES,
  calendarEntriesOn,
  calendarGrid,
  calendarSpan,
  calendarSpans,
  calendarWeekOf,
  paymentsCalendar,
  type CalendarChannel,
  type CalendarCredit,
  type CalendarEntry,
  type CalendarInput,
  type CalendarPayment,
  type CalendarPeriodRow,
  type CalendarRental,
  type PaymentsCalendar,
} from '../src/calendar.js';
import { overdueDays } from '../src/periods.js';
import { addDays, daysBetween } from '../src/time.js';
import { weekIncome, type WeekPayment } from '../src/week.js';

const TODAY = '2026-10-14';
const RATE = 150_00;

const pay = (p: Partial<WeekPayment> & { occurredOn: string; grossTetri: number }): WeekPayment => ({
  direction: 'in',
  channel: 'cash',
  kind: 'rent',
  feeTetri: 0,
  allocations: [],
  ...p,
});

/** A payment as a week remembers it: when, how, and which one. */
const by = (occurredOn: string, channel: CalendarChannel = 'cash', paymentId = `pay-${occurredOn}-${channel}`): CalendarPayment => ({
  paymentId,
  occurredOn,
  createdAt: `${occurredOn}T08:00:00.000Z`,
  channel,
});

const row = (seq: number, startsOn: string, amountTetri = RATE, paidTetri = 0, lastPayment: CalendarPayment | null = null): CalendarPeriodRow => ({
  seq,
  startsOn,
  endsOn: addDays(startsOn, 6),
  amountTetri,
  paidTetri,
  paidBeforeTransfer: false,
  lastPayment,
});

/** A week paid in full by one payment dated `on`. */
const paidRow = (seq: number, startsOn: string, on = startsOn, channel: CalendarChannel = 'cash', amountTetri = RATE): CalendarPeriodRow =>
  row(seq, startsOn, amountTetri, amountTetri, by(on, channel));

const rental = (r: {
  id: string;
  pickedUpOn: string | null;
  number?: string;
  customerId?: string;
  status?: CalendarRental['status'];
  returnedOn?: string | null;
  rate?: number;
  rows?: CalendarPeriodRow[];
  depositShortTetri?: number;
  chargesOpenTetri?: number;
  debtTetri?: number;
}): CalendarRental => ({
  id: r.id,
  number: r.number ?? `R-${r.id}`,
  customerId: r.customerId ?? `c-${r.id}`,
  status: r.status ?? 'active',
  pickedUpOn: r.pickedUpOn,
  returnedOn: r.returnedOn ?? null,
  weeklyRateTetri: r.rate ?? RATE,
  periods: r.rows ?? [],
  depositShortTetri: r.depositShortTetri ?? 0,
  chargesOpenTetri: r.chargesOpenTetri ?? 0,
  debtTetri: r.debtTetri ?? 0,
});

const credit = (c: { paymentId: string; occurredOn: string; creditTetri: number; customerId: string; rentalId?: string | null; channel?: CalendarChannel; createdAt?: string }): CalendarCredit => ({
  createdAt: `${c.occurredOn}T08:00:00.000Z`,
  channel: 'cash',
  rentalId: null,
  ...c,
});

/** The grid of today's month unless a range is given. */
const calendar = (over: Partial<CalendarInput> = {}): PaymentsCalendar => {
  const today = over.today ?? TODAY;
  return paymentsCalendar({ today, ...calendarGrid(today), rentals: [], credits: [], payments: [], ...over });
};

const entryOf = (cal: PaymentsCalendar, rentalId: string, dueOn: string): CalendarEntry => {
  const e = cal.entries.find((x) => x.rentalId === rentalId && x.dueOn === dueOn);
  if (!e) throw new Error(`no entry of ${rentalId} due ${dueOn}`);
  return e;
};
const dayOn = (cal: PaymentsCalendar, date: string) => {
  const d = cal.days.find((x) => x.date === date);
  if (!d) throw new Error(`no day ${date}`);
  return d;
};
const lateOf = (cal: PaymentsCalendar, rentalId: string) => cal.late.rentals.find((l) => l.rentalId === rentalId);

/** Everything the function promises about its own sums, for every week of an answer. */
function identities(cal: PaymentsCalendar): void {
  for (const w of cal.weeks) {
    const days = cal.days.filter((d) => d.date >= w.from && d.date <= w.to);
    expect(days).toHaveLength(7);
    expect(w.expected.count).toBe(w.paid.count + w.left.count);
    expect(w.expected.tetri).toBe(w.paid.tetri + w.left.tetri);
    expect(w.left.count).toBe(w.overdue.count + w.dueToday.count + w.upcoming.count);
    expect(w.left.tetri).toBe(w.overdue.tetri + w.dueToday.tetri + w.upcoming.tetri);
    expect(days.reduce((n, d) => n + d.due.count, 0)).toBe(w.expected.count);
    expect(days.reduce((n, d) => n + d.due.tetri, 0)).toBe(w.expected.tetri);
    expect(days.reduce((n, d) => n + d.paidCount, 0)).toBe(w.paid.count);
    expect(days.reduce((n, d) => n + d.leftTetri, 0)).toBe(w.left.tetri);
    expect(days.reduce((n, d) => n + d.receivedTetri, 0)).toBe(w.receivedTetri);
  }
  for (const d of cal.days) {
    expect(CALENDAR_STATES.reduce((n, s) => n + d.states[s], 0)).toBe(d.due.count);
  }
  expect(cal.late.count).toBe(cal.late.rentals.length);
  expect(cal.late.thisWeekTetri + cal.late.earlierTetri).toBe(cal.late.debtTetri);
  expect(cal.late.thisWeekTetri).toBeGreaterThanOrEqual(0);
  expect(cal.late.earlierTetri).toBeGreaterThanOrEqual(0);
  expect(cal.late.rentals.reduce((n, l) => n + l.debtTetri, 0)).toBe(cal.late.debtTetri);
  for (const e of cal.entries) {
    expect(e.amountTetri).toBe(e.paidTetri + e.leftTetri);
    expect(e.creditTetri).toBeGreaterThanOrEqual(0);
    expect(e.creditTetri).toBeLessThanOrEqual(e.paidTetri);
    expect(e.paidTetri).toBeLessThanOrEqual(e.amountTetri);
  }
}

/**
 * The prototype's twelve rentals (`month_RENT`), handed over 30.09 – 10.10 so
 * that their second weeks fall due 12–17.10. М owes the weeks of 07.10 and
 * 14.10; Г the week of 13.10; Б's week was paid by a transfer of 10.10; К has
 * paid 150 in cash on 13.10 for a week that has no row yet.
 */
const example = (): CalendarInput => ({
  today: TODAY,
  ...calendarGrid(TODAY),
  rentals: [
    rental({ id: 'A', number: 'R-00001', pickedUpOn: '2026-10-05', rows: [paidRow(1, '2026-10-05'), paidRow(2, '2026-10-12')] }),
    rental({ id: 'B', number: 'R-00002', pickedUpOn: '2026-10-06', rows: [paidRow(1, '2026-10-06'), paidRow(2, '2026-10-13', '2026-10-10', 'transfer')] }),
    rental({
      id: 'V',
      number: 'R-00003',
      pickedUpOn: '2026-10-06',
      rate: 140_00,
      rows: [paidRow(1, '2026-10-06', '2026-10-06', 'cash', 140_00), paidRow(2, '2026-10-13', '2026-10-13', 'transfer', 140_00)],
    }),
    rental({ id: 'G', number: 'R-00004', pickedUpOn: '2026-10-06', debtTetri: 150_00, rows: [paidRow(1, '2026-10-06'), row(2, '2026-10-13')] }),
    // Д's week began today, so the one figure already holds it — and Д is not late.
    rental({ id: 'D', number: 'R-00005', pickedUpOn: '2026-10-07', debtTetri: 150_00, rows: [paidRow(1, '2026-10-07'), row(2, '2026-10-14')] }),
    rental({ id: 'E', number: 'R-00006', pickedUpOn: '2026-10-07', rows: [paidRow(1, '2026-10-07'), paidRow(2, '2026-10-14', '2026-10-14', 'acquiring')] }),
    rental({ id: 'M', number: 'R-00007', pickedUpOn: '2026-09-30', debtTetri: 300_00, rows: [paidRow(1, '2026-09-30'), row(2, '2026-10-07'), row(3, '2026-10-14')] }),
    rental({ id: 'Zh', number: 'R-00008', pickedUpOn: '2026-10-08', rows: [paidRow(1, '2026-10-08')] }),
    rental({ id: 'Z', number: 'R-00009', pickedUpOn: '2026-10-08', rows: [paidRow(1, '2026-10-08')] }),
    rental({ id: 'I', number: 'R-00010', pickedUpOn: '2026-10-09', rows: [paidRow(1, '2026-10-09')] }),
    rental({ id: 'K', number: 'R-00011', pickedUpOn: '2026-10-09', rows: [paidRow(1, '2026-10-09')] }),
    rental({ id: 'L', number: 'R-00012', pickedUpOn: '2026-10-10', rows: [paidRow(1, '2026-10-10')] }),
  ],
  credits: [credit({ paymentId: 'pay-K-ahead', occurredOn: '2026-10-13', creditTetri: 150_00, customerId: 'c-K', rentalId: 'K' })],
  payments: [
    // Б: dated before the Monday, so it is in "paid" and not in "received".
    pay({ occurredOn: '2026-10-10', grossTetri: 150_00, channel: 'transfer', allocations: [{ target: 'period', amountTetri: 150_00 }] }),
    pay({ occurredOn: '2026-10-12', grossTetri: 150_00, allocations: [{ target: 'period', amountTetri: 150_00 }] }),
    pay({ occurredOn: '2026-10-13', grossTetri: 140_00, channel: 'transfer', allocations: [{ target: 'period', amountTetri: 140_00 }] }),
    // К: nothing has taken it yet.
    pay({ occurredOn: '2026-10-13', grossTetri: 150_00 }),
    pay({ occurredOn: '2026-10-14', grossTetri: 150_00, feeTetri: 2_25, channel: 'acquiring', allocations: [{ target: 'period', amountTetri: 150_00 }] }),
  ],
});

describe('the approved example, figure for figure', () => {
  const cal = paymentsCalendar(example());
  const week = calendarWeekOf(cal, TODAY);
  const WEEK = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];

  it('gives the week 12 payments for 1 790: 5 paid for 740, 7 left for 1 050', () => {
    expect(week).toMatchObject({ from: '2026-10-12', to: '2026-10-18' });
    expect(WEEK.map((d) => dayOn(cal, d).due.tetri)).toEqual([150_00, 440_00, 450_00, 300_00, 300_00, 150_00, 0]);
    expect(week.expected).toEqual({ count: 12, tetri: 1790_00 });
    expect(week.paid).toEqual({ count: 5, tetri: 740_00 });
    expect(week.left).toEqual({ count: 7, tetri: 1050_00 });
    expect(week.partTetri).toBe(0);
  });

  it('splits what is left into 2 overdue, 1 due today and 4 expected, with 2 of the paid ones paid ahead', () => {
    expect(week.overdue).toEqual({ count: 2, tetri: 300_00 });
    expect(week.dueToday).toEqual({ count: 1, tetri: 150_00 });
    expect(week.upcoming).toEqual({ count: 4, tetri: 600_00 });
    expect(week.paidAhead).toEqual({ count: 2, tetri: 300_00 });
    expect(week.heaviest).toEqual({ date: '2026-10-14', tetri: 450_00 });
  });

  it('names two rentals late with a debt of 450: 300 of this week and 150 from earlier', () => {
    expect(cal.late).toEqual({
      count: 2,
      debtTetri: 450_00,
      thisWeekTetri: 300_00,
      earlierTetri: 150_00,
      rentals: [
        { rentalId: 'M', debtTetri: 300_00, overdueTetri: 300_00, weeks: 2, sinceOn: '2026-10-07', days: 7 },
        { rentalId: 'G', debtTetri: 150_00, overdueTetri: 150_00, weeks: 1, sinceOn: '2026-10-13', days: 1 },
      ],
    });
    expect(cal.firstPickupOn).toBe('2026-09-30');
  });

  it('counts 590 received by the date of the money: 150, 290 and 150', () => {
    expect(WEEK.map((d) => dayOn(cal, d).receivedTetri)).toEqual([150_00, 290_00, 150_00, 0, 0, 0, 0]);
    expect(week.receivedTetri).toBe(590_00);
    // The transfer of 10.10 belongs to the week it was paid in.
    expect(calendarWeekOf(cal, '2026-10-10').receivedTetri).toBe(150_00);
  });

  it('marks 07.10 as the only earlier day still overdue, and puts who is still to pay first in a day', () => {
    expect(cal.days.filter((d) => d.states.overdue > 0).map((d) => d.date)).toEqual(['2026-10-07', '2026-10-13', '2026-10-14']);
    expect(calendarEntriesOn(cal, '2026-10-13').map((e) => e.rentalId)).toEqual(['G', 'B', 'V']);
    expect(entryOf(cal, 'B', '2026-10-13')).toMatchObject({ state: 'paid_ahead', paidOn: '2026-10-10', channel: 'transfer', projected: false });
    expect(entryOf(cal, 'K', '2026-10-16')).toMatchObject({
      state: 'paid_ahead',
      projected: true,
      creditTetri: 150_00,
      leftTetri: 0,
      paidOn: '2026-10-13',
      channel: 'cash',
      paymentId: 'pay-K-ahead',
    });
    expect(entryOf(cal, 'M', '2026-10-14').state).toBe('overdue');
    expect(entryOf(cal, 'D', '2026-10-14').state).toBe('due_today');
    identities(cal);
  });
});

describe('the five states of a week (design note §4.3)', () => {
  it('paid — closed by money dated on its first day', () => {
    const cal = calendar({ rentals: [rental({ id: 'r', pickedUpOn: '2026-10-07', rows: [paidRow(1, '2026-10-07'), paidRow(2, '2026-10-14')] })] });
    expect(entryOf(cal, 'r', '2026-10-14')).toMatchObject({ state: 'paid', paidOn: '2026-10-14', channel: 'cash', leftTetri: 0, projected: false });
  });

  it('paid — closed by money dated after its first day', () => {
    const cal = calendar({ rentals: [rental({ id: 'r', pickedUpOn: '2026-10-08', rows: [paidRow(1, '2026-10-08', '2026-10-10')] })] });
    expect(entryOf(cal, 'r', '2026-10-08')).toMatchObject({ state: 'paid', paidOn: '2026-10-10' });
  });

  it('paid ahead — a row closed by money dated before its first day', () => {
    const cal = calendar({ rentals: [rental({ id: 'r', pickedUpOn: '2026-10-06', rows: [paidRow(1, '2026-10-06'), paidRow(2, '2026-10-13', '2026-10-11')] })] });
    expect(entryOf(cal, 'r', '2026-10-13')).toMatchObject({ state: 'paid_ahead', paidOn: '2026-10-11', projected: false, creditTetri: 0 });
  });

  it('paid ahead — a week with no row yet that money already paid in will close', () => {
    const cal = calendar({
      rentals: [rental({ id: 'r', pickedUpOn: '2026-10-09', rows: [paidRow(1, '2026-10-09')] })],
      credits: [credit({ paymentId: 'ahead', occurredOn: '2026-10-12', creditTetri: RATE, customerId: 'c-r', rentalId: 'r', channel: 'transfer' })],
    });
    expect(entryOf(cal, 'r', '2026-10-16')).toMatchObject({
      state: 'paid_ahead',
      projected: true,
      amountTetri: RATE,
      paidTetri: RATE,
      leftTetri: 0,
      creditTetri: RATE,
      paidOn: '2026-10-12',
      channel: 'transfer',
      paymentId: 'ahead',
    });
    // One week's worth was paid: the week after it is still to come.
    expect(entryOf(cal, 'r', '2026-10-23')).toMatchObject({ state: 'expected', creditTetri: 0, leftTetri: RATE });
  });

  it('due today — its first day is today, nothing older is unpaid; its debt is not in the red figure', () => {
    // The one figure counts the week from the morning it begins; the calendar waits a day.
    const cal = calendar({ rentals: [rental({ id: 'r', pickedUpOn: '2026-10-07', debtTetri: RATE, rows: [paidRow(1, '2026-10-07'), row(2, '2026-10-14')] })] });
    expect(entryOf(cal, 'r', '2026-10-14')).toMatchObject({ state: 'due_today', leftTetri: RATE, paidOn: null, channel: null, paymentId: null });
    expect(cal.late).toEqual({ count: 0, debtTetri: 0, thisWeekTetri: 0, earlierTetri: 0, rentals: [] });
  });

  it('overdue — its first day was before today and it is not closed', () => {
    // Stored as overdue — a status the roll's filter takes as well as active.
    const cal = calendar({ rentals: [rental({ id: 'r', status: 'overdue', pickedUpOn: '2026-10-06', debtTetri: RATE, rows: [paidRow(1, '2026-10-06'), row(2, '2026-10-13')] })] });
    expect(entryOf(cal, 'r', '2026-10-13')).toMatchObject({ state: 'overdue', leftTetri: RATE, paidOn: null });
    expect(lateOf(cal, 'r')).toEqual({ rentalId: 'r', debtTetri: RATE, overdueTetri: RATE, weeks: 1, sinceOn: '2026-10-13', days: 1 });
  });

  it('expected — its first day is after today and no money covers it', () => {
    const cal = calendar({ rentals: [rental({ id: 'r', pickedUpOn: '2026-10-10', rows: [paidRow(1, '2026-10-10')] })] });
    expect(entryOf(cal, 'r', '2026-10-17')).toMatchObject({ state: 'expected', projected: true, amountTetri: RATE, leftTetri: RATE, creditTetri: 0, paidOn: null });
  });

  it('overdue, not due today — today’s week of a rental that already owes an older one', () => {
    const cal = calendar({
      rentals: [rental({ id: 'r', pickedUpOn: '2026-09-30', debtTetri: 300_00, rows: [paidRow(1, '2026-09-30'), row(2, '2026-10-07'), row(3, '2026-10-14')] })],
    });
    expect(entryOf(cal, 'r', '2026-10-14').state).toBe('overdue');
    expect(lateOf(cal, 'r')).toMatchObject({ weeks: 2, sinceOn: '2026-10-07', days: 7, overdueTetri: 300_00 });
  });
});

describe('a partly paid week', () => {
  it('keeps the state its date gives it and shows what is left; its paid part is in the week’s "paid"', () => {
    const half = by('2026-10-12');
    const cal = calendar({
      rentals: [
        rental({ id: 'today', pickedUpOn: '2026-10-07', rows: [paidRow(1, '2026-10-07'), row(2, '2026-10-14', RATE, 50_00, half)] }),
        rental({ id: 'yesterday', pickedUpOn: '2026-10-06', debtTetri: 100_00, rows: [paidRow(1, '2026-10-06'), row(2, '2026-10-13', RATE, 50_00, half)] }),
      ],
    });
    expect(entryOf(cal, 'today', '2026-10-14')).toMatchObject({ state: 'due_today', paidTetri: 50_00, leftTetri: 100_00, paidOn: null, channel: null });
    expect(entryOf(cal, 'yesterday', '2026-10-13')).toMatchObject({ state: 'overdue', paidTetri: 50_00, leftTetri: 100_00 });
    const week = calendarWeekOf(cal, TODAY);
    expect(week.expected).toEqual({ count: 2, tetri: 300_00 });
    expect(week.paid).toEqual({ count: 0, tetri: 100_00 });
    expect(week.partTetri).toBe(100_00);
    expect(week.left).toEqual({ count: 2, tetri: 200_00 });
    expect(dayOn(cal, '2026-10-14')).toMatchObject({ due: { count: 1, tetri: RATE }, paidCount: 0, leftTetri: 100_00 });
    identities(cal);
  });

  it('followed by a paid one stays overdue with what is left; the later week stays paid', () => {
    const cal = calendar({
      rentals: [
        rental({
          id: 'r',
          pickedUpOn: '2026-09-30',
          debtTetri: 100_00,
          rows: [paidRow(1, '2026-09-30'), row(2, '2026-10-07', RATE, 50_00, by('2026-10-07')), paidRow(3, '2026-10-14')],
        }),
      ],
    });
    expect(entryOf(cal, 'r', '2026-10-07')).toMatchObject({ state: 'overdue', leftTetri: 100_00 });
    expect(entryOf(cal, 'r', '2026-10-14')).toMatchObject({ state: 'paid', paidOn: '2026-10-14' });
    expect(lateOf(cal, 'r')).toEqual({ rentalId: 'r', debtTetri: 100_00, overdueTetri: 100_00, weeks: 1, sinceOn: '2026-10-07', days: 7 });
  });

  it('in front of today’s unpaid week makes it overdue, as a wholly unpaid one would: 2 weeks, 100 and 150 left', () => {
    const cal = calendar({
      rentals: [
        rental({
          id: 'r',
          pickedUpOn: '2026-09-30',
          debtTetri: 250_00,
          rows: [paidRow(1, '2026-09-30'), row(2, '2026-10-07', RATE, 50_00, by('2026-10-07')), row(3, '2026-10-14')],
        }),
      ],
    });
    expect(entryOf(cal, 'r', '2026-10-07')).toMatchObject({ state: 'overdue', leftTetri: 100_00 });
    expect(entryOf(cal, 'r', '2026-10-14')).toMatchObject({ state: 'overdue', leftTetri: RATE });
    expect(lateOf(cal, 'r')).toMatchObject({ weeks: 2, sinceOn: '2026-10-07', days: 7, overdueTetri: 250_00 });
  });
});

describe('money nothing has taken yet (design note §4.3, "Оплачено заранее")', () => {
  const ahead = (creditTetri: number, over: { rate?: number; depositShortTetri?: number } = {}) =>
    calendar({
      rentals: [
        rental({ id: 'r', pickedUpOn: '2026-10-09', rate: over.rate, depositShortTetri: over.depositShortTetri, rows: [paidRow(1, '2026-10-09', '2026-10-09', 'cash', over.rate ?? RATE)] }),
      ],
      credits: [credit({ paymentId: 'money', occurredOn: '2026-10-12', creditTetri, customerId: 'c-r', rentalId: 'r' })],
    });

  it('covering part of a week ahead leaves it expected, with the part on it', () => {
    expect(entryOf(ahead(70_00, { rate: 140_00 }), 'r', '2026-10-16')).toMatchObject({
      state: 'expected',
      amountTetri: 140_00,
      paidTetri: 70_00,
      leftTetri: 70_00,
      creditTetri: 70_00,
      paidOn: null,
      channel: null,
      paymentId: null,
    });
  });

  it('goes to an unpaid deposit first: 150 leaves the next week expected in full, 330 pays it ahead', () => {
    expect(entryOf(ahead(150_00, { depositShortTetri: 180_00 }), 'r', '2026-10-16')).toMatchObject({ state: 'expected', leftTetri: RATE, creditTetri: 0 });
    expect(entryOf(ahead(330_00, { depositShortTetri: 180_00 }), 'r', '2026-10-16')).toMatchObject({ state: 'paid_ahead', leftTetri: 0, creditTetri: RATE });
  });

  it('pays a week that has begun before a week that has not', () => {
    const cal = calendar({
      rentals: [rental({ id: 'r', pickedUpOn: '2026-10-07', rows: [paidRow(1, '2026-10-07'), row(2, '2026-10-14')] })],
      credits: [credit({ paymentId: 'money', occurredOn: TODAY, creditTetri: RATE, customerId: 'c-r', rentalId: 'r' })],
    });
    expect(entryOf(cal, 'r', '2026-10-14')).toMatchObject({ state: 'paid', projected: false, creditTetri: RATE, leftTetri: 0, paidOn: TODAY, paymentId: 'money' });
    expect(entryOf(cal, 'r', '2026-10-21')).toMatchObject({ state: 'expected', creditTetri: 0, leftTetri: RATE });
  });

  it('is spent oldest first, and a week is dated by the payment that completed it', () => {
    const cal = calendar({
      rentals: [rental({ id: 'r', pickedUpOn: '2026-10-08', rows: [paidRow(1, '2026-10-08')] })],
      credits: [
        // Given newest first: the order is the function's, not the caller's.
        credit({ paymentId: 'second', occurredOn: '2026-10-08', creditTetri: 200_00, customerId: 'c-r', rentalId: 'r', channel: 'transfer' }),
        credit({ paymentId: 'first', occurredOn: '2026-10-05', creditTetri: 100_00, customerId: 'c-r', rentalId: 'r' }),
      ],
    });
    // 100 of the first and 50 of the second; then 150 of the second.
    for (const dueOn of ['2026-10-15', '2026-10-22']) {
      expect(entryOf(cal, 'r', dueOn)).toMatchObject({ state: 'paid_ahead', creditTetri: RATE, paidOn: '2026-10-08', channel: 'transfer', paymentId: 'second' });
    }
    expect(entryOf(cal, 'r', '2026-10-29')).toMatchObject({ state: 'expected', creditTetri: 0 });
  });

  it('completing a half-paid row does not move its date back: the later payment dates it', () => {
    const cal = calendar({
      rentals: [rental({ id: 'r', pickedUpOn: '2026-10-07', rows: [paidRow(1, '2026-10-07'), row(2, '2026-10-14', RATE, 75_00, by('2026-10-12', 'cash', 'half'))] })],
      credits: [credit({ paymentId: 'old', occurredOn: '2026-10-03', creditTetri: 75_00, customerId: 'c-r', rentalId: 'r', channel: 'transfer' })],
    });
    expect(entryOf(cal, 'r', '2026-10-14')).toMatchObject({ state: 'paid_ahead', paidTetri: RATE, creditTetri: 75_00, paidOn: '2026-10-12', channel: 'cash', paymentId: 'half' });
  });

  it('completing a half-paid row with later money moves its date forward: several payments, the last one dates it (§3.4)', () => {
    // 75 in cash on 07.10 for the week of 10.10 — ahead of it; the rest by transfer on 12.10.
    const cal = calendar({
      rentals: [rental({ id: 'r', pickedUpOn: '2026-10-03', rows: [paidRow(1, '2026-10-03'), row(2, '2026-10-10', RATE, 75_00, by('2026-10-07', 'cash', 'half'))] })],
      credits: [credit({ paymentId: 'rest', occurredOn: '2026-10-12', creditTetri: 75_00, customerId: 'c-r', rentalId: 'r', channel: 'transfer' })],
    });
    expect(entryOf(cal, 'r', '2026-10-10')).toMatchObject({ state: 'paid', paidTetri: RATE, creditTetri: 75_00, paidOn: '2026-10-12', channel: 'transfer', paymentId: 'rest' });
  });

  it('of one day is spent in the order it was entered, whatever the ids say', () => {
    const cal = calendar({
      rentals: [rental({ id: 'r', pickedUpOn: '2026-10-08', rows: [paidRow(1, '2026-10-08')] })],
      credits: [
        // The ids sort the other way round: only the hour tells which came first.
        credit({ paymentId: 'a-afternoon', occurredOn: '2026-10-12', createdAt: '2026-10-12T15:00:00.000Z', creditTetri: 100_00, customerId: 'c-r', rentalId: 'r', channel: 'transfer' }),
        credit({ paymentId: 'b-morning', occurredOn: '2026-10-12', createdAt: '2026-10-12T09:00:00.000Z', creditTetri: 100_00, customerId: 'c-r', rentalId: 'r' }),
      ],
    });
    // 100 of the morning's and 50 of the afternoon's: the afternoon's completed the week.
    expect(entryOf(cal, 'r', '2026-10-15')).toMatchObject({ state: 'paid_ahead', creditTetri: RATE, paidOn: '2026-10-12', channel: 'transfer', paymentId: 'a-afternoon' });
    expect(entryOf(cal, 'r', '2026-10-22')).toMatchObject({ state: 'expected', creditTetri: 50_00, leftTetri: 100_00 });
  });

  it('goes to an open return charge after the weeks that exist, and before a week still to come', () => {
    const cal = calendar({
      rentals: [rental({ id: 'r', pickedUpOn: '2026-10-09', chargesOpenTetri: 50_00, rows: [paidRow(1, '2026-10-09')] })],
      credits: [credit({ paymentId: 'money', occurredOn: '2026-10-12', creditTetri: 200_00, customerId: 'c-r', rentalId: 'r' })],
    });
    // Tonight no week is open, so 50 go to the charge; 150 are left for the week of 16.10 …
    expect(entryOf(cal, 'r', '2026-10-16')).toMatchObject({ state: 'paid_ahead', creditTetri: RATE, leftTetri: 0 });
    // … and nothing for the one after it.
    expect(entryOf(cal, 'r', '2026-10-23')).toMatchObject({ state: 'expected', creditTetri: 0, leftTetri: RATE });
  });

  it('tied to no rental is spent once, by the customer’s rental handed over first', () => {
    const cal = calendar({
      rentals: [
        rental({ id: 'later', number: 'R-00002', customerId: 'c1', pickedUpOn: '2026-10-07', rows: [paidRow(1, '2026-10-07'), row(2, '2026-10-14')] }),
        rental({ id: 'first', number: 'R-00001', customerId: 'c1', pickedUpOn: '2026-09-30', rows: [paidRow(1, '2026-09-30'), paidRow(2, '2026-10-07'), row(3, '2026-10-14')] }),
      ],
      credits: [credit({ paymentId: 'money', occurredOn: TODAY, creditTetri: RATE, customerId: 'c1' })],
    });
    expect(entryOf(cal, 'first', '2026-10-14')).toMatchObject({ state: 'paid', creditTetri: RATE, leftTetri: 0 });
    expect(entryOf(cal, 'later', '2026-10-14')).toMatchObject({ state: 'due_today', creditTetri: 0, leftTetri: RATE });
    expect(cal.entries.reduce((n, e) => n + e.creditTetri, 0)).toBe(RATE);
  });

  it('tied to one rental never pays another rental of the same customer', () => {
    const cal = calendar({
      rentals: [
        rental({ id: 'A', number: 'R-00002', customerId: 'c1', pickedUpOn: '2026-10-08', rows: [paidRow(1, '2026-10-08')] }),
        rental({ id: 'B', number: 'R-00001', customerId: 'c1', pickedUpOn: '2026-10-07', rows: [paidRow(1, '2026-10-07'), row(2, '2026-10-14')] }),
      ],
      credits: [credit({ paymentId: 'for-A', occurredOn: '2026-10-12', creditTetri: RATE, customerId: 'c1', rentalId: 'A' })],
    });
    expect(entryOf(cal, 'B', '2026-10-14')).toMatchObject({ state: 'due_today', creditTetri: 0, leftTetri: RATE });
    expect(entryOf(cal, 'A', '2026-10-15')).toMatchObject({ state: 'paid_ahead', creditTetri: RATE });
  });

  it('a rental’s own money and the customer’s untied money are one purse for it, oldest first', () => {
    const cal = calendar({
      rentals: [
        // First in the roll: nothing owed, a week falling due tomorrow, 150 of its own from 12.10.
        rental({ id: 'R1', number: 'R-00001', customerId: 'c1', pickedUpOn: '2026-10-01', rows: [paidRow(1, '2026-10-01'), paidRow(2, '2026-10-08')] }),
        // Second: an unpaid week of today.
        rental({ id: 'R2', number: 'R-00002', customerId: 'c1', pickedUpOn: '2026-10-07', debtTetri: RATE, rows: [paidRow(1, '2026-10-07'), row(2, '2026-10-14')] }),
      ],
      credits: [
        credit({ paymentId: 'own', occurredOn: '2026-10-12', creditTetri: RATE, customerId: 'c1', rentalId: 'R1' }),
        credit({ paymentId: 'untied', occurredOn: '2026-10-05', creditTetri: RATE, customerId: 'c1' }),
      ],
    });
    // The older money goes first although it names no rental: the first rental's
    // next week takes it, its own 150 wait for the week after, and nothing is
    // left for the second rental — the night will pay it nothing either.
    expect(entryOf(cal, 'R1', '2026-10-15')).toMatchObject({ state: 'paid_ahead', creditTetri: RATE, paidOn: '2026-10-05', paymentId: 'untied' });
    expect(entryOf(cal, 'R1', '2026-10-22')).toMatchObject({ state: 'paid_ahead', creditTetri: RATE, paidOn: '2026-10-12', paymentId: 'own' });
    expect(entryOf(cal, 'R2', '2026-10-14')).toMatchObject({ state: 'due_today', creditTetri: 0, leftTetri: RATE });
  });
});

describe('the replay of the rolls (ADR-0016)', () => {
  // One customer, two running rentals, 150 tied to neither. R1 was handed
  // over first and owes nothing; its next week falls due tomorrow. R2 was
  // handed over today: its deposit and first week are unpaid.
  const r1 = rental({ id: 'R1', number: 'R-00001', customerId: 'c1', pickedUpOn: '2026-10-08', rows: [paidRow(1, '2026-10-08')] });
  const r2 = rental({ id: 'R2', number: 'R-00002', customerId: 'c1', pickedUpOn: TODAY, depositShortTetri: 180_00, debtTetri: 330_00, rows: [row(1, TODAY)] });
  // Somebody else's rental whose week of today has no row: the roll has not run.
  const unrolled = rental({ id: 'X', number: 'R-00003', customerId: 'c2', pickedUpOn: '2026-10-07', rows: [paidRow(1, '2026-10-07')] });
  const credits = [credit({ paymentId: 'money', occurredOn: '2026-10-13', creditTetri: RATE, customerId: 'c1' })];

  it('today’s roll has run: tonight the earlier rental’s new week takes the money before the later one’s deposit is looked at', () => {
    const cal = calendar({ rentals: [r2, r1], credits });
    expect(entryOf(cal, 'R1', '2026-10-15')).toMatchObject({ state: 'paid_ahead', creditTetri: RATE, leftTetri: 0 });
    expect(entryOf(cal, 'R2', TODAY)).toMatchObject({ state: 'due_today', creditTetri: 0, leftTetri: RATE });
  });

  it('today’s roll has not run: it settles what has begun first, so the money goes to the later rental’s deposit', () => {
    const cal = calendar({ rentals: [r2, r1, unrolled], credits });
    expect(entryOf(cal, 'R1', '2026-10-15')).toMatchObject({ state: 'expected', creditTetri: 0, leftTetri: RATE });
    // The deposit is not on the calendar; the week is as unpaid as before.
    expect(entryOf(cal, 'R2', TODAY)).toMatchObject({ state: 'due_today', creditTetri: 0, leftTetri: RATE });
    expect(entryOf(cal, 'X', TODAY)).toMatchObject({ state: 'due_today', projected: true });
  });

  it('for a customer with one rental both rolls say the same', () => {
    const mine = (cal: PaymentsCalendar) => cal.entries.filter((e) => e.rentalId === 'R1');
    const rolled = calendar({ rentals: [r1], credits });
    const notYet = calendar({ rentals: [r1, unrolled], credits });
    expect(mine(notYet)).toEqual(mine(rolled));
    expect(entryOf(rolled, 'R1', '2026-10-15').state).toBe('paid_ahead');
  });

  it('takes a customer’s rentals by the day of hand-over, not by rental number', () => {
    // The older rental was entered later, as a transfer: the higher number, the earlier hand-over.
    const cal = calendar({
      rentals: [
        rental({ id: 'entered-first', number: 'R-00002', customerId: 'c1', pickedUpOn: '2026-10-07', debtTetri: RATE, rows: [paidRow(1, '2026-10-07'), row(2, '2026-10-14')] }),
        rental({ id: 'handed-first', number: 'R-00009', customerId: 'c1', pickedUpOn: '2026-09-30', debtTetri: RATE, rows: [paidRow(1, '2026-09-30'), paidRow(2, '2026-10-07'), row(3, '2026-10-14')] }),
      ],
      credits: [credit({ paymentId: 'money', occurredOn: TODAY, creditTetri: RATE, customerId: 'c1' })],
    });
    expect(entryOf(cal, 'handed-first', '2026-10-14')).toMatchObject({ state: 'paid', creditTetri: RATE, leftTetri: 0, paymentId: 'money' });
    expect(entryOf(cal, 'entered-first', '2026-10-14')).toMatchObject({ state: 'due_today', creditTetri: 0, leftTetri: RATE });
  });

  it('a stored week beyond the days shown still takes the money in its turn', () => {
    // A roll run by hand for 06.11 left the first rental a fifth week, unpaid.
    // It is there every night, so it is paid before the second rental's week
    // of 17.10 comes into being.
    const ahead = (seq: number, startsOn: string) => paidRow(seq, startsOn, '2026-10-12');
    const cal = calendar({
      rentals: [
        rental({
          id: 'R1',
          number: 'R-00001',
          customerId: 'c1',
          pickedUpOn: '2026-10-09',
          rows: [paidRow(1, '2026-10-09'), ahead(2, '2026-10-16'), ahead(3, '2026-10-23'), ahead(4, '2026-10-30'), row(5, '2026-11-06')],
        }),
        rental({ id: 'R2', number: 'R-00002', customerId: 'c1', pickedUpOn: '2026-10-10', rows: [paidRow(1, '2026-10-10')] }),
      ],
      credits: [credit({ paymentId: 'money', occurredOn: '2026-10-13', creditTetri: RATE, customerId: 'c1' })],
    });
    expect(cal.days[cal.days.length - 1].date).toBe('2026-11-02');
    expect(cal.entries.map((e) => e.dueOn)).not.toContain('2026-11-06');
    expect(entryOf(cal, 'R2', '2026-10-17')).toMatchObject({ state: 'expected', creditTetri: 0, leftTetri: RATE });
    // The 150 are on a week that is not shown.
    expect(cal.entries.reduce((n, e) => n + e.creditTetri, 0)).toBe(0);
  });
});

describe('what is not on the calendar (design note §4.1)', () => {
  it('a week at nothing — a pause lifted — is skipped, and does not make the next one overdue', () => {
    const cal = calendar({
      rentals: [
        rental({ id: 'r', pickedUpOn: '2026-09-23', rows: [paidRow(1, '2026-09-23'), row(2, '2026-09-30', 0), row(3, '2026-10-07', 0), row(4, '2026-10-14')] }),
      ],
    });
    expect(cal.entries.filter((e) => e.rentalId === 'r').map((e) => e.dueOn)).not.toContain('2026-09-30');
    expect(cal.entries.filter((e) => e.rentalId === 'r').map((e) => e.dueOn)).not.toContain('2026-10-07');
    expect(dayOn(cal, '2026-10-07').due).toEqual({ count: 0, tetri: 0 });
    expect(entryOf(cal, 'r', '2026-10-14').state).toBe('due_today');
    expect(cal.late.count).toBe(0);
  });

  it('paused, disputed, returned and booked rentals give nothing and take no credit', () => {
    const cal = calendar({
      rentals: [
        rental({ id: 'paused', customerId: 'c1', status: 'paused', pickedUpOn: '2026-09-23', depositShortTetri: 180_00, debtTetri: 480_00, rows: [row(1, '2026-09-23'), row(2, '2026-09-30')] }),
        rental({ id: 'disputed', customerId: 'c1', status: 'disputed', pickedUpOn: '2026-09-24', rows: [row(1, '2026-09-24')] }),
        rental({ id: 'returned', customerId: 'c1', status: 'returned', pickedUpOn: '2026-09-25', returnedOn: '2026-10-01', rows: [row(1, '2026-09-25')] }),
        rental({ id: 'booked', customerId: 'c1', status: 'booked', pickedUpOn: null }),
        rental({ id: 'no-pickup', customerId: 'c1', pickedUpOn: null }),
        rental({ id: 'back', customerId: 'c1', pickedUpOn: '2026-09-26', returnedOn: '2026-10-02', rows: [row(1, '2026-09-26')] }),
        rental({ id: 'runs', customerId: 'c1', pickedUpOn: '2026-10-09', rows: [paidRow(1, '2026-10-09')] }),
      ],
      credits: [credit({ paymentId: 'money', occurredOn: '2026-10-12', creditTetri: RATE, customerId: 'c1' })],
    });
    expect([...new Set(cal.entries.map((e) => e.rentalId))]).toEqual(['runs']);
    expect(cal.late).toMatchObject({ count: 0, debtTetri: 0, rentals: [] });
    // The customer's money is whole for the one rental that runs.
    expect(entryOf(cal, 'runs', '2026-10-16')).toMatchObject({ state: 'paid_ahead', creditTetri: RATE });
    expect(cal.firstPickupOn).toBe('2026-10-09');
  });

  it('the deposit: handed over today with nothing paid is one week due today, and nobody is late', () => {
    const cal = calendar({ rentals: [rental({ id: 'r', pickedUpOn: TODAY, depositShortTetri: 180_00, debtTetri: 330_00, rows: [row(1, TODAY)] })] });
    expect(calendarEntriesOn(cal, TODAY)).toHaveLength(1);
    expect(entryOf(cal, 'r', TODAY)).toMatchObject({ state: 'due_today', amountTetri: RATE, leftTetri: RATE });
    expect(cal.late.count).toBe(0);
    // And every seven days after it, a week by calculation.
    expect(entryOf(cal, 'r', '2026-10-21')).toMatchObject({ state: 'expected', projected: true });
  });

  it('handed over today and paid at the counter is paid today, not ahead', () => {
    const cal = calendar({ rentals: [rental({ id: 'r', pickedUpOn: TODAY, rows: [paidRow(1, TODAY)] })] });
    expect(entryOf(cal, 'r', TODAY)).toMatchObject({ state: 'paid', paidOn: TODAY });
  });
});

describe('weeks with no row yet (design note §4.2)', () => {
  it('today’s week before the roll is due today at the weekly rate', () => {
    const cal = calendar({ rentals: [rental({ id: 'r', pickedUpOn: '2026-10-07', rate: 140_00, rows: [paidRow(1, '2026-10-07', '2026-10-07', 'cash', 140_00)] })] });
    expect(entryOf(cal, 'r', '2026-10-14')).toMatchObject({ state: 'due_today', projected: true, amountTetri: 140_00, leftTetri: 140_00, endsOn: '2026-10-20', seq: 2 });
  });

  it('today’s week before the roll is paid ahead when money is waiting for it', () => {
    const cal = calendar({
      rentals: [rental({ id: 'r', pickedUpOn: '2026-10-07', rows: [paidRow(1, '2026-10-07')] })],
      credits: [credit({ paymentId: 'money', occurredOn: '2026-10-12', creditTetri: RATE, customerId: 'c-r', rentalId: 'r' })],
    });
    expect(entryOf(cal, 'r', '2026-10-14')).toMatchObject({ state: 'paid_ahead', projected: true, creditTetri: RATE, paidOn: '2026-10-12' });
  });

  it('today’s week before the roll is overdue behind an older unpaid week, and the debt figure is passed through untouched', () => {
    const cal = calendar({ rentals: [rental({ id: 'r', pickedUpOn: '2026-09-30', debtTetri: 150_00, rows: [paidRow(1, '2026-09-30'), row(2, '2026-10-07')] })] });
    expect(entryOf(cal, 'r', '2026-10-07')).toMatchObject({ state: 'overdue', projected: false });
    expect(entryOf(cal, 'r', '2026-10-14')).toMatchObject({ state: 'overdue', projected: true });
    // Two weeks overdue, and a debt that does not count the second yet.
    expect(lateOf(cal, 'r')).toEqual({ rentalId: 'r', debtTetri: 150_00, overdueTetri: 300_00, weeks: 2, sinceOn: '2026-10-07', days: 7 });
    // The 150 of the debt are the week of 07.10 — last week's. Today's is not in the debt yet.
    expect(cal.late).toMatchObject({ debtTetri: 150_00, thisWeekTetri: 0, earlierTetri: 150_00 });
    identities(cal);
  });

  it('"this week" of the debt counts only weeks that have a row, however large the debt is', () => {
    // The same rental with its deposit unpaid: the debt is above a week, and still none of it is this week's.
    const one = calendar({
      rentals: [rental({ id: 'r', pickedUpOn: '2026-09-30', depositShortTetri: 180_00, debtTetri: 330_00, rows: [paidRow(1, '2026-09-30'), row(2, '2026-10-07')] })],
    });
    expect(one.late).toMatchObject({ count: 1, debtTetri: 330_00, thisWeekTetri: 0, earlierTetri: 330_00 });

    // And not across rentals: X owes 480 from before this Monday; Y's only
    // overdue week is one the roll never opened, so Y's debt is nought.
    const two = calendar({
      rentals: [
        rental({ id: 'X', pickedUpOn: '2026-09-25', depositShortTetri: 180_00, debtTetri: 480_00, rows: [paidRow(1, '2026-09-25'), row(2, '2026-10-02'), row(3, '2026-10-09')] }),
        rental({ id: 'Y', pickedUpOn: '2026-10-06', debtTetri: 0, rows: [paidRow(1, '2026-10-06')] }),
      ],
    });
    expect(entryOf(two, 'Y', '2026-10-13')).toMatchObject({ state: 'overdue', projected: true });
    expect(two.late).toMatchObject({ count: 2, debtTetri: 480_00, thisWeekTetri: 0, earlierTetri: 480_00 });
    identities(two);
  });

  it('a begun week the roll never opened is overdue, and "this week" is never more than the whole debt', () => {
    // The worker was down: yesterday's week has no row, so the debt is nought.
    const cal = calendar({ rentals: [rental({ id: 'r', pickedUpOn: '2026-10-06', debtTetri: 0, rows: [paidRow(1, '2026-10-06')] })] });
    expect(entryOf(cal, 'r', '2026-10-13')).toMatchObject({ state: 'overdue', projected: true, leftTetri: RATE });
    expect(lateOf(cal, 'r')).toMatchObject({ debtTetri: 0, overdueTetri: RATE, weeks: 1, days: 1 });
    expect(cal.late).toMatchObject({ count: 1, debtTetri: 0, thisWeekTetri: 0, earlierTetri: 0 });
    identities(cal);
  });
});

describe('weeks brought over as paid, and rows that hold too much', () => {
  it('a week paid before the transfer is paid with no date and no channel, never paid ahead', () => {
    const before = (seq: number, startsOn: string): CalendarPeriodRow => ({ ...row(seq, startsOn, RATE, RATE), paidBeforeTransfer: true });
    const cal = calendar({ rentals: [rental({ id: 'r', pickedUpOn: '2026-09-30', rows: [before(1, '2026-09-30'), before(2, '2026-10-07'), row(3, '2026-10-14')] })] });
    for (const dueOn of ['2026-09-30', '2026-10-07']) {
      expect(entryOf(cal, 'r', dueOn)).toMatchObject({ state: 'paid', paidOn: null, channel: null, paymentId: null, leftTetri: 0 });
    }
    expect(entryOf(cal, 'r', '2026-10-14').state).toBe('due_today');
  });

  it('a row paid above its amount is paid at its amount and asks no credit', () => {
    const cal = calendar({
      rentals: [rental({ id: 'r', pickedUpOn: '2026-10-05', rows: [paidRow(1, '2026-10-05'), row(2, '2026-10-12', RATE, 200_00, by('2026-10-12'))] })],
      credits: [credit({ paymentId: 'money', occurredOn: '2026-10-12', creditTetri: RATE, customerId: 'c-r', rentalId: 'r' })],
    });
    expect(entryOf(cal, 'r', '2026-10-12')).toMatchObject({ state: 'paid', amountTetri: RATE, paidTetri: RATE, leftTetri: 0, creditTetri: 0 });
    // The purse is still whole for the week after.
    expect(entryOf(cal, 'r', '2026-10-19')).toMatchObject({ state: 'paid_ahead', creditTetri: RATE });
    expect(calendarWeekOf(cal, TODAY)).toMatchObject({ expected: { count: 1, tetri: RATE }, paid: { count: 1, tetri: RATE }, left: { count: 0, tetri: 0 } });
    identities(cal);
  });
});

describe('who is late (design note §4.4)', () => {
  // Handed over on a Wednesday eight weeks back: the week of 02.09 was never
  // paid, every one since was, and the week that began today is not paid yet.
  const old = rental({
    id: 'r',
    pickedUpOn: '2026-08-26',
    debtTetri: 300_00,
    rows: [
      paidRow(1, '2026-08-26'),
      row(2, '2026-09-02'),
      paidRow(3, '2026-09-09'),
      paidRow(4, '2026-09-16'),
      paidRow(5, '2026-09-23'),
      paidRow(6, '2026-09-30'),
      paidRow(7, '2026-10-07'),
      row(8, '2026-10-14'),
    ],
  });

  it('an unpaid week before the days shown is not an entry, and still makes the rental late', () => {
    const cal = calendar({
      rentals: [
        rental({
          id: 'r',
          pickedUpOn: '2026-08-31',
          debtTetri: RATE,
          rows: [paidRow(1, '2026-08-31'), row(2, '2026-09-07'), paidRow(3, '2026-09-14'), paidRow(4, '2026-09-21'), paidRow(5, '2026-09-28'), paidRow(6, '2026-10-05'), paidRow(7, '2026-10-12')],
        }),
      ],
    });
    expect(cal.from).toBe('2026-09-28');
    expect(cal.entries.map((e) => e.dueOn)).not.toContain('2026-09-07');
    expect(cal.entries.every((e) => e.state !== 'overdue')).toBe(true);
    expect(cal.late.rentals).toEqual([{ rentalId: 'r', debtTetri: RATE, overdueTetri: RATE, weeks: 1, sinceOn: '2026-09-07', days: 37 }]);
  });

  it('the "older unpaid week" rule reads the rental’s whole schedule, not the days shown', () => {
    const cal = calendar({ rentals: [old] });
    expect(cal.entries.map((e) => e.dueOn)).not.toContain('2026-09-02');
    expect(entryOf(cal, 'r', '2026-10-14').state).toBe('overdue');
    expect(lateOf(cal, 'r')).toEqual({ rentalId: 'r', debtTetri: 300_00, overdueTetri: 300_00, weeks: 2, sinceOn: '2026-09-02', days: 42 });
  });

  it('is the same whatever range is asked', () => {
    const october = calendar({ rentals: [old] });
    const november = calendar({ rentals: [old], ...calendarGrid('2026-11-15') });
    expect(november.late).toEqual(october.late);
  });

  it('counts days from the first day of the oldest unpaid week — the count the rest of the product makes too (ADR-0017)', () => {
    const cal = calendar({
      rentals: [rental({ id: 'r', pickedUpOn: '2026-09-30', debtTetri: 300_00, rows: [paidRow(1, '2026-09-30'), row(2, '2026-10-07'), row(3, '2026-10-14')] })],
    });
    const late = lateOf(cal, 'r')!;
    expect(late.days).toBe(daysBetween(late.sinceOn, TODAY));
    // Paid through 06.10: the week is due on the 7th, and "Аренды" counts from that day as the calendar does.
    expect(late.days).toBe(overdueDays('2026-10-06', '2026-09-30', TODAY));
  });

  it('orders the list by days, then by debt, then by rental number', () => {
    const lateBy = (id: string, number: string, sinceDue: string, debtTetri: number) =>
      rental({ id, number, pickedUpOn: addDays(sinceDue, -7), debtTetri, rows: [paidRow(1, addDays(sinceDue, -7)), row(2, sinceDue)] });
    const cal = calendar({
      rentals: [
        lateBy('same-b', 'R-00004', '2026-10-13', 150_00),
        lateBy('more-debt', 'R-00002', '2026-10-13', 330_00),
        lateBy('oldest', 'R-00003', '2026-10-08', 150_00),
        lateBy('same-a', 'R-00001', '2026-10-13', 150_00),
      ],
    });
    expect(cal.late.rentals.map((l) => l.rentalId)).toEqual(['oldest', 'more-debt', 'same-a', 'same-b']);
    expect(cal.late.rentals.map((l) => l.days)).toEqual([6, 1, 1, 1]);
  });

  it('no rental running: nobody is late and there is no first pickup', () => {
    expect(calendar().firstPickupOn).toBeNull();
    expect(calendar().late).toEqual({ count: 0, debtTetri: 0, thisWeekTetri: 0, earlierTetri: 0, rentals: [] });
    const stopped = calendar({
      rentals: [
        rental({ id: 'paused', status: 'paused', pickedUpOn: '2026-09-23', rows: [row(1, '2026-09-23')] }),
        rental({ id: 'returned', status: 'returned', pickedUpOn: '2026-09-25', returnedOn: '2026-10-01' }),
        rental({ id: 'booked', status: 'booked', pickedUpOn: null }),
      ],
    });
    expect(stopped.firstPickupOn).toBeNull();
    expect(stopped.entries).toEqual([]);
  });

  it('the first pickup is the earliest among the running rentals, whatever range is asked', () => {
    const rentals = [
      rental({ id: 'later', pickedUpOn: '2026-10-09', rows: [paidRow(1, '2026-10-09')] }),
      rental({ id: 'earlier', pickedUpOn: '2026-08-26', rows: [] }),
      rental({ id: 'gone', status: 'returned', pickedUpOn: '2026-07-01', returnedOn: '2026-08-01' }),
    ];
    expect(calendar({ rentals }).firstPickupOn).toBe('2026-08-26');
    expect(calendar({ rentals, ...calendarGrid('2026-11-15') }).firstPickupOn).toBe('2026-08-26');
  });
});

describe('the days an answer covers', () => {
  it('the grid of a month is whole weeks: five, six or four of them', () => {
    expect(calendarGrid('2026-10-14')).toEqual({ from: '2026-09-28', to: '2026-11-01' });
    expect(calendarGrid('2026-08-15')).toEqual({ from: '2026-07-27', to: '2026-09-06' });
    expect(daysBetween('2026-07-27', '2026-09-06') + 1).toBe(42);
    expect(calendarGrid('2027-02-10')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
  });

  it('October asked in October: five weeks, their days, and the Monday after', () => {
    const cal = calendar();
    expect(cal.weeks.map((w) => w.from)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(cal.days).toHaveLength(36);
    expect(cal.days[0].date).toBe('2026-09-28');
    expect(cal.days[35].date).toBe('2026-11-02');
    expect(calendarSpan(cal.from, cal.to, TODAY)).toEqual({ from: '2026-09-28', to: '2026-11-02' });
  });

  it('another month still carries the week of today, and the day after it', () => {
    const november = calendarGrid('2026-11-15');
    expect(november).toEqual({ from: '2026-10-26', to: '2026-12-06' });
    const cal = calendar({ ...november, rentals: [rental({ id: 'r', pickedUpOn: '2026-10-07', rows: [paidRow(1, '2026-10-07'), row(2, '2026-10-14')] })] });
    expect(cal.weeks.map((w) => w.from)).toEqual(['2026-10-12', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    const dates = cal.days.map((d) => d.date);
    expect(dates.slice(0, 9)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-26']);
    expect(dates[dates.length - 1]).toBe('2026-12-07');
    expect(calendarSpan(november.from, november.to, TODAY)).toEqual({ from: '2026-10-12', to: '2026-12-07' });
    // Today's week is there to be read, and a day outside the answer falls back to it.
    expect(entryOf(cal, 'r', '2026-10-14').state).toBe('due_today');
    expect(calendarWeekOf(cal, TODAY).from).toBe('2026-10-12');
    expect(calendarWeekOf(cal, '2026-10-22').from).toBe('2026-10-12');
    expect(calendarWeekOf(cal, '2026-11-18').from).toBe('2026-11-16');
    // The week between the two is not in the answer.
    expect(cal.entries.map((e) => e.dueOn)).not.toContain('2026-10-21');
  });

  it('the days are read as one stretch, or as two when the month asked for stands apart from today', () => {
    const november = calendarGrid('2026-11-15');
    expect(calendarSpans('2026-09-28', '2026-11-01', TODAY)).toEqual([{ from: '2026-09-28', to: '2026-11-02' }]);
    // The week of 19–25.10 is in neither stretch.
    expect(calendarSpans(november.from, november.to, TODAY)).toEqual([
      { from: '2026-10-12', to: '2026-10-19' },
      { from: '2026-10-26', to: '2026-12-07' },
    ]);
    // A year back: thirty-six days and eight, not the fifty weeks between.
    expect(calendarSpans('2025-10-27', '2025-11-30', TODAY)).toEqual([
      { from: '2025-10-27', to: '2025-12-01' },
      { from: '2026-10-12', to: '2026-10-19' },
    ]);
    // The week of today right before the weeks asked for, and right after: they share a Monday, so one stretch.
    expect(calendarSpans(november.from, november.to, '2026-10-21')).toEqual([{ from: '2026-10-19', to: '2026-12-07' }]);
    expect(calendarSpans(november.from, november.to, '2026-12-09')).toEqual([{ from: '2026-10-26', to: '2026-12-14' }]);
    // No day twice, whatever is asked.
    for (const today of [TODAY, '2026-10-21', '2026-11-18', '2026-12-09']) {
      const spans = calendarSpans(november.from, november.to, today);
      const days = spans.flatMap((s) => Array.from({ length: daysBetween(s.from, s.to) + 1 }, (_, i) => addDays(s.from, i)));
      expect(days).toEqual(calendar({ ...november, today }).days.map((d) => d.date));
    }
  });

  it('a range that starts mid-week widens to whole weeks', () => {
    const cal = calendar({ from: '2026-10-14', to: '2026-10-14' });
    expect(cal.weeks.map((w) => [w.from, w.to])).toEqual([['2026-10-12', '2026-10-18']]);
    expect(cal.days.map((d) => d.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']);
  });
});

describe('the sums of a day and of a week (design note §4.5, §4.6)', () => {
  const three = (pickedUpOn: string, ids: string[], second: (id: string) => CalendarPeriodRow[]) =>
    ids.map((id) => rental({ id, pickedUpOn, debtTetri: id === 'p3' ? 100_00 : 0, rows: [paidRow(1, pickedUpOn), ...second(id)] }));
  const cal = calendar({
    rentals: [
      // 13.10: one paid on the day, one paid ahead, one half paid.
      ...three('2026-10-06', ['p1', 'p2', 'p3'], (id) => [
        id === 'p1' ? paidRow(2, '2026-10-13') : id === 'p2' ? paidRow(2, '2026-10-13', '2026-10-11') : row(2, '2026-10-13', RATE, 50_00, by('2026-10-13')),
      ]),
      // 15.10: three weeks by calculation.
      ...three('2026-10-08', ['q1', 'q2', 'q3'], () => []),
    ],
  });

  it('a day counts its weeks by state, how many are closed and what is left', () => {
    expect(dayOn(cal, '2026-10-13')).toEqual({
      date: '2026-10-13',
      due: { count: 3, tetri: 450_00 },
      paidCount: 2,
      leftTetri: 100_00,
      states: { paid: 1, paid_ahead: 1, due_today: 0, overdue: 1, expected: 0 },
      receivedTetri: 0,
    });
    expect(dayOn(cal, '2026-10-15')).toMatchObject({ due: { count: 3, tetri: 450_00 }, paidCount: 0, leftTetri: 450_00, states: { expected: 3 } });
    // A day with nothing due is in the answer all the same.
    expect(dayOn(cal, '2026-10-18')).toEqual({
      date: '2026-10-18',
      due: { count: 0, tetri: 0 },
      paidCount: 0,
      leftTetri: 0,
      states: { paid: 0, paid_ahead: 0, due_today: 0, overdue: 0, expected: 0 },
      receivedTetri: 0,
    });
  });

  it('inside a day the paid weeks stand in the order the money came, and a week with no payment last', () => {
    const due = (id: string, number: string, second: CalendarPeriodRow) => rental({ id, number, pickedUpOn: '2026-10-06', rows: [paidRow(1, '2026-10-06'), second] });
    const order = calendar({
      rentals: [
        due('on-the-day', 'R-00001', paidRow(2, '2026-10-13')),
        due('ahead', 'R-00002', paidRow(2, '2026-10-13', '2026-10-10')),
        due('before-the-transfer', 'R-00003', { ...row(2, '2026-10-13', RATE, RATE), paidBeforeTransfer: true }),
      ],
    });
    // By rental number it would be 1, 2, 3.
    expect(calendarEntriesOn(order, '2026-10-13').map((e) => e.rentalId)).toEqual(['ahead', 'on-the-day', 'before-the-transfer']);
  });

  it('the heaviest day of a tie is the earlier one, and a week with nothing due has none', () => {
    expect(calendarWeekOf(cal, TODAY).heaviest).toEqual({ date: '2026-10-13', tetri: 450_00 });
    expect(calendarWeekOf(cal, '2026-09-30')).toEqual({
      from: '2026-09-28',
      to: '2026-10-04',
      expected: { count: 0, tetri: 0 },
      paid: { count: 0, tetri: 0 },
      paidAhead: { count: 0, tetri: 0 },
      partTetri: 0,
      left: { count: 0, tetri: 0 },
      overdue: { count: 0, tetri: 0 },
      dueToday: { count: 0, tetri: 0 },
      upcoming: { count: 0, tetri: 0 },
      heaviest: null,
      receivedTetri: 0,
    });
    identities(cal);
  });

  it('"received" is rent by the date of the money — the week report’s own figure', () => {
    const payments = [
      // A hand-over: 150 of rent and 180 of deposit in one payment.
      pay({ occurredOn: '2026-10-12', grossTetri: 330_00, allocations: [{ target: 'period', amountTetri: 150_00 }, { target: 'deposit', amountTetri: 180_00 }] }),
      pay({ occurredOn: '2026-10-12', grossTetri: 300_00, kind: 'sale', allocations: [{ target: 'instalment', amountTetri: 300_00 }] }),
      pay({ occurredOn: '2026-10-13', grossTetri: 150_00, allocations: [{ target: 'period', amountTetri: 150_00 }] }),
      // Kept out of a deposit: it came through the door once, as the deposit.
      pay({ occurredOn: '2026-10-13', grossTetri: 130_00, kind: 'service', channel: 'deposit' }),
      // Four weeks ahead, taken by nothing yet: rent on the day it was paid.
      pay({ occurredOn: '2026-10-14', grossTetri: 600_00 }),
      pay({ occurredOn: '2026-10-14', grossTetri: 180_00, kind: 'deposit_payout', direction: 'out' }),
      // Last week's money is last week's.
      pay({ occurredOn: '2026-10-09', grossTetri: 150_00, allocations: [{ target: 'period', amountTetri: 150_00 }] }),
    ];
    const got = calendar({ payments });
    const week = calendarWeekOf(got, TODAY);
    expect(dayOn(got, '2026-10-12').receivedTetri).toBe(150_00);
    expect(dayOn(got, '2026-10-13').receivedTetri).toBe(150_00);
    expect(dayOn(got, '2026-10-14').receivedTetri).toBe(600_00);
    expect(week.receivedTetri).toBe(900_00);
    expect(week.receivedTetri).toBe(weekIncome(payments, { from: week.from, to: week.to }).rentTetri);
    identities(got);
  });

  it('every identity holds over a mixed week', () => {
    const second = (id: string, pickedUpOn: string, rows: CalendarPeriodRow[], over: { depositShortTetri?: number; debtTetri?: number } = {}) =>
      rental({ id, pickedUpOn, rows: [paidRow(1, pickedUpOn), ...rows], ...over });
    const mixed = calendar({
      rentals: [
        second('paid', '2026-10-05', [paidRow(2, '2026-10-12')]),
        second('ahead', '2026-10-06', [paidRow(2, '2026-10-13', '2026-10-10', 'transfer')]),
        second('half', '2026-10-07', [row(2, '2026-10-14', RATE, 50_00, by('2026-10-14'))]),
        second('expected', '2026-10-09', []),
        second('overdue', '2026-10-06', [row(2, '2026-10-13')], { depositShortTetri: 180_00, debtTetri: 330_00 }),
        second('nothing', '2026-10-05', [row(2, '2026-10-12', 0)]),
        second('above', '2026-10-05', [row(2, '2026-10-12', RATE, 200_00, by('2026-10-12'))]),
      ],
      credits: [credit({ paymentId: 'part', occurredOn: '2026-10-12', creditTetri: 70_00, customerId: 'c-expected', rentalId: 'expected' })],
      payments: [
        pay({ occurredOn: '2026-10-10', grossTetri: 150_00, channel: 'transfer', allocations: [{ target: 'period', amountTetri: 150_00 }] }),
        pay({ occurredOn: '2026-10-12', grossTetri: 150_00, allocations: [{ target: 'period', amountTetri: 150_00 }] }),
        pay({ occurredOn: '2026-10-12', grossTetri: 200_00, allocations: [{ target: 'period', amountTetri: 200_00 }] }),
        pay({ occurredOn: '2026-10-12', grossTetri: 70_00 }),
        pay({ occurredOn: '2026-10-14', grossTetri: 50_00, allocations: [{ target: 'period', amountTetri: 50_00 }] }),
      ],
    });
    identities(mixed);
    const week = calendarWeekOf(mixed, TODAY);
    expect(week.expected).toEqual({ count: 6, tetri: 900_00 });
    expect(week.paid).toEqual({ count: 3, tetri: 570_00 });
    expect(week.paidAhead).toEqual({ count: 1, tetri: 150_00 });
    expect(week.partTetri).toBe(120_00);
    expect(week.left).toEqual({ count: 3, tetri: 330_00 });
    expect(week.overdue).toEqual({ count: 1, tetri: 150_00 });
    expect(week.dueToday).toEqual({ count: 1, tetri: 100_00 });
    expect(week.upcoming).toEqual({ count: 1, tetri: 80_00 });
    expect(week.receivedTetri).toBe(470_00);
    // The debt holds an unpaid deposit too: 150 of it is this week, the rest is "earlier".
    expect(mixed.late).toMatchObject({ count: 1, debtTetri: 330_00, thisWeekTetri: 150_00, earlierTetri: 180_00 });
  });
});

describe('the function itself', () => {
  const twoOfOne = (): CalendarInput => {
    const input = example();
    return {
      ...input,
      rentals: [
        ...input.rentals,
        rental({ id: 'T1', number: 'R-00013', customerId: 'c-two', pickedUpOn: '2026-10-08', rows: [paidRow(1, '2026-10-08')] }),
        rental({ id: 'T2', number: 'R-00014', customerId: 'c-two', pickedUpOn: '2026-10-08', rows: [paidRow(1, '2026-10-08')] }),
      ],
      credits: [
        ...input.credits,
        credit({ paymentId: 'two-b', occurredOn: '2026-10-13', creditTetri: 100_00, customerId: 'c-two' }),
        credit({ paymentId: 'two-a', occurredOn: '2026-10-12', creditTetri: 100_00, customerId: 'c-two', channel: 'transfer' }),
      ],
    };
  };

  it('does not change what it is given', () => {
    const input = twoOfOne();
    const before = JSON.parse(JSON.stringify(input));
    paymentsCalendar(input);
    expect(input).toEqual(before);
  });

  it('answers the same whatever order the rentals and the credits come in', () => {
    const input = twoOfOne();
    const shuffled = { ...input, rentals: [...input.rentals].reverse(), credits: [...input.credits].reverse() };
    const cal = paymentsCalendar(input);
    expect(paymentsCalendar(shuffled)).toEqual(cal);
    // Handed over the same day: the lower number is first in the roll.
    expect(entryOf(cal, 'T1', '2026-10-15')).toMatchObject({ state: 'paid_ahead', creditTetri: RATE, paidOn: '2026-10-13', paymentId: 'two-b' });
    expect(entryOf(cal, 'T2', '2026-10-15')).toMatchObject({ state: 'expected', creditTetri: 50_00, leftTetri: 100_00 });
  });
});
