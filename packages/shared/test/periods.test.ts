import { describe, expect, it } from 'vitest';
import {
  customerDebt,
  isoWeekday,
  overdueDays,
  paidThrough,
  payOffsetDays,
  periodBounds,
  periodPayStatus,
  periodSeqOf,
  periodsThrough,
  rentDueOn,
  rotateWeekday,
  shiftExtraTetri,
  shiftDaysOffered,
  shiftedPayWeekday,
  shiftsOf,
  weekShiftPlan,
  weeksAnchor,
} from '../src/index.js';

describe('weekly periods (RNT-02)', () => {
  it('a period is 7 calendar days from the pickup date', () => {
    expect(periodBounds('2026-07-18', 1)).toEqual({ seq: 1, startsOn: '2026-07-18', endsOn: '2026-07-24' });
    expect(periodBounds('2026-07-18', 2)).toEqual({ seq: 2, startsOn: '2026-07-25', endsOn: '2026-07-31' });
  });

  it('acceptance: picked up 18.07.2026, as of 13.09.2026 there are 9 periods, none extra', () => {
    const periods = periodsThrough('2026-07-18', '2026-09-13');
    expect(periods).toHaveLength(9);
    expect(periods[8]).toEqual({ seq: 9, startsOn: '2026-09-12', endsOn: '2026-09-18' });
  });

  it('the day before a new week starts does not open it', () => {
    expect(periodsThrough('2026-07-18', '2026-09-11')).toHaveLength(8);
    expect(periodsThrough('2026-07-18', '2026-09-12')).toHaveLength(9);
  });

  it('a returned rental stops at the period containing the return day', () => {
    expect(periodsThrough('2026-07-18', '2026-09-13', '2026-08-02')).toHaveLength(3);
    expect(periodsThrough('2026-07-18', '2026-07-10')).toHaveLength(0);
  });

  it('places a date in its period', () => {
    expect(periodSeqOf('2026-07-18', '2026-07-17')).toBe(0);
    expect(periodSeqOf('2026-07-18', '2026-07-24')).toBe(1);
    expect(periodSeqOf('2026-07-18', '2026-07-25')).toBe(2);
  });

  it('crosses a month end and a DST-free zone without losing a day', () => {
    expect(periodBounds('2026-02-26', 2)).toEqual({ seq: 2, startsOn: '2026-03-05', endsOn: '2026-03-11' });
  });
});

describe('paid through', () => {
  const p = (seq: number, endsOn: string, payStatus: 'paid' | 'unpaid' | 'partial') => ({ seq, endsOn, payStatus });

  it('is the end of the last fully paid period in an unbroken run', () => {
    expect(paidThrough([p(1, '2026-07-24', 'paid'), p(2, '2026-07-31', 'paid'), p(3, '2026-08-07', 'unpaid')])).toBe(
      '2026-07-31',
    );
  });

  it('does not skip over an unpaid week', () => {
    expect(paidThrough([p(1, '2026-07-24', 'paid'), p(2, '2026-07-31', 'unpaid'), p(3, '2026-08-07', 'paid')])).toBe(
      '2026-07-24',
    );
    expect(paidThrough([p(1, '2026-07-24', 'partial')])).toBeNull();
  });

  it('calls a week at nothing paid, and a week with a price by what it got (ADR-0017)', () => {
    expect(periodPayStatus(0, 0)).toBe('paid');
    expect(periodPayStatus(15000, 0)).toBe('unpaid');
    expect(periodPayStatus(15000, 5000)).toBe('partial');
    expect(periodPayStatus(15000, 15000)).toBe('paid');
  });

  it('walks over a week at nothing, and still stops at an unpaid week before it', () => {
    const row = (seq: number, endsOn: string, amountTetri: number, paidTetri: number) => ({ seq, endsOn, payStatus: periodPayStatus(amountTetri, paidTetri) });
    expect(paidThrough([row(1, '2026-07-24', 15000, 15000), row(2, '2026-07-31', 0, 0), row(3, '2026-08-07', 15000, 0)])).toBe('2026-07-31');
    expect(paidThrough([row(1, '2026-07-24', 15000, 15000), row(2, '2026-07-31', 15000, 0), row(3, '2026-08-07', 0, 0)])).toBe('2026-07-24');
  });

  it('names the due day: the day after "paid through", or the pickup day while no week is paid', () => {
    expect(rentDueOn('2026-07-31', '2026-07-18')).toBe('2026-08-01');
    expect(rentDueOn(null, '2026-07-18')).toBe('2026-07-18');
  });

  it('counts late days from the day after the due day (ADR-0017)', () => {
    expect(overdueDays('2026-07-31', '2026-07-18', '2026-07-31')).toBe(0);
    // The due day itself is not a late day.
    expect(overdueDays('2026-07-31', '2026-07-18', '2026-08-01')).toBe(0);
    expect(overdueDays('2026-07-31', '2026-07-18', '2026-08-02')).toBe(1);
    expect(overdueDays('2026-07-31', '2026-07-18', '2026-08-03')).toBe(2);
    // Nothing paid yet: the pickup day is the due day.
    expect(overdueDays(null, '2026-07-18', '2026-07-18')).toBe(0);
    expect(overdueDays(null, '2026-07-18', '2026-07-19')).toBe(1);
    expect(overdueDays(null, '2026-07-18', '2026-07-21')).toBe(3);
  });
});

