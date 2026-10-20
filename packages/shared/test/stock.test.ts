import { describe, expect, it } from 'vitest';
import { shortfall, stockState } from '../src/index.js';

const receipt = (qty: number, unitCostTetri: number, occurredOn: string) =>
  ({ kind: 'receipt' as const, qty, unitCostTetri, occurredOn });
const issue = (qty: number, occurredOn: string) => ({ kind: 'issue' as const, qty: -qty, occurredOn });

describe('what is on the shelf', () => {
  it('adds up what came in and what went out', () => {
    const s = stockState([receipt(10, 1200, '2026-03-01'), issue(3, '2026-03-05')]);
    expect(s.onHand).toBe(7);
    expect(s.valueTetri).toBe(8400);
    expect(s.avgCostTetri).toBe(1200);
  });

  it('two shipments at two prices become one price', () => {
    const s = stockState([receipt(10, 1000, '2026-03-01'), receipt(10, 1400, '2026-04-01')]);
    expect(s.onHand).toBe(20);
    expect(s.valueTetri).toBe(24000);
    expect(s.avgCostTetri).toBe(1200);
  });

  it('the last one out takes what is left, to the tetri', () => {
    // 3 at 10.00 and 4 at 7.77 — an average that does not divide.
    const s = stockState([receipt(3, 1000, '2026-03-01'), receipt(4, 777, '2026-03-02')]);
    expect(s.valueTetri).toBe(6108);
    const empty = stockState([receipt(3, 1000, '2026-03-01'), receipt(4, 777, '2026-03-02'), issue(7, '2026-03-03')]);
    expect(empty.onHand).toBe(0);
    expect(empty.valueTetri).toBe(0);
    expect(empty.avgCostTetri).toBeNull();
  });

  it('counts movements in date order, whatever order they were entered in', () => {
    const entered = [issue(3, '2026-03-05'), receipt(10, 1200, '2026-03-01')];
    expect(stockState(entered)).toEqual(stockState([...entered].reverse()));
  });

  it('a stock-take that finds more values them like the ones already there', () => {
    const s = stockState([receipt(10, 1200, '2026-03-01'), { kind: 'adjust', qty: 2, occurredOn: '2026-03-10' }]);
    expect(s.onHand).toBe(12);
    expect(s.avgCostTetri).toBe(1200);
    expect(s.valueTetri).toBe(14400);
  });

  it('a shelf in the red holds nothing and is worth nothing', () => {
    // A repair used a part the catalogue never received. The count says so
    // out loud rather than quietly rounding up to zero.
    const s = stockState([receipt(1, 1200, '2026-03-01'), issue(3, '2026-03-05')]);
    expect(s.onHand).toBe(-2);
    expect(s.valueTetri).toBe(0);
    expect(s.avgCostTetri).toBeNull();
  });

  it('an empty ledger is an empty shelf', () => {
    expect(stockState([])).toEqual({ onHand: 0, valueTetri: 0, avgCostTetri: null });
  });
});

// Stage 4 (ADR-0036): every kind of repair line, and what the shelf and its
// average are after it. Figures are invented: four pads at 20.00 ₾.
describe('the shelf after each kind of repair line (stage 4)', () => {
  const shelf = [receipt(4, 2000, '2026-10-01')];
  const at = (t: string) => `2026-10-20T${t}:00.000Z`;

  it('off the shelf: the count goes down, the average stays', () => {
    const s = stockState([...shelf, issue(2, '2026-10-20')]);
    expect(s).toEqual({ onHand: 2, valueTetri: 4000, avgCostTetri: 2000 });
  });

  it('bought by the mechanic: in at the receipt and out at the same, the shelf as it was', () => {
    const pair = [
      { kind: 'receipt' as const, qty: 1, unitCostTetri: 1800, occurredOn: '2026-10-20', at: at('09:00') },
      { kind: 'issue' as const, qty: -1, unitCostTetri: 1800, occurredOn: '2026-10-20', at: at('09:00') },
    ];
    expect(stockState([...shelf, ...pair])).toEqual({ onHand: 4, valueTetri: 8000, avgCostTetri: 2000 });
    // Written in the same instant, in before out — whatever order the database gives.
    expect(stockState([...pair].reverse().concat(shelf))).toEqual(stockState([...shelf, ...pair]));
  });

  it('off a donor: in at nought and out at nought, the shelf as it was', () => {
    const pair = [
      { kind: 'issue' as const, qty: -1, unitCostTetri: 0, occurredOn: '2026-10-20', at: at('10:00') },
      { kind: 'receipt' as const, qty: 1, unitCostTetri: 0, occurredOn: '2026-10-20', at: at('10:00') },
    ];
    expect(stockState([...shelf, ...pair])).toEqual({ onHand: 4, valueTetri: 8000, avgCostTetri: 2000 });
  });

  it('taken off onto the shelf: in at nought, and the average falls (Mika, 20.10.2026)', () => {
    const s = stockState([...shelf, { kind: 'receipt', qty: 2, unitCostTetri: 0, occurredOn: '2026-10-20' }]);
    expect(s).toEqual({ onHand: 6, valueTetri: 8000, avgCostTetri: 1333 });
  });

  it('nought named is not nothing known: a part found in a count comes in at the average', () => {
    const named = stockState([...shelf, { kind: 'receipt', qty: 1, unitCostTetri: 0, occurredOn: '2026-10-20' }]);
    const found = stockState([...shelf, { kind: 'adjust', qty: 1, unitCostTetri: null, occurredOn: '2026-10-20' }]);
    expect(named.avgCostTetri).toBe(1600);
    expect(found.avgCostTetri).toBe(2000);
  });

  it('a nought taken off the shelf again leaves the shelf where it was (a line written by mistake)', () => {
    const s = stockState([
      ...shelf,
      { kind: 'receipt', qty: 2, unitCostTetri: 0, occurredOn: '2026-10-20', at: at('11:00') },
      { kind: 'issue', qty: -2, unitCostTetri: 0, occurredOn: '2026-10-20', at: at('11:05') },
    ]);
    expect(s).toEqual({ onHand: 4, valueTetri: 8000, avgCostTetri: 2000 });
  });

  it('a day’s movements count in the order they were written, not the order they were read', () => {
    const day = [
      { kind: 'issue' as const, qty: -3, occurredOn: '2026-10-20', at: at('12:00') },
      { kind: 'receipt' as const, qty: 4, unitCostTetri: 1000, occurredOn: '2026-10-20', at: at('08:00') },
    ];
    // Received at eight, three out at noon: five left at the blend of 4 × 20.00 and 4 × 10.00.
    const s = stockState([...shelf, ...day]);
    expect(s).toEqual(stockState([...day].reverse().concat(shelf)));
    expect(s).toEqual({ onHand: 5, valueTetri: 7500, avgCostTetri: 1500 });
  });
});

describe('when to reorder', () => {
  it('says how many short of the level somebody set', () => {
    expect(shortfall(2, 5)).toBe(3);
    expect(shortfall(9, 5)).toBe(0);
    expect(shortfall(-2, 5)).toBe(7);
    // Nobody set a level, so nothing is short.
    expect(shortfall(0, 0)).toBe(0);
  });
});
