// One rule for overdue and due today (issue #18 of the director, B4; Mika's
// «Одно правило календаря» of 28.10.2026): «Сегодня», «Аренды», «Клиенты» and
// «Оплаты по графику» say one thing of a rental, and it is the schedule's.
//
// The case of 25.10.2026 with invented names and sums: a rental whose second
// week has a row and no money on it, while the customer's advance lies unplaced
// until the night. Its stored "paid through" says late; the schedule shows the
// week paid by the advance. Today is Sunday 25.10.2026.
import { describe, expect, it } from 'vitest';
import {
  customerDebt,
  customerOwing,
  dayQueue,
  effectiveRentalStatus,
  paymentsCalendar,
  runsOnSchedule,
  scheduleCounts,
  schedulePayOf,
  statusBySchedule,
  type CalendarCredit,
  type CalendarPeriodRow,
  type CalendarRental,
  type QueueInput,
} from '../src/index.js';
import { addDays } from '../src/time.js';

const TODAY = '2026-10-25';
const RATE = 150_00;

const week = (seq: number, startsOn: string, paidTetri: number): CalendarPeriodRow => ({
  seq,
  startsOn,
  endsOn: addDays(startsOn, 6),
  amountTetri: RATE,
  paidTetri,
  paidBeforeTransfer: false,
  lastPayment: paidTetri > 0 ? { paymentId: `p-${seq}-${startsOn}`, occurredOn: startsOn, createdAt: `${startsOn}T08:00:00.000Z`, channel: 'cash' } : null,
});

const rental = (id: string, pickedUpOn: string, periods: CalendarPeriodRow[], debtTetri: number): CalendarRental => ({
  id,
  number: `R-TEST-${id}`,
  customerId: `c-${id}`,
  status: 'active',
  pickedUpOn,
  returnedOn: null,
  weeklyRateTetri: RATE,
  periods,
  depositShortTetri: 0,
  chargesOpenTetri: 0,
  debtTetri,
});

// «R-00002-shaped»: handed over Thursday 15.10, the first week paid, the week
// of 22–28.10 opened by the roll with nothing on it — and 150 the customer sent
// on 24.10 to no rental, which the night will lay on that week.
const advance = rental('adv', '2026-10-15', [week(1, '2026-10-15', RATE), week(2, '2026-10-22', 0)], RATE);
const advanceMoney: CalendarCredit = { paymentId: 'p-adv', occurredOn: '2026-10-24', createdAt: '2026-10-24T09:00:00.000Z', channel: 'cash', creditTetri: RATE, customerId: 'c-adv', rentalId: null };
// Late: handed over 08.10, the weeks of 15.10 and 22.10 unpaid, no money in.
const late = rental('late', '2026-10-08', [week(1, '2026-10-08', RATE), week(2, '2026-10-15', 0), week(3, '2026-10-22', 0)], 2 * RATE);
// Due today: handed over Sunday 18.10, its second week began today.
const due = rental('due', '2026-10-18', [week(1, '2026-10-18', RATE), week(2, '2026-10-25', 0)], RATE);

const calendar = () =>
  paymentsCalendar({ today: TODAY, from: '2026-10-19', to: '2026-10-25', rentals: [advance, late, due], credits: [advanceMoney], payments: [] });

/** What each list calls a rental: its stored "paid through" read by `effectiveRentalStatus`, then the schedule. */
const paidThrough = { adv: '2026-10-21', late: '2026-10-14', due: '2026-10-24' } as const;
const stored = (r: CalendarRental) => effectiveRentalStatus('active', paidThrough[r.id as keyof typeof paidThrough], r.pickedUpOn, TODAY);

