import { describe, expect, it } from 'vitest';
import { acquiringNet, customerBalance, spreadPayment } from '../src/index.js';

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

describe('customer balance (PAY-06)', () => {
  it('separates what is owed from what was paid ahead', () => {
    const owing = customerBalance({
      periods: [{ amountTetri: 15000, paidTetri: 15000 }, { amountTetri: 15000, paidTetri: 0 }],
      deposits: [{ amountTetri: 18000, paidTetri: 18000, held: true }],
      paidTetri: 33000,
    });
    expect(owing).toEqual({
      invoicedTetri: 48000,
      paidTetri: 33000,
      outstandingTetri: 15000,
      creditTetri: 0,
      depositHeldTetri: 18000,
    });

    const ahead = customerBalance({
      periods: [{ amountTetri: 15000, paidTetri: 15000 }],
      deposits: [{ amountTetri: 18000, paidTetri: 18000, held: true }],
      paidTetri: 40000,
    });
    expect(ahead.outstandingTetri).toBe(0);
    expect(ahead.creditTetri).toBe(7000);
  });

  it('stops counting a deposit as held once the rental is closed', () => {
    const b = customerBalance({
      periods: [],
      deposits: [{ amountTetri: 18000, paidTetri: 18000, held: false }],
      paidTetri: 18000,
    });
    expect(b.depositHeldTetri).toBe(0);
  });
});
