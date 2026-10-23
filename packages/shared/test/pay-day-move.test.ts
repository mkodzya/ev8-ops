// The pay day moved while a bank line is allocated, and a week made shorter
// (issue #12 of the director, 23.10.2026; Mika's «А» the same day; ADR-0041,
// addendum of 23.10.2026). Every rental, date and sum here is made up: a
// renter whose weeks run Thursday to Wednesday pays 170 for a 150 week — 20
// so that he pays on Fridays from now on.
import { describe, expect, it } from 'vitest';
import {
  isShiftDays,
  isoWeekday,
  paidThrough,
  payDayMove,
  payDayShiftDays,
  payOffsetDays,
  periodBounds,
  periodPayStatus,
  periodSeqOf,
  periodsThrough,
  rentDueOn,
  rentWeekday,
  settleMoney,
  shiftExtraTetri,
  shiftMoneyTetri,
  shiftedPayWeekday,
  shiftsOf,
  shorterEndsBeforeToday,
  weekShiftPlan,
  weekSurplusFreed,
  weeksAnchor,
  moneyWithCredit,
  type RentalMoney,
} from '../src/index.js';

/** Thursday: the weeks run Thursday to Wednesday; week 4 is 22.10–28.10. */
const PICKUP = '2026-10-01';
const WEEK4 = '2026-10-22';
const RATE = 15000;

describe('the new pay day picks the days (issue #12)', () => {
  it('a day later in the week Monday … Sunday is longer, an earlier one shorter', () => {
    expect(payDayShiftDays(4, 5)).toBe(1);
    expect(payDayShiftDays(4, 3)).toBe(-1);
    expect(payDayShiftDays(4, 1)).toBe(-3);
    expect(payDayShiftDays(4, 7)).toBe(3);
    expect(payDayShiftDays(1, 7)).toBe(6);
    expect(payDayShiftDays(7, 1)).toBe(-6);
    expect(payDayShiftDays(4, 4)).toBe(0);
    // Every answer is a move a week may take.
    for (let from = 1; from <= 7; from++) for (let to = 1; to <= 7; to++) expect(isShiftDays(payDayShiftDays(from, to))).toBe(true);
  });

  it('the director’s case: Friday instead of Thursday — the week 22.10–29.10, the next rent on Friday 30.10, 21 suggested', () => {
    const move = payDayMove({ payDay: 4, to: 5, startsOn: WEEK4, weeklyRateTetri: RATE, payOffsetDays: 0, today: '2026-10-23' });
    expect(move).toEqual({
      days: 1,
      plan: { endsOn: '2026-10-29', lengthDays: 8, nextStartsOn: '2026-10-30', nextDueOn: '2026-10-30', suggestedExtraTetri: 2100 },
      endsBeforeToday: false,
    });
    expect(isoWeekday(move.plan.nextDueOn)).toBe(5);
  });

  it('an earlier day makes the week shorter, never ending before today', () => {
    const on = (to: number, today: string) => payDayMove({ payDay: 4, to, startsOn: WEEK4, weeklyRateTetri: RATE, payOffsetDays: 0, today });
    expect(on(3, '2026-10-23')).toMatchObject({ days: -1, plan: { endsOn: '2026-10-27', lengthDays: 6, nextStartsOn: '2026-10-28', suggestedExtraTetri: 2100 }, endsBeforeToday: false });
    expect(on(1, '2026-10-23')).toMatchObject({ days: -3, plan: { endsOn: '2026-10-25', nextDueOn: '2026-10-26' }, endsBeforeToday: false });
    // On Tuesday 27.10 a week ending on Sunday or Monday would end before today; one ending today may.
    expect(on(1, '2026-10-27').endsBeforeToday).toBe(true);
    expect(on(2, '2026-10-27').endsBeforeToday).toBe(true);
    expect(on(3, '2026-10-27').endsBeforeToday).toBe(false);
    // A longer week is never refused for its end: the next week then opens at once.
    expect(shorterEndsBeforeToday(2, '2026-10-20', '2026-10-27')).toBe(false);
    expect(shorterEndsBeforeToday(-2, '2026-10-26', '2026-10-27')).toBe(true);
    expect(shorterEndsBeforeToday(-2, '2026-10-27', '2026-10-27')).toBe(false);
  });

  it('a rental with a pay day of its own keeps it as many days into a week, and pays on the day chosen', () => {
    // Made up: picked up on Monday 05.10, pays on Wednesday — two days into a week from Monday.
    const pickup = '2026-10-05';
    const offset = payOffsetDays(pickup, 3);
    expect(offset).toBe(2);
    const week3 = periodBounds(pickup, 3).startsOn;
    expect(week3).toBe('2026-10-19');
    // Friday: two days longer, the next week from Wednesday 28.10, its rent on Friday 30.10.
    const later = payDayMove({ payDay: 3, to: 5, startsOn: week3, weeklyRateTetri: RATE, payOffsetDays: offset, today: '2026-10-21' });
    expect(later).toMatchObject({ days: 2, plan: { endsOn: '2026-10-27', nextStartsOn: '2026-10-28', nextDueOn: '2026-10-30', suggestedExtraTetri: 4300 } });
    // The pay day the server keeps: Friday, still two days into the moved weeks.
    const kept = shiftedPayWeekday(3, 2, weeksAnchor(pickup, 2)!);
    expect(kept).toBe(5);
    expect(payOffsetDays(weeksAnchor(pickup, 2), kept)).toBe(offset);
    // Tuesday: a day shorter, the next week from Sunday 25.10, its rent on Tuesday 27.10.
    const earlier = payDayMove({ payDay: 3, to: 2, startsOn: week3, weeklyRateTetri: RATE, payOffsetDays: offset, today: '2026-10-21' });
    expect(earlier).toMatchObject({ days: -1, plan: { endsOn: '2026-10-24', nextStartsOn: '2026-10-25', nextDueOn: '2026-10-27' } });
    expect(shiftedPayWeekday(3, -1, weeksAnchor(pickup, -1)!)).toBe(2);
  });
});