describe('one rule for overdue and due today (issue #18, B4)', () => {
  it('the schedule shows the advanced week paid, the late rental late with its days, the due one awaited', () => {
    const cal = calendar();
    expect(cal.entries.find((e) => e.rentalId === 'adv' && e.seq === 2)).toMatchObject({ state: 'paid', creditTetri: RATE, leftTetri: 0 });
    expect(cal.late.rentals.map((l) => [l.rentalId, l.days])).toEqual([['late', 10]]);
    const pay = schedulePayOf(cal);
    expect(pay.get('adv')).toBeUndefined();
    expect(pay.get('late')).toEqual({ state: 'overdue', days: 10 });
    expect(pay.get('due')).toEqual({ state: 'due_today', days: 0 });
    expect(scheduleCounts(cal)).toEqual({ late: 1, dueToday: 1 });
  });

  it('«Аренды»: the stored "paid through" said «Просрочена» of the advanced rental; the list now says what the schedule says', () => {
    const pay = schedulePayOf(calendar());
    expect(stored(advance)).toBe('overdue');
    expect(statusBySchedule(stored(advance), pay.get('adv'))).toBe('active');
    expect(statusBySchedule(stored(late), pay.get('late'))).toBe('overdue');
    expect(statusBySchedule(stored(due), pay.get('due'))).toBe('due_today');
    // The segments of the list are these statuses: the overdue one holds what «Просрочки» holds.
    const segment = (s: string) => [advance, late, due].filter((r) => statusBySchedule(stored(r), pay.get(r.id)) === s).map((r) => r.id);
    expect(segment('overdue')).toEqual(calendar().late.rentals.map((l) => l.rentalId));
    expect(segment('due_today')).toEqual(['due']);
  });

  it('a rental the schedule does not run keeps its own status', () => {
    for (const s of ['paused', 'disputed', 'returned', 'booked'] as const) expect(statusBySchedule(s, { state: 'overdue', days: 3 })).toBe(s);
    expect(runsOnSchedule({ status: 'active', pickedUpOn: '2026-10-01', returnedOn: null })).toBe(true);
    expect(runsOnSchedule({ status: 'overdue', pickedUpOn: '2026-10-01', returnedOn: null })).toBe(true);
    expect(runsOnSchedule({ status: 'paused', pickedUpOn: '2026-10-01', returnedOn: null })).toBe(false);
    expect(runsOnSchedule({ status: 'active', pickedUpOn: null, returnedOn: null })).toBe(false);
    expect(runsOnSchedule({ status: 'active', pickedUpOn: '2026-10-01', returnedOn: '2026-10-20' })).toBe(false);
  });

  it('«Клиенты → Должны»: the advanced customer is not a debtor, the late one is, the due one is awaited', () => {
    const pay = schedulePayOf(calendar());
    const owing = (r: CalendarRental, deposit = { amountTetri: 180_00, paidTetri: 180_00 }, unplacedTetri = 0, extra: { dueTodayTetri?: number } = {}) => {
      const debt = customerDebt({
        today: TODAY,
        rentals: [{ id: r.id, number: r.number, open: true, periods: r.periods.map((p) => ({ startsOn: p.startsOn, amountTetri: p.amountTetri, paidTetri: p.paidTetri })), deposit }],
        sales: [],
        repairs: [],
        unplacedTetri,
        depositHeldTetri: deposit.paidTetri,
      });
      return customerOwing({ owesTetri: debt.owesTetri, dueTodayTetri: extra.dueTodayTetri ?? 0, parts: debt.parts, rentals: [{ id: r.id, pay: pay.get(r.id) }] });
    };
    expect(owing(advance, undefined, RATE)).toBeNull();
    expect(owing(late)).toBe('debtor');
    expect(owing(due, undefined, 0, { dueTodayTetri: RATE })).toBe('awaited');
    // A deposit short since an earlier day is owed beside an awaited week: a debtor, as before.
    expect(owing(due, { amountTetri: 180_00, paidTetri: 100_00 }, 0, { dueTodayTetri: RATE })).toBe('debtor');
  });

  it('owed weeks of a rental the schedule does not run — paused, disputed, returned — still make a debtor', () => {
    expect(customerOwing({ owesTetri: RATE, dueTodayTetri: 0, parts: [{ kind: 'rent', id: 'paused', owesTetri: RATE }], rentals: [] })).toBe('debtor');
    // Goods and a sale's instalment are owed from their day, as before.
    expect(customerOwing({ owesTetri: 50_00, dueTodayTetri: 0, parts: [{ kind: 'goods', id: 'g', owesTetri: 50_00 }], rentals: [] })).toBe('debtor');
    expect(customerOwing({ owesTetri: 0, dueTodayTetri: 0, parts: [], rentals: [] })).toBeNull();
  });

  it('«Сегодня»: one line with the schedule’s two numbers, the advanced rental in neither', () => {
    const input: QueueInput = {
      today: TODAY,
      owner: true,
      rentals: [],
      schedule: scheduleCounts(calendar()),
      tills: [],
      myTillTetri: 0,
      unmatchedLines: 0,
      staleBanks: [],
      instalments: [],
      service: { open: 0, longerThanWeek: 0, longestDays: 0 },
      reports: [],
      lowParts: { count: 0, note: '' },
      purchases: [],
      vehiclesWithoutPool: 0,
      vehiclesWithoutPoint: 0,
      odooDeposits: { count: 0, amountTetri: 0 },
      kommo: null,
      kommoDeals: [],
    };
    expect(dayQueue(input).flatMap((g) => g.rows).map((r) => [r.action, r.href, r.note])).toEqual([['open_schedule', '/schedule', '1|1']]);
  });
});
