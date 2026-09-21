// A repair's arithmetic (wave 5 §3.7, `service.md`): work by the hour, a
// part priced by who is paying, and what the deposit does not cover.
import { describe, expect, it } from 'vitest';
import { closeCharge, hoursFromMinutes, jobTotalTetri, labourTetri, minutesFromHours, partPriceTetri, paidSummary } from '../src/index.js';

describe('work on a repair', () => {
  it('is hours at fifty lari (crit. 24)', () => {
    expect(labourTetri(minutesFromHours(1.5))).toBe(7500);
    expect(labourTetri(minutesFromHours(0.5))).toBe(2500);
    expect(hoursFromMinutes(90)).toBe(1.5);
  });

  it('adds up parts and work', () => {
    expect(jobTotalTetri({ parts: [{ qty: 2, unitPriceTetri: 1250 }], labourTetri: 7500 })).toBe(10000);
  });
});

describe('what a part goes on the line at', () => {
  const part = { avgCostTetri: 1250, salePriceTetri: 3000 };

  it('is the cost for the company and the price for a customer (B8-04, crit. 22, 23)', () => {
    expect(partPriceTetri('company', part)).toBe(1250);
    expect(partPriceTetri('customer', part)).toBe(3000);
  });

  it('falls back rather than inventing a figure', () => {
    expect(partPriceTetri('customer', { avgCostTetri: 1250, salePriceTetri: null })).toBe(1250);
    expect(partPriceTetri('company', { avgCostTetri: null, salePriceTetri: 3000 })).toBe(3000);
    expect(partPriceTetri('company', { avgCostTetri: null, salePriceTetri: null })).toBeNull();
  });
});

describe('closing a repair charged to a customer', () => {
  it('keeps no more than the repair and no more than the deposit holds (crit. 25)', () => {
    expect(closeCharge({ totalTetri: 12000, withholdTetri: 0, depositFreeTetri: 18000 })).toEqual({ withheldTetri: 0, debtTetri: 12000 });
    expect(closeCharge({ totalTetri: 12000, withholdTetri: 5000, depositFreeTetri: 18000 })).toEqual({ withheldTetri: 5000, debtTetri: 7000 });
    expect(closeCharge({ totalTetri: 12000, withholdTetri: 20000, depositFreeTetri: 18000 })).toEqual({ withheldTetri: 12000, debtTetri: 0 });
    expect(closeCharge({ totalTetri: 12000, withholdTetri: 12000, depositFreeTetri: 3000 })).toEqual({ withheldTetri: 3000, debtTetri: 9000 });
  });
});

describe('what a shipment has been paid', () => {
  it('reads the rate off the payments themselves (crit. 11)', () => {
    const money = paidSummary({ payments: [{ paidTetri: 42357, paidMinor: 100000 }], invoiceMinor: 600000 });
    expect(money.rate).toBeCloseTo(0.42357, 5);
    expect(money.percent).toBe(17);
    expect(money.debtMinor).toBe(500000);
    expect(money.settled).toBe(false);
  });

  it('is settled once the currency of the invoice has gone out (crit. 19)', () => {
    const money = paidSummary({
      payments: [
        { paidTetri: 42357, paidMinor: 100000 },
        { paidTetri: 211503, paidMinor: 500000 },
      ],
      invoiceMinor: 600000,
    });
    expect(money.percent).toBe(100);
    expect(money.debtMinor).toBe(0);
    expect(money.settled).toBe(true);
  });

  it('reads a payment entered without its currency the way wave 4 read it', () => {
    // Every payment made before this wave carries GEL and nothing else; it
    // paid the invoice, and the rate is what those GEL work out to.
    const money = paidSummary({ payments: [{ paidTetri: 240000, paidMinor: 0 }], invoiceMinor: 60000 });
    expect(money.rate).toBe(4);
    expect(money.percent).toBe(100);
    expect(money.basisTetri).toBe(240000);
  });
});
