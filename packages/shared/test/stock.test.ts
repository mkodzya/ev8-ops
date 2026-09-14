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

describe('when to reorder', () => {
  it('says how many short of the level somebody set', () => {
    expect(shortfall(2, 5)).toBe(3);
    expect(shortfall(9, 5)).toBe(0);
    expect(shortfall(-2, 5)).toBe(7);
    // Nobody set a level, so nothing is short.
    expect(shortfall(0, 0)).toBe(0);
  });
});
