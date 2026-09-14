import { describe, expect, it } from 'vitest';
import { overdueDays, paidThrough, periodBounds, periodSeqOf, periodsThrough } from '../src/index.js';

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

  it('counts days behind from the day after the covered one', () => {
    expect(overdueDays('2026-07-31', '2026-07-18', '2026-07-31')).toBe(0);
    expect(overdueDays('2026-07-31', '2026-07-18', '2026-08-03')).toBe(3);
    expect(overdueDays(null, '2026-07-18', '2026-07-18')).toBe(1);
  });
});
