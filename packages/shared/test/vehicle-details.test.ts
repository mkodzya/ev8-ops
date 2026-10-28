// «Изменить данные» on a moped's card (issue #19 of the director, item 2): the
// colour, the year and the day it came. Every day and year here is invented.
import { describe, expect, it } from 'vitest';
import { VEHICLE_YEAR_MIN, arrivalFault, arrivalLatestDay, vehicleYearFault, vehicleYearRange } from '../src/index.js';

const TODAY = '2026-10-28';

describe('a moped’s year', () => {
  it('runs from 2000 to next year: a model year is ahead of the calendar by one, never more', () => {
    expect(vehicleYearRange(TODAY)).toEqual({ min: VEHICLE_YEAR_MIN, max: 2027 });
    expect(vehicleYearFault(2000, TODAY)).toBeNull();
    expect(vehicleYearFault(2025, TODAY)).toBeNull();
    expect(vehicleYearFault(2027, TODAY)).toBeNull();
    expect(vehicleYearFault(2028, TODAY)).toBe('too_late');
    expect(vehicleYearFault(1999, TODAY)).toBe('too_early');
    // Two digits typed for four is not a year.
    expect(vehicleYearFault(25, TODAY)).toBe('too_early');
  });

  it('moves with the company’s year, not a fixed one', () => {
    expect(vehicleYearRange('2027-01-01').max).toBe(2028);
  });
});

describe('the day a moped came', () => {
  it('is today at the latest when its history holds nothing else', () => {
    expect(arrivalLatestDay({ today: TODAY, historyOn: [] })).toEqual({ on: TODAY, by: 'today' });
    expect(arrivalFault({ on: TODAY, today: TODAY, historyOn: [] })).toBeNull();
    expect(arrivalFault({ on: '2026-10-29', today: TODAY, historyOn: [] })).toBe('future');
  });

  it('is not after the first thing its history holds — a hand-over, a repair, a tracker — and may be that same day', () => {
    // A hand-over on 05.09, a repair on 20.09, a tracker since 01.10, one day not known.
    const historyOn = ['2026-09-20', null, '2026-09-05', '2026-10-01'];
    expect(arrivalLatestDay({ today: TODAY, historyOn })).toEqual({ on: '2026-09-05', by: 'history' });
    expect(arrivalFault({ on: '2026-09-05', today: TODAY, historyOn })).toBeNull();
    expect(arrivalFault({ on: '2026-08-15', today: TODAY, historyOn })).toBeNull();
    expect(arrivalFault({ on: '2026-09-06', today: TODAY, historyOn })).toBe('after_history');
  });

  it('says «today» when the first thing in the history is today or later: the later bound names itself', () => {
    expect(arrivalLatestDay({ today: TODAY, historyOn: [TODAY] })).toEqual({ on: TODAY, by: 'today' });
    expect(arrivalFault({ on: '2026-10-30', today: TODAY, historyOn: ['2026-11-01'] })).toBe('future');
  });
});