describe('a week made shorter (ADR-0041, addendum of 23.10.2026)', () => {
  const shorter = [{ seq: 2, days: -2 }];

  it('shortens its own week and moves every later one earlier', () => {
    expect(periodBounds(PICKUP, 1, shorter)).toEqual({ seq: 1, startsOn: '2026-10-01', endsOn: '2026-10-07' });
    expect(periodBounds(PICKUP, 2, shorter)).toEqual({ seq: 2, startsOn: '2026-10-08', endsOn: '2026-10-12' });
    expect(periodBounds(PICKUP, 3, shorter)).toEqual({ seq: 3, startsOn: '2026-10-13', endsOn: '2026-10-19' });
    // Opened on its earlier first day, and a date found in it.
    expect(periodsThrough(PICKUP, '2026-10-12', null, shorter)).toHaveLength(2);
    expect(periodsThrough(PICKUP, '2026-10-13', null, shorter)).toHaveLength(3);
    expect(periodSeqOf(PICKUP, '2026-10-12', shorter)).toBe(2);
    expect(periodSeqOf(PICKUP, '2026-10-13', shorter)).toBe(3);
  });

  it('a longer week and a shorter one add up', () => {
    const both = [
      { seq: 2, days: 3 },
      { seq: 3, days: -1 },
    ];
    expect(periodBounds(PICKUP, 3, both)).toEqual({ seq: 3, startsOn: '2026-10-18', endsOn: '2026-10-23' });
    expect(periodBounds(PICKUP, 4, both)).toEqual({ seq: 4, startsOn: '2026-10-24', endsOn: '2026-10-30' });
  });

  it('reads days lost off the rows, and counts the weeks’ weekday back from the pickup', () => {
    expect(shiftsOf([{ seq: 1, extraDays: 0 }, { seq: 2, extraDays: -2 }])).toEqual(shorter);
    // Two days off a week from Thursday: the weeks run from Tuesday, a day before the pickup in the calendar.
    expect(weeksAnchor(PICKUP, -2)).toBe('2026-09-29');
    expect(isoWeekday(weeksAnchor(PICKUP, -2)!)).toBe(isoWeekday('2026-10-13'));
    expect(rentWeekday(PICKUP, -2, null)).toBe(2);
    expect(weeksAnchor(PICKUP, 0)).toBe(PICKUP);
  });

  it('plans a shorter week: down to a single day, never seven off', () => {
    expect(weekShiftPlan({ startsOn: WEEK4, days: -1, weeklyRateTetri: RATE })).toEqual({
      endsOn: '2026-10-27',
      lengthDays: 6,
      nextStartsOn: '2026-10-28',
      nextDueOn: '2026-10-28',
      suggestedExtraTetri: 2100,
    });
    expect(weekShiftPlan({ startsOn: WEEK4, days: -6, weeklyRateTetri: RATE })).toMatchObject({ endsOn: WEEK4, lengthDays: 1, nextStartsOn: '2026-10-23' });
    expect(isShiftDays(-6)).toBe(true);
    expect(isShiftDays(-7)).toBe(false);
    expect(isShiftDays(0.5)).toBe(false);
  });

  it('the suggestion is the days’ worth either way; the money kept carries the days’ sign', () => {
    expect(shiftExtraTetri(RATE, -1)).toBe(2100);
    expect(shiftExtraTetri(RATE, -3)).toBe(shiftExtraTetri(RATE, 3));
    // Typed 20 for a day gained is 20 on top; 21 for a day lost is 21 off; no move, no money.
    expect(shiftMoneyTetri(1, 2000)).toBe(2000);
    expect(shiftMoneyTetri(-1, 2100)).toBe(-2100);
    expect(shiftMoneyTetri(-1, -2100)).toBe(-2100);
    expect(shiftMoneyTetri(0, 2000)).toBe(0);
  });
});

