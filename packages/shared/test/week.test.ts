// The week of the book (wave 6 §3.1, criteria 1а, 1б, 3).
import { describe, expect, it } from 'vitest';
import { vehicleOn } from '../src/utilisation.js';
import { incomeRows, previousWeek, weekIncome, weekOf, type WeekPayment } from '../src/week.js';

const pay = (p: Partial<WeekPayment> & { occurredOn: string; grossTetri: number }): WeekPayment => ({
  direction: 'in',
  channel: 'cash',
  kind: 'rent',
  feeTetri: 0,
  allocations: [],
  ...p,
});

const week = { from: '2026-09-14', to: '2026-09-20' };

describe('a week is Monday to Sunday', () => {
  it('holds whichever day of it is asked about', () => {
    for (const day of ['2026-09-14', '2026-09-17', '2026-09-20']) {
      expect(weekOf(day)).toEqual(week);
    }
  });

  it('starts on Monday for a Sunday too — the day that would fall to the next week if the week began on Sunday', () => {
    expect(weekOf('2026-09-13')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  /**
   * Crit. 3. The previous week is *its* seven days: asked on Thursday the
   * 17th, it is the 7th–13th, and not "the seven days up to last Thursday",
   * which would be the 10th–16th and would slide every day.
   */
  it('gives the previous week its own dates rather than seven days back (crit. 3)', () => {
    expect(previousWeek(weekOf('2026-09-17'))).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });
});

describe('what came in over a week', () => {
  /**
   * Crit. 1б. The hand-over: 330 ₾ in one payment, 150 of it the week and 180
   * the deposit. The breakdown splits it, the total does not — and the two
   * agree.
   */
  it('splits a hand-over into rent and deposit, and the rows still add up to the total (crit. 1б)', () => {
    const m = weekIncome(
      [pay({ occurredOn: '2026-09-15', grossTetri: 330_00, allocations: [{ target: 'period', amountTetri: 150_00 }, { target: 'deposit', amountTetri: 180_00 }] })],
      week,
    );
    expect(m.rentTetri).toBe(150_00);
    expect(m.depositsInTetri).toBe(180_00);
    expect(m.totalTetri).toBe(330_00);
    expect(incomeRows(m)).toBe(m.totalTetri);
  });

  /**
   * Crit. 1а. 600 ₾ handed over on the Monday covers four weeks and nothing
   * has taken it yet; it is rent, on the day it was paid, and the three weeks
   * after it show nothing for it.
   */
  it('puts money paid in advance into the week of the payment (crit. 1а)', () => {
    const payments = [pay({ occurredOn: '2026-09-14', grossTetri: 600_00 })];
    const m = weekIncome(payments, week);
    expect(m.rentTetri).toBe(600_00);
    expect(incomeRows(m)).toBe(m.totalTetri);
    for (const later of [weekOf('2026-09-21'), weekOf('2026-09-28'), weekOf('2026-10-05')]) {
      expect(weekIncome(payments, later).rentTetri).toBe(0);
    }
  });

  /**
   * The rule the designer settled on 22.09.2026 after the tester counted the
   * stand both pure ways: allocations where they exist, the payment's kind
   * for the rest. Neither alone gives the book its three rows.
   */
  it('names a row by the allocations, and the unplaced remainder by what the payment was for', () => {
    const m = weekIncome(
      [
        // A hand-over plus four weeks in advance, in one payment.
        pay({ occurredOn: '2026-09-15', grossTetri: 930_00, allocations: [{ target: 'period', amountTetri: 150_00 }, { target: 'deposit', amountTetri: 180_00 }] }),
        pay({ occurredOn: '2026-09-16', grossTetri: 300_00, kind: 'sale', allocations: [{ target: 'instalment', amountTetri: 300_00 }] }),
        // A repair the renter pays for, and what the return charged beyond the weeks.
        pay({ occurredOn: '2026-09-17', grossTetri: 120_00, kind: 'service' }),
        pay({ occurredOn: '2026-09-17', grossTetri: 50_00, allocations: [{ target: 'charge', amountTetri: 50_00 }] }),
      ],
      week,
    );
    expect(m).toMatchObject({ rentTetri: 750_00, depositsInTetri: 180_00, saleTetri: 300_00, serviceTetri: 170_00 });
    expect(m.totalTetri).toBe(1400_00);
    expect(incomeRows(m)).toBe(m.totalTetri);
  });

  it('counts a card at what the customer paid and shows the acquirer’s cut apart', () => {
    const m = weekIncome([pay({ occurredOn: '2026-09-15', grossTetri: 320_00, feeTetri: 4_80, channel: 'acquiring' })], week);
    expect(m.rentTetri).toBe(320_00);
    expect(m.totalTetri).toBe(320_00);
    expect(m.acquiringFeeTetri).toBe(4_80);
  });

  it('puts money handed back on its own row and never into the takings', () => {
    const m = weekIncome([pay({ occurredOn: '2026-09-16', grossTetri: 180_00, kind: 'deposit_payout', direction: 'out' })], week);
    expect(m.depositsOutTetri).toBe(180_00);
    expect(m.totalTetri).toBe(0);
  });

  it('leaves out money kept from a deposit: it came through the door once, as the deposit', () => {
    const m = weekIncome([pay({ occurredOn: '2026-09-16', grossTetri: 130_00, kind: 'service', channel: 'deposit' })], week);
    expect(m.totalTetri).toBe(0);
    expect(incomeRows(m)).toBe(0);
  });

  it('ignores a payment outside the period on either side', () => {
    const m = weekIncome(
      [pay({ occurredOn: '2026-09-13', grossTetri: 150_00 }), pay({ occurredOn: '2026-09-21', grossTetri: 150_00 })],
      week,
    );
    expect(m.totalTetri).toBe(0);
  });

  /**
   * The check the total exists for. A kind of money the breakdown does not
   * know lands in the total and in no row, and the two stop agreeing — which
   * is exactly the alarm the designer asked for.
   */
  it('lets the rows disagree with the total when a kind of money is unaccounted for', () => {
    const m = weekIncome([pay({ occurredOn: '2026-09-16', grossTetri: 90_00, kind: 'buyback' })], week);
    expect(m.totalTetri).toBe(90_00);
    expect(incomeRows(m)).toBe(0);
  });
});

describe('where a moped stood on a given day', () => {
  it('answers from the events and says since when', () => {
    const v = {
      id: 'a',
      initialPool: 'rent' as const,
      events: [
        { occurredOn: '2026-08-01', toState: 'available' as const, toPool: 'rent' as const },
        { occurredOn: '2026-09-10', toState: 'service' as const },
      ],
    };
    expect(vehicleOn(v, '2026-09-20')).toEqual({ state: 'service', pool: 'rent', since: '2026-09-10' });
    expect(vehicleOn(v, '2026-09-09')).toEqual({ state: 'available', pool: 'rent', since: '2026-08-01' });
    // Before its first event it was not ours: not free, not anything.
    expect(vehicleOn(v, '2026-07-31')).toBeNull();
  });
});
