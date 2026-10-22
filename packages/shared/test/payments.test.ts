import { describe, expect, it } from 'vitest';
import { acquiringNet, instalmentSchedule, rentCreditTetri, spreadOverOwed, spreadPayment } from '../src/index.js';

const period = (seq: number, amountTetri: number, paidTetri = 0) => ({ id: `p${seq}`, seq, amountTetri, paidTetri });

describe('spreading a payment (PAY-02)', () => {
  it('takes the deposit first, then periods from the oldest', () => {
    const { allocations, leftoverTetri } = spreadPayment(32000, [period(1, 14000), period(2, 14000)], {
      id: 'd',
      amountTetri: 18000,
      paidTetri: 0,
    });
    expect(allocations).toEqual([
      { target: 'deposit', id: 'd', amountTetri: 18000 },
      { target: 'period', id: 'p1', amountTetri: 14000 },
    ]);
    expect(leftoverTetri).toBe(0);
  });

  it('the real first payment of a new renter: 320 by card covers deposit 180 and week 140', () => {
    // The bank credits 315.20; the customer paid 320 and that is what closes
    // the debt. The 4.80 is the company's expense (PAY-04).
    expect(acquiringNet(32000)).toBe(31520);
    const { allocations, leftoverTetri } = spreadPayment(32000, [period(1, 14000)], { id: 'd', amountTetri: 18000, paidTetri: 0 });
    expect(allocations.reduce((n, a) => n + a.amountTetri, 0)).toBe(32000);
    expect(leftoverTetri).toBe(0);
  });

  it('pays a period only up to what is still owed on it', () => {
    const { allocations } = spreadPayment(20000, [period(1, 15000, 12000), period(2, 15000)], null);
    expect(allocations).toEqual([
      { target: 'period', id: 'p1', amountTetri: 3000 },
      { target: 'period', id: 'p2', amountTetri: 15000 },
    ]);
  });

  it('leaves what it cannot place as the customer’s credit (PAY-06)', () => {
    const { allocations, leftoverTetri } = spreadPayment(20000, [period(1, 15000)], null);
    expect(allocations).toEqual([{ target: 'period', id: 'p1', amountTetri: 15000 }]);
    expect(leftoverTetri).toBe(5000);
  });

  it('skips a deposit that is already in and periods that are settled', () => {
    const { allocations } = spreadPayment(15000, [period(1, 15000, 15000), period(2, 15000)], {
      id: 'd',
      amountTetri: 18000,
      paidTetri: 18000,
    });
    expect(allocations).toEqual([{ target: 'period', id: 'p2', amountTetri: 15000 }]);
  });

  it('places nothing when there is nothing open', () => {
    expect(spreadPayment(10000, [], null)).toEqual({ allocations: [], leftoverTetri: 10000 });
  });
});

describe('a sale’s schedule (SAL-02)', () => {
  it('builds the real one: 900 down and nine of 300', () => {
    // A sale of 2025, as the company wrote it: 3 600 in all.
    const plan = instalmentSchedule({ soldOn: '2025-05-27', priceTetri: 360000, downPaymentTetri: 90000, months: 9 });
    expect(plan).toHaveLength(10);
    expect(plan[0]).toEqual({ seq: 1, dueOn: '2025-05-27', amountTetri: 90000 });
    expect(plan.slice(1).every((p) => p.amountTetri === 30000)).toBe(true);
    expect(plan[1].dueOn).toBe('2025-06-27');
    expect(plan[9].dueOn).toBe('2026-02-27');
    expect(plan.reduce((n, p) => n + p.amountTetri, 0)).toBe(360000);
  });

  it('paid in one go is one instalment, due the day of the sale', () => {
    const plan = instalmentSchedule({ soldOn: '2026-05-19', priceTetri: 285650, downPaymentTetri: 0, months: 0 });
    expect(plan).toEqual([{ seq: 1, dueOn: '2026-05-19', amountTetri: 285650 }]);
  });

  it('puts the rounding on the first instalment, so every later one is the round figure', () => {
    const plan = instalmentSchedule({ soldOn: '2026-01-10', priceTetri: 100000, downPaymentTetri: 0, months: 3 });
    expect(plan.map((p) => p.amountTetri)).toEqual([33334, 33333, 33333]);
    expect(plan.reduce((n, p) => n + p.amountTetri, 0)).toBe(100000);
  });

  it('a month too short takes its last day', () => {
    const plan = instalmentSchedule({ soldOn: '2026-01-31', priceTetri: 60000, downPaymentTetri: 0, months: 2 });
    expect(plan.map((p) => p.dueOn)).toEqual(['2026-02-28', '2026-03-31']);
  });

  it('refuses a down payment larger than the price', () => {
    expect(() => instalmentSchedule({ soldOn: '2026-01-01', priceTetri: 1000, downPaymentTetri: 2000, months: 3 })).toThrow();
  });
});

describe('spreading over instalments', () => {
  const inst = (seq: number, amountTetri: number, paidTetri = 0) => ({ id: `i${seq}`, seq, amountTetri, paidTetri });

  it('pays the oldest first and leaves the rest', () => {
    const { allocations, leftoverTetri } = spreadOverOwed(50000, [inst(1, 30000), inst(2, 30000)], 'instalment');
    expect(allocations).toEqual([
      { target: 'instalment', id: 'i1', amountTetri: 30000 },
      { target: 'instalment', id: 'i2', amountTetri: 20000 },
    ]);
    expect(leftoverTetri).toBe(0);
  });

  it('skips what is settled', () => {
    const { allocations } = spreadOverOwed(10000, [inst(1, 30000, 30000), inst(2, 30000)], 'instalment');
    expect(allocations).toEqual([{ target: 'instalment', id: 'i2', amountTetri: 10000 }]);
  });
});

describe('a payment’s rent credit (PAY-06; QA after issue #9)', () => {
  const pay = (over: Partial<Parameters<typeof rentCreditTetri>[0]> = {}) => rentCreditTetri({ direction: 'in', kind: 'rent', voided: false, grossTetri: 17000, allocatedTetri: 15000, ...over });

  it('is what came in for rent and nothing has taken yet', () => {
    expect(pay()).toBe(2000);
    expect(pay({ kind: 'on_account', allocatedTetri: 0 })).toBe(17000);
  });

  it('is nothing once all of it is placed', () => {
    expect(pay({ allocatedTetri: 17000 })).toBe(0);
  });

  it('is nothing for a sale’s, a repair’s, an outgoing or an annulled payment', () => {
    expect(pay({ kind: 'sale' })).toBe(0);
    expect(pay({ kind: 'service' })).toBe(0);
    expect(pay({ direction: 'out', kind: 'deposit_payout' })).toBe(0);
    expect(pay({ voided: true, allocatedTetri: 0 })).toBe(0);
  });
});
