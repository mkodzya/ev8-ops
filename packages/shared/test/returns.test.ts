import { describe, expect, it } from 'vitest';
import { localDateTime, returnSettlement } from '../src/index.js';

const week = (seq: number, startsOn: string, endsOn: string, paid = 0) => ({ id: `p${seq}`, seq, startsOn, endsOn, amountTetri: 15000, paidTetri: paid });

describe('a return’s settlement (wave 3 §3.4)', () => {
  it('charges the week begun before the return in full, and no delay without a planned date (crit. 36а)', () => {
    const s = returnSettlement({ returnedOn: '2026-09-18', expectedReturnOn: null, periods: [week(1, '2026-09-11', '2026-09-17', 15000), week(2, '2026-09-18', '2026-09-24')], keyMissing: false });
    expect(s).toMatchObject({ claimsTetri: 15000, late: null, choice: null });
  });

  it('offers the week or the days of delay, and takes the smaller (crit. 36б)', () => {
    const s = returnSettlement({ returnedOn: '2026-09-18', expectedReturnOn: '2026-09-16', periods: [week(1, '2026-09-11', '2026-09-17', 15000), week(2, '2026-09-18', '2026-09-24')], keyMissing: false });
    expect(s.late).toMatchObject({ days: 2, amountTetri: 6000, weekTetri: 15000, startsOn: '2026-09-18', endsOn: '2026-09-24' });
    expect(s.choice).toBe('late');
    expect(s.claimsTetri).toBe(6000);
    const week2 = returnSettlement({ returnedOn: '2026-09-18', expectedReturnOn: '2026-09-16', periods: [week(1, '2026-09-11', '2026-09-17', 15000), week(2, '2026-09-18', '2026-09-24')], keyMissing: false, lateChoice: 'week' });
    expect(week2.claimsTetri).toBe(15000);
  });

  it('adds 250 for a key not brought back (contract §6, crit. 20)', () => {
    const s = returnSettlement({ returnedOn: '2026-09-17', expectedReturnOn: null, periods: [week(1, '2026-09-11', '2026-09-17', 15000)], keyMissing: true });
    expect(s).toMatchObject({ keyTetri: 25000, claimsTetri: 25000 });
  });
});

describe('a moment as Tbilisi reads it (QA-W3-03)', () => {
  it('is UTC+4, whatever the machine’s clock', () => {
    expect(localDateTime('2026-09-18T17:39:00Z')).toEqual({ date: '18.09.2026', time: '21:39' });
    expect(localDateTime('2026-09-18T21:30:00Z')).toEqual({ date: '19.09.2026', time: '01:30' });
  });
});
