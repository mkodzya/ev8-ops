// What a repair line costs, and how a tracker is read (stage 4 of
// docs/spec/mechanic-in-erp-plan.md; ADR-0036). The IMEIs are invented; the
// valid one is made valid by its check digit, not taken from a tracker.
import { describe, expect, it } from 'vitest';
import { jobTotalTetri, partLineState, partLineTetri, readImei, readSimPhone } from '../src/index.js';

describe('what a repair line adds to the repair', () => {
  it('off the shelf or off a donor: quantity at price', () => {
    expect(partLineTetri({ kind: 'stock', qty: 2, unitPriceTetri: 1200 })).toBe(2400);
    expect(partLineTetri({ qty: 2, unitPriceTetri: 1200 })).toBe(2400);
    expect(partLineTetri({ kind: 'donor', qty: 1, unitPriceTetri: 0 })).toBe(0);
  });

  it('bought: the receipt to the tetri, even when it does not divide', () => {
    expect(partLineTetri({ kind: 'bought', qty: 3, unitPriceTetri: 333, paidTetri: 1000 })).toBe(1000);
  });

  it('taken off onto the shelf: nothing; bought and refused: nothing', () => {
    expect(partLineTetri({ kind: 'removed', qty: 2, unitPriceTetri: 0 })).toBe(0);
    expect(partLineTetri({ kind: 'bought', qty: 1, unitPriceTetri: 1800, paidTetri: 1800, rejectedAt: new Date() })).toBe(0);
  });

  it('the repair is its lines and its work', () => {
    const parts = [
      { kind: 'stock', qty: 2, unitPriceTetri: 1200 },
      { kind: 'bought', qty: 1, unitPriceTetri: 1800, paidTetri: 1800 },
      { kind: 'removed', qty: 2, unitPriceTetri: 0 },
    ];
    expect(jobTotalTetri({ parts, labourTetri: 5000 })).toBe(2400 + 1800 + 5000);
  });

  it('only a bought line waits for a decision', () => {
    expect(partLineState({ kind: 'bought', approvedAt: null, rejectedAt: null })).toBe('waiting');
    expect(partLineState({ kind: 'bought', approvedAt: new Date(), rejectedAt: null })).toBe('approved');
    expect(partLineState({ kind: 'stock', approvedAt: null, rejectedAt: null })).toBeNull();
  });
});

describe('a tracker read off its sticker', () => {
  it('takes fifteen digits with a good check digit, spaces and dashes or not', () => {
    expect(readImei('352098114374828')).toBe('352098114374828');
    expect(readImei('352 098 114 374 828')).toBe('352098114374828');
    expect(readImei('35-209811-437482-8')).toBe('352098114374828');
  });

  it('refuses a digit typed wrong, a digit short, and letters', () => {
    expect(readImei('352098114374827')).toBeNull();
    expect(readImei('35209811437482')).toBeNull();
    expect(readImei('35209811437482A')).toBeNull();
    expect(readImei('')).toBeNull();
  });

  it('keeps a SIM number as digits, with its plus', () => {
    expect(readSimPhone('555 01 02 03')).toBe('555010203');
    expect(readSimPhone('+995 555 01-02-03')).toBe('+995555010203');
    expect(readSimPhone('12')).toBeNull();
    expect(readSimPhone('call me')).toBeNull();
  });
});