// A week made longer by an owner (ADR-0041). Literal dates: picked up on
// Thursday 01.10.2026, so week 2 is Thursday 08.10 – Wednesday 14.10. The
// courier of the call of 21.10.2026 — a made-up rental here — paid for it on
// Sunday 11.10, three days late, with the three days on top.
describe('a week made longer (ADR-0041)', () => {
  const PICKUP = '2026-10-01';
  const three = [{ seq: 2, days: 3 }];

  it('stretches its own week and moves every later one, and leaves the earlier ones', () => {
    expect(periodBounds(PICKUP, 1, three)).toEqual({ seq: 1, startsOn: '2026-10-01', endsOn: '2026-10-07' });
    expect(periodBounds(PICKUP, 2, three)).toEqual({ seq: 2, startsOn: '2026-10-08', endsOn: '2026-10-17' });
    expect(periodBounds(PICKUP, 3, three)).toEqual({ seq: 3, startsOn: '2026-10-18', endsOn: '2026-10-24' });
    expect(periodBounds(PICKUP, 4, three)).toEqual({ seq: 4, startsOn: '2026-10-25', endsOn: '2026-10-31' });
  });

  it('two moves add up: each week starts later by every day the weeks before it gained', () => {
    const two = [...three, { seq: 4, days: 2 }];
    expect(periodBounds(PICKUP, 4, two)).toEqual({ seq: 4, startsOn: '2026-10-25', endsOn: '2026-11-02' });
    expect(periodBounds(PICKUP, 5, two)).toEqual({ seq: 5, startsOn: '2026-11-03', endsOn: '2026-11-09' });
  });

  it('opens the next week on its moved first day, not on the old one', () => {
    expect(periodsThrough(PICKUP, '2026-10-15', null, three)).toHaveLength(2);
    expect(periodsThrough(PICKUP, '2026-10-17', null, three)).toHaveLength(2);
    expect(periodsThrough(PICKUP, '2026-10-18', null, three)).toHaveLength(3);
    expect(periodsThrough(PICKUP, '2026-10-18', null, three)[2]).toEqual({ seq: 3, startsOn: '2026-10-18', endsOn: '2026-10-24' });
    // Without the move the third week would have begun on Thursday 15.10.
    expect(periodsThrough(PICKUP, '2026-10-15')).toHaveLength(3);
    // A return stops it the same way.
    expect(periodsThrough(PICKUP, '2026-10-30', '2026-10-17', three)).toHaveLength(2);
  });

  it('places a date in its moved week', () => {
    expect(periodSeqOf(PICKUP, '2026-09-30', three)).toBe(0);
    expect(periodSeqOf(PICKUP, '2026-10-07', three)).toBe(1);
    expect(periodSeqOf(PICKUP, '2026-10-17', three)).toBe(2);
    expect(periodSeqOf(PICKUP, '2026-10-18', three)).toBe(3);
    expect(periodSeqOf(PICKUP, '2026-10-25', three)).toBe(4);
  });

  it('reads the shifts off the rows, and a rental never moved has none', () => {
    expect(shiftsOf([{ seq: 1, extraDays: 0 }, { seq: 2, extraDays: 3 }, { seq: 3 }])).toEqual(three);
    expect(shiftsOf([{ seq: 1 }, { seq: 2, extraDays: null }])).toEqual([]);
    // No shifts: the 7-day grid of RNT-02, exactly as before.
    expect(periodsThrough('2026-07-18', '2026-09-13', null, [])).toEqual(periodsThrough('2026-07-18', '2026-09-13'));
    expect(periodSeqOf('2026-07-18', '2026-07-25', [])).toBe(2);
  });

  it('counts the pay day from the weeks’ new weekday, and the pay day moves with them', () => {
    // The weeks now run from Sunday: the pickup (Thursday) plus three days.
    expect(weeksAnchor(PICKUP, 3)).toBe('2026-10-04');
    expect(weeksAnchor(PICKUP, 0)).toBe(PICKUP);
    expect(weeksAnchor(null, 3)).toBeNull();
    expect(isoWeekday(weeksAnchor(PICKUP, 3)!)).toBe(isoWeekday('2026-10-18'));
    // Rotating round the week.
    expect(rotateWeekday(6, 3)).toBe(2);
    expect(rotateWeekday(7, 1)).toBe(1);
    expect(rotateWeekday(1, -1)).toBe(7);
    // A renter who pays on Friday for a week from Thursday — one day in.
    // After three days the pay day is Monday, still one day into a week from Sunday.
    const before = payOffsetDays(PICKUP, 5);
    const day = shiftedPayWeekday(5, 3, weeksAnchor(PICKUP, 3)!);
    expect(day).toBe(1);
    expect(payOffsetDays(weeksAnchor(PICKUP, 3), day)).toBe(before);
    // No pay day stays none; the weeks' own weekday is kept as none.
    expect(shiftedPayWeekday(null, 3, '2026-10-04')).toBeNull();
    expect(shiftedPayWeekday(4, 3, '2026-10-04')).toBeNull();
  });

  it('suggests rate ÷ 7 × days in whole lari: 150 a week, 3 days → 64', () => {
    expect(shiftExtraTetri(15000, 3)).toBe(6400);
    expect(shiftExtraTetri(15000, 1)).toBe(2100);
    expect(shiftExtraTetri(14000, 3)).toBe(6000);
    expect(shiftExtraTetri(17000, 6)).toBe(14600);
    expect(shiftExtraTetri(15000, 0)).toBe(0);
  });

  it('plans the move: the new end, the next week and its due day, the suggestion', () => {
    expect(weekShiftPlan({ startsOn: '2026-10-08', days: 3, weeklyRateTetri: 15000 })).toEqual({
      endsOn: '2026-10-17',
      lengthDays: 10,
      nextStartsOn: '2026-10-18',
      nextDueOn: '2026-10-18',
      suggestedExtraTetri: 6400,
    });
    // With a pay day one day into the week, the next week is due a day after it starts.
    expect(weekShiftPlan({ startsOn: '2026-10-08', days: 3, weeklyRateTetri: 15000, payOffsetDays: 1 }).nextDueOn).toBe('2026-10-19');
    // Nought: the week as it was.
    expect(weekShiftPlan({ startsOn: '2026-10-08', days: 0, weeklyRateTetri: 15000 })).toMatchObject({ endsOn: '2026-10-14', lengthDays: 7, nextStartsOn: '2026-10-15', suggestedExtraTetri: 0 });
    expect(() => weekShiftPlan({ startsOn: '2026-10-08', days: 7, weeklyRateTetri: 15000 })).toThrow();
    expect(() => weekShiftPlan({ startsOn: '2026-10-08', days: -1, weeklyRateTetri: 15000 })).toThrow();
    expect(() => weekShiftPlan({ startsOn: '2026-10-08', days: 1.5, weeklyRateTetri: 15000 })).toThrow();
  });

  it('offers the days he is late, from the week’s pay day: the next pay day a week after he paid', () => {
    // Invented: a week from Thursday 08.10, 150 a week.
    // No pay day of its own: due on the week's first day, paid on Sunday 11.10 — 3 days late.
    expect(shiftDaysOffered({ startsOn: '2026-10-08', today: '2026-10-11' })).toEqual({ days: 3, exact: true });
    expect(weekShiftPlan({ startsOn: '2026-10-08', days: 3, weeklyRateTetri: 15000 }).nextDueOn).toBe('2026-10-18');
    // Pay day Saturday, two days into the week (due 10.10), paid on Tuesday 13.10: 3 days late, not 5.
    expect(shiftDaysOffered({ startsOn: '2026-10-08', payOffsetDays: 2, today: '2026-10-13' })).toEqual({ days: 3, exact: true });
    const plan = weekShiftPlan({ startsOn: '2026-10-08', days: 3, weeklyRateTetri: 15000, payOffsetDays: 2 });
    expect(plan).toMatchObject({ nextStartsOn: '2026-10-18', nextDueOn: '2026-10-20', suggestedExtraTetri: 6400 });
    // Not late yet, or later than a week can move: the nearest end, and not called exact.
    expect(shiftDaysOffered({ startsOn: '2026-10-08', payOffsetDays: 3, today: '2026-10-10' })).toEqual({ days: 1, exact: false });
    expect(shiftDaysOffered({ startsOn: '2026-10-08', payOffsetDays: 3, today: '2026-10-11' })).toEqual({ days: 1, exact: false });
    expect(shiftDaysOffered({ startsOn: '2026-10-08', today: '2026-10-17' })).toEqual({ days: 6, exact: false });
  });

  it('the week made longer is in the debt from its own due day at its new price, and paid off by it', () => {
    const debt = (today: string, paidTetri: number) =>
      customerDebt({
        today,
        rentals: [
          {
            id: 'r1',
            number: 'R-1',
            open: true,
            periods: [
              { startsOn: '2026-10-01', amountTetri: 15000, paidTetri: 15000 },
              { startsOn: '2026-10-08', amountTetri: 15000 + 6400, paidTetri },
            ],
            deposit: null,
          },
        ],
        sales: [],
        repairs: [],
        unplacedTetri: 0,
        depositHeldTetri: 0,
      }).owesTetri;
    expect(debt('2026-10-07', 0)).toBe(0);
    expect(debt('2026-10-11', 0)).toBe(21400);
    expect(debt('2026-10-11', 15000)).toBe(6400);
    expect(debt('2026-10-11', 21400)).toBe(0);
    // Paid through the new end of the week.
    expect(paidThrough([{ seq: 1, endsOn: '2026-10-07', payStatus: 'paid' }, { seq: 2, endsOn: '2026-10-17', payStatus: periodPayStatus(21400, 21400) }])).toBe('2026-10-17');
    expect(rentDueOn('2026-10-17', PICKUP)).toBe('2026-10-18');
  });
});
