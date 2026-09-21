import { describe, expect, it } from 'vitest';
import {
  acquiringFee,
  acquiringGross,
  acquiringNet,
  formatGel,
  netFromGross,
  parseGel,
  tetriFromGel,
  vatOnTop,
} from '../src/index.js';

describe('tetri', () => {
  it('rounds a GEL amount to whole tetri', () => {
    expect(tetriFromGel(315.2)).toBe(31520);
    expect(tetriFromGel(0.1 + 0.2)).toBe(30);
  });

  it('parses what people and bank files write', () => {
    expect(parseGel('315.20')).toBe(31520);
    expect(parseGel('315,20')).toBe(31520);
    expect(parseGel('1 234.56 ₾')).toBe(123456);
    expect(parseGel('abc')).toBeNull();
    expect(parseGel('1.234')).toBeNull();
  });

  it('formats one way for every language', () => {
    expect(formatGel(123456)).toBe('1\u00a0234.56\u00a0₾'); // no-break space: a sum never wraps
    expect(formatGel(-4200)).toBe('-42.00\u00a0₾');
    expect(formatGel(1751100, { decimals: false })).toBe('17\u00a0511\u00a0₾');
    expect(formatGel(1751150, { decimals: false })).toBe('17\u00a0511.50\u00a0₾');
    expect(formatGel(null)).toBe('—');
  });
});

describe('VAT 18 % on top', () => {
  it('site price 3 206 with VAT is 2 716.95 net (Odoo XL1200 - Sale)', () => {
    expect(netFromGross(320600)).toEqual({ net: 271695, vat: 48905, gross: 320600 });
  });

  it('weekly tariff 150 with VAT is 127.12 net and back', () => {
    expect(netFromGross(15000).net).toBe(12712);
    expect(vatOnTop(12712).gross).toBe(15000);
  });
});

describe('acquiring 1.5 %', () => {
  it('315.20 is 320 gross, 325.05 is 330 gross (CLAUDE.md)', () => {
    expect(acquiringNet(32000)).toBe(31520);
    expect(acquiringNet(33000)).toBe(32505);
    expect(acquiringGross(31520)).toBe(32000);
    expect(acquiringGross(32505)).toBe(33000);
  });

  it('the fee is the company’s, and a card payment of 320 leaves no 4.80 debt (PAY-04)', () => {
    expect(acquiringFee(32000)).toBe(480);
  });

  it('round-trips every whole-tetri gross in the tariff range', () => {
    // 1.5 % steps are finer than a tetri, so every net has a gross; the
    // matcher must still ask whether that gross is a tariff + deposit sum.
    for (let gross = 10000; gross <= 60000; gross += 5) expect(acquiringGross(acquiringNet(gross))).toBe(gross);
  });
});
