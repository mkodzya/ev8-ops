import { describe, expect, it } from 'vitest';
import { effectiveRate, landedCosts } from '../src/index.js';

// The company's own shipment, as recorded on 13.08.2026: the Flybrother
// contract ZJQXGLJY0012024, 39 mopeds, and a share of the logistics and
// customs that both shipments were cleared under.
const FLYBROTHER = [
  { id: 'eagle', qty: 5, unitPriceMinor: 448140 }, // 4 481.4 CNY
  { id: 'wolf8', qty: 6, unitPriceMinor: 465340 },
  { id: 'f150', qty: 5, unitPriceMinor: 448140 },
  { id: 'b11', qty: 6, unitPriceMinor: 508360 },
  { id: 'xl1200', qty: 12, unitPriceMinor: 342550 },
  { id: '17c', qty: 5, unitPriceMinor: 342550 },
];

describe('what a moped cost to land', () => {
  it('shares the money that actually left the bank, so the parts add up to it exactly', () => {
    const paidTetri = 6_839_419; // 68 394.19 GEL for these goods
    const extrasTetri = 39 * 23834; // 238.34 GEL a unit, VAT already taken out
    const costs = landedCosts({ lines: FLYBROTHER, paidTetri, extrasTetri });

    expect(costs.reduce((n, c) => n + c.fobTetri, 0)).toBe(paidTetri);
    expect(costs.reduce((n, c) => n + c.extrasTetri, 0)).toBe(extrasTetri);
    expect(costs.reduce((n, c) => n + c.totalTetri, 0)).toBe(paidTetri + extrasTetri);
  });

  it('reproduces the figure the company calculated for the XL1200 (PUR-02)', () => {
    // The acceptance for PUR-02: 1 689.29 GEL, worked out by hand on
    // 13.08.2026 as 1 450.95 of goods plus 238.34 of logistics and customs.
    const costs = landedCosts({ lines: FLYBROTHER, paidTetri: 6_839_419, extrasTetri: 39 * 23834 });
    const xl = costs.find((c) => c.lineId === 'xl1200')!;
    expect(xl.unitCostTetri).toBe(168929);
    expect(xl.extrasTetri / 12).toBe(23834);
  });

  it('splits logistics evenly over units, not over money', () => {
    const costs = landedCosts({
      lines: [
        { id: 'cheap', qty: 2, unitPriceMinor: 100 },
        { id: 'dear', qty: 2, unitPriceMinor: 900 },
      ],
      paidTetri: 100000,
      extrasTetri: 40000,
    });
    expect(costs.map((c) => c.extrasTetri)).toEqual([20000, 20000]);
    // The goods themselves still go by value.
    expect(costs.map((c) => c.fobTetri)).toEqual([10000, 90000]);
  });

  it('gives the odd tetri to whoever lost most to rounding', () => {
    const costs = landedCosts({
      lines: [
        { id: 'a', qty: 1, unitPriceMinor: 100 },
        { id: 'b', qty: 1, unitPriceMinor: 100 },
        { id: 'c', qty: 1, unitPriceMinor: 100 },
      ],
      paidTetri: 100,
      extrasTetri: 0,
    });
    expect(costs.map((c) => c.fobTetri).sort((x, y) => y - x)).toEqual([34, 33, 33]);
    expect(costs.reduce((n, c) => n + c.fobTetri, 0)).toBe(100);
  });

  it('costs nothing before anything is paid', () => {
    const costs = landedCosts({ lines: FLYBROTHER, paidTetri: 0, extrasTetri: 0 });
    expect(costs.every((c) => c.totalTetri === 0)).toBe(true);
  });
});

describe('the rate a shipment really went through at', () => {
  it('is what was paid divided by what the invoice said', () => {
    // 68 394.19 GEL for 161 469.50 CNY of mopeds. The company worked to
    // 0.42357 GEL per CNY from the same two figures.
    const lineTotal = FLYBROTHER.reduce((n, l) => n + l.qty * l.unitPriceMinor, 0);
    expect(lineTotal).toBe(16_146_950);
    expect(effectiveRate(6_839_419, lineTotal)).toBeCloseTo(0.42357, 5);
    expect(effectiveRate(0, lineTotal)).toBeNull();
    expect(effectiveRate(100, 0)).toBeNull();
  });
});
