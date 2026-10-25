// «Оплаты по графику» without its sums (issue #15 of the director, ADR-0048):
// what a manager is sent is the rows — who owes what and when — and no figure
// that adds rows together. Literal dates: "today" is Wednesday 14.10.2026.
// Names are made up.
import { describe, expect, it } from 'vitest';
import {
  calendarEntriesOn,
  calendarGrid,
  calendarHoldsWeek,
  dayDueTetri,
  paymentsCalendar,
  scheduleCounts,
  scheduleOf,
  type CalendarPeriodRow,
  type CalendarRental,
  type CalendarRentalCard,
  type PaymentsCalendarAnswer,
} from '../src/index.js';
import { addDays } from '../src/time.js';

const TODAY = '2026-10-14';
const RATE = 150_00;

const row = (seq: number, startsOn: string, paid: boolean): CalendarPeriodRow => ({
  seq,
  startsOn,
  endsOn: addDays(startsOn, 6),
  amountTetri: RATE,
  paidTetri: paid ? RATE : 0,
  paidBeforeTransfer: false,
  lastPayment: paid ? { paymentId: `pay-${seq}-${startsOn}`, occurredOn: startsOn, createdAt: `${startsOn}T08:00:00.000Z`, channel: 'cash' } : null,
});

const rental = (id: string, pickedUpOn: string, rows: CalendarPeriodRow[], debtTetri: number): CalendarRental => ({
  id,
  number: `R-${id}`,
  customerId: `c-${id}`,
  status: 'active',
  pickedUpOn,
  returnedOn: null,
  weeklyRateTetri: RATE,
  periods: rows,
  depositShortTetri: 0,
  chargesOpenTetri: 0,
  debtTetri,
});

const card = (id: string): CalendarRentalCard => ({
  id,
  number: `R-${id}`,
  customer: { id: `c-${id}`, name: `Example Customer ${id}`, nameKa: null, nameLat: null, phone: null },
  vehicle: null,
  weeklyRateTetri: RATE,
  pickedUpOn: null,
  paidThrough: null,
  debtTetri: 0,
});

/** One rental a day late (its week fell due yesterday), one due today, one paid. */
function answer(): PaymentsCalendarAnswer {
  const cal = paymentsCalendar({
    today: TODAY,
    ...calendarGrid(TODAY),
    rentals: [
      rental('late', '2026-10-06', [row(1, '2026-10-06', true), row(2, '2026-10-13', false)], RATE),
      rental('today', '2026-10-07', [row(1, '2026-10-07', true), row(2, '2026-10-14', false)], RATE),
      rental('paid', '2026-10-08', [row(1, '2026-10-08', true)], 0),
    ],
    credits: [],
    payments: [{ occurredOn: '2026-10-12', direction: 'in', channel: 'cash', kind: 'rent', grossTetri: RATE, feeTetri: 0, allocations: [{ target: 'period', amountTetri: RATE }] }],
  });
  return { ...cal, rentals: ['late', 'today', 'paid'].map(card), unsortedIn: 2 };
}

describe('«Оплаты по графику» for a manager (issue #15)', () => {
  it('keeps every row with its own sums: who, which week, how much is left', () => {
    const full = answer();
    const s = scheduleOf(full);
    expect(s.totals).toBe(false);
    expect(s.entries).toEqual(full.entries);
    expect(s.late.rentals).toEqual(full.late.rentals);
    expect(s.late.count).toBe(full.late.count);
    expect(s.rentals).toEqual(full.rentals);
    expect(s.unsortedIn).toBe(2);
    expect(s.firstPickupOn).toBe(full.firstPickupOn);
    // The day's list is the same list.
    expect(calendarEntriesOn(s, TODAY)).toEqual(calendarEntriesOn(full, TODAY));
  });

  it('sends no figure that adds rows together: no week, no day’s total, nothing received, no debt of everybody', () => {
    const s = scheduleOf(answer());
    for (const w of s.weeks) expect(Object.keys(w).sort()).toEqual(['from', 'to']);
    for (const d of s.days) {
      expect(Object.keys(d).sort()).toEqual(['date', 'due', 'paidCount', 'states']);
      expect(Object.keys(d.due)).toEqual(['count']);
      expect(dayDueTetri(d)).toBeNull();
    }
    expect(Object.keys(s.late).sort()).toEqual(['count', 'rentals']);
    // Nothing of the kind anywhere in what goes out.
    const text = JSON.stringify(s);
    for (const key of ['receivedTetri', 'thisWeekTetri', 'earlierTetri', 'heaviest', 'paidAhead', 'upcoming', 'partTetri']) expect(text).not.toContain(key);
  });

  it('still says which weeks it holds, so a phone moving across a month needs no new request', () => {
    const full = answer();
    const s = scheduleOf(full);
    expect(s.weeks.map((w) => w.from)).toEqual(full.weeks.map((w) => w.from));
    expect(calendarHoldsWeek(s, TODAY)).toBe(true);
    expect(dayDueTetri(full.days.find((d) => d.date === TODAY)!)).toBe(RATE);
  });

  it('counts for the menu the rentals late and the weeks awaited today — the same rows the screen lists', () => {
    const full = answer();
    expect(scheduleCounts(full)).toEqual({ late: 1, dueToday: 1 });
    expect(scheduleCounts(scheduleOf(full))).toEqual(scheduleCounts(full));
    expect(full.late.rentals.map((l) => l.rentalId)).toEqual(['late']);
    expect(full.entries.filter((e) => e.dueOn === TODAY && e.state === 'due_today').map((e) => e.rentalId)).toEqual(['today']);
  });
});