describe('money above a week’s new price becomes credit (ADR-0041, addendum of 23.10.2026)', () => {
  /** Week 4 of the made-up rental: 150 by the bank line's rent part, 20 by its pay-day part. */
  const paid = [
    { paymentId: 'rent', amountTetri: 15000, id: 'a1' },
    { paymentId: 'move', amountTetri: 2000, id: 'a2' },
  ];

  it('the director’s acceptance: 150 + 20 close a week of 170, paid through 29.10, the next rent on Friday 30.10', () => {
    expect(periodPayStatus(RATE + 2000, 17000)).toBe('paid');
    const through = paidThrough([
      { seq: 1, endsOn: '2026-10-07', payStatus: 'paid' },
      { seq: 2, endsOn: '2026-10-14', payStatus: 'paid' },
      { seq: 3, endsOn: '2026-10-21', payStatus: 'paid' },
      { seq: 4, endsOn: '2026-10-29', payStatus: 'paid' },
    ]);
    expect(through).toBe('2026-10-29');
    expect(rentDueOn(through, PICKUP)).toBe('2026-10-30');
    expect(isoWeekday('2026-10-30')).toBe(5);
  });

  it('frees the newest money first, as much as the new price does not need', () => {
    // The move taken back: 150 again — the pay-day part's 20 goes.
    expect(weekSurplusFreed(paid, 15000)).toEqual([{ paymentId: 'move', amountTetri: 2000, id: 'a2' }]);
    // A day shorter instead, for 21 off: 129 — the 20 and one lari of the rent.
    expect(weekSurplusFreed(paid, 12900)).toEqual([
      { paymentId: 'move', amountTetri: 2000, id: 'a2' },
      { paymentId: 'rent', amountTetri: 2100, id: 'a1' },
    ]);
    // Dearer, or the same: nothing freed.
    expect(weekSurplusFreed(paid, 17000)).toEqual([]);
    expect(weekSurplusFreed(paid, 20000)).toEqual([]);
    expect(weekSurplusFreed([], 0)).toEqual([]);
  });

  it('what is freed waits as credit until the next week exists, then pays it', () => {
    const week = (seq: number, startsOn: string, endsOn: string, amountTetri: number, parts: typeof paid) => ({ id: `w${seq}`, seq, startsOn, endsOn, amountTetri, paidBeforeTransfer: false, parts });
    const freed = weekSurplusFreed(paid, 15000);
    const kept = [{ paymentId: 'rent', amountTetri: 15000, id: 'a1' }];
    const now: RentalMoney = {
      weeks: [week(4, WEEK4, '2026-10-28', 15000, kept)],
      deposit: null,
      charges: [],
      credit: moneyWithCredit(
        [
          { id: 'rent', creditTetri: 0 },
          { id: 'move', creditTetri: 0 },
        ],
        freed,
      ),
    };
    // No next week yet: the 20 stays the customer's credit.
    expect(settleMoney(now).credit).toEqual([
      { id: 'rent', creditTetri: 0 },
      { id: 'move', creditTetri: 2000 },
    ]);
    // The night the next week opens, the 20 goes onto it.
    const later = settleMoney({ ...now, weeks: [...now.weeks, week(5, '2026-10-29', '2026-11-04', 15000, [])] });
    expect(later.weeks[1].parts).toEqual([{ paymentId: 'move', amountTetri: 2000 }]);
    expect(later.credit.find((c) => c.id === 'move')?.creditTetri).toBe(0);
  });
});
