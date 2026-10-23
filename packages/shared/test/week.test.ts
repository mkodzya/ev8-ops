// The week of the book (wave 6 §3.1, criteria 1а, 1б, 3).
import { describe, expect, it } from 'vitest';
import { vehicleOn } from '../src/utilisation.js';
import { PAYMENT_FILTERS, incomeRows, monthOf, paymentInRow, paymentsQuery, previousWeek, weekIncome, weekOf, type WeekPayment } from '../src/week.js';

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

  it('leaves out rent closed by a mechanic’s work: no money came in at all (ADR-0043)', () => {
    const offset = pay({ occurredOn: '2026-09-16', grossTetri: 150_00, channel: 'offset', allocations: [{ target: 'period', amountTetri: 150_00 }] });
    const m = weekIncome([offset, pay({ occurredOn: '2026-09-16', grossTetri: 150_00 })], week);
    expect(m.totalTetri).toBe(150_00);
    expect(m.rentTetri).toBe(150_00);
    expect(incomeRows(m)).toBe(m.totalTetri);
    expect(paymentInRow(offset, 'rent')).toBe(0);
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

describe('a figure of the week leads to the rows it is made of (QA-W6-01)', () => {
  const handOver = {
    occurredOn: '2026-09-22' as const,
    direction: 'in' as const,
    channel: 'cash' as const,
    kind: 'rent' as const,
    grossTetri: 33000,
    feeTetri: 0,
    allocations: [
      { target: 'period' as const, amountTetri: 15000 },
      { target: 'deposit' as const, amountTetri: 18000 },
    ],
  };
  const ahead = {
    occurredOn: '2026-09-23' as const,
    direction: 'in' as const,
    channel: 'cash' as const,
    kind: 'rent' as const,
    grossTetri: 60000,
    feeTetri: 0,
    allocations: [],
  };

  it('splits one payment between the rows it belongs to', () => {
    // The hand-over is rent and a deposit at once; a list filtered by the
    // kind of payment would put all 330 ₾ under rent and disagree with the
    // week by the 180 ₾ of deposit inside it.
    expect(paymentInRow(handOver, 'rent')).toBe(15000);
    expect(paymentInRow(handOver, 'deposits')).toBe(18000);
    expect(paymentInRow(handOver, 'sale')).toBe(0);
    expect(paymentInRow(handOver, 'service')).toBe(0);
  });

  it('gives money paid ahead to the row its payment was for', () => {
    expect(paymentInRow(ahead, 'rent')).toBe(60000);
    expect(paymentInRow(ahead, 'deposits')).toBe(0);
  });

  it('adds up, row by row, to exactly what the week shows', () => {
    const period = { from: '2026-09-21' as const, to: '2026-09-27' as const };
    const income = weekIncome([handOver, ahead], period);
    const payments = [handOver, ahead];
    // This is the property the screen relies on: the figure on the week and
    // the total of the list behind it are the same arithmetic.
    expect(payments.reduce((n, p) => n + paymentInRow(p, 'rent'), 0)).toBe(income.rentTetri);
    expect(payments.reduce((n, p) => n + paymentInRow(p, 'deposits'), 0)).toBe(income.depositsInTetri);
    expect(payments.reduce((n, p) => n + paymentInRow(p, 'sale'), 0)).toBe(income.saleTetri);
    expect(payments.reduce((n, p) => n + paymentInRow(p, 'service'), 0)).toBe(income.serviceTetri);
  });
});

describe('goods sold over the counter (issue #11, ADR-0045)', () => {
  it('puts a charger paid by card on a row of its own, the acquirer\'s fee apart, and the rows still add up', () => {
    const card = pay({ occurredOn: '2026-10-08', grossTetri: 100_00, feeTetri: 1_50, channel: 'acquiring', kind: 'goods' });
    const m = weekIncome([card], { from: '2026-10-05', to: '2026-10-11' });
    expect(m).toMatchObject({ goodsTetri: 100_00, acquiringFeeTetri: 1_50, totalTetri: 100_00, rentTetri: 0 });
    expect(incomeRows(m)).toBe(m.totalTetri);
    expect(paymentInRow(card, 'goods')).toBe(100_00);
  });

  it('moves a cancelled sale\'s money to rent once it became the customer\'s credit', () => {
    const credit = pay({ occurredOn: '2026-10-08', grossTetri: 35_00, kind: 'on_account' });
    const m = weekIncome([credit], { from: '2026-10-05', to: '2026-10-11' });
    expect(m).toMatchObject({ goodsTetri: 0, rentTetri: 35_00 });
    expect(incomeRows(m)).toBe(m.totalTetri);
  });
});

describe('the filters a screen sends when it asks for payments (QA-W6-05)', () => {
  it('carries the row a figure of the week asked about', () => {
    const asked: Record<string, string> = { from: '2026-09-21', to: '2026-09-27', row: 'rent' };
    const q = new URLSearchParams(paymentsQuery((k) => asked[k]));
    // The whole bug was this one parameter going missing between the link
    // and the request: the server could answer, the link did ask, and the
    // screen in the middle dropped it.
    expect(q.get('row')).toBe('rent');
    expect(q.get('from')).toBe('2026-09-21');
    expect(q.get('to')).toBe('2026-09-27');
  });

  it('sends nothing it was not given, and knows every filter the list has', () => {
    expect(paymentsQuery(() => '')).toBe('');
    // A filter added to the screen and forgotten here would travel nowhere.
    for (const key of ['from', 'to', 'channel', 'direction', 'kind', 'row', 'by', 'customerId', 'rentalId', 'saleId', 'goodsSaleId']) {
      expect(PAYMENT_FILTERS).toContain(key);
    }
  });
});

describe('the month a day falls in (wave 6 §3.2 — the utilisation screen)', () => {
  it('runs from the first to the last day, February and December included', () => {
    expect(monthOf('2026-09-21')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthOf('2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthOf('2028-02-14')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthOf('2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});
