import { describe, expect, it } from 'vitest';
import { grossOf, type StatementLine } from '../src/index.js';

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  amountTetri: 32000,
  occurredOn: '2026-09-01',
  channel: 'transfer',
  ...over,
});

describe('what a statement line is worth (PAY-04)', () => {
  it('uses the gross the bank states for a card line, not what it credited', () => {
    // A real BOG line: credited 3152.00, "Tanxa:GEL 3200; sakomisio: GEL 48".
    expect(grossOf(line({ channel: 'acquiring', amountTetri: 315200, grossTetri: 320000 }))).toBe(320000);
  });

  it('recovers the gross when the bank states only the credit', () => {
    expect(grossOf(line({ channel: 'acquiring', amountTetri: 31520 }))).toBe(32000);
    expect(grossOf(line({ channel: 'acquiring', amountTetri: 32505 }))).toBe(33000);
  });

  it('a transfer is worth exactly what arrived', () => {
    expect(grossOf(line({ amountTetri: 14000 }))).toBe(14000);
  });
});
