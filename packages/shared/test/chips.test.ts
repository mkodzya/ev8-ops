// The chip a list opens on (GitHub issue #17, item 2): «Все» last, the first
// chip of the row when the address names none, a choice in the address as it is.
import { describe, expect, it } from 'vitest';
import { ALL_CHIP, chipOnOpen } from '../src/index.js';

const ROW = ['available', 'rented', 'service'] as const;

describe('the chip a list opens on', () => {
  it('opens on the first chip of the row when the address names none', () => {
    expect(chipOnOpen(null, ROW)).toBe('available');
    expect(chipOnOpen(undefined, ROW)).toBe('available');
    expect(chipOnOpen('', ROW)).toBe('available');
  });

  it('opens a choice in the address as it is', () => {
    expect(chipOnOpen('rented', ROW)).toBe('rented');
    expect(chipOnOpen('service', ROW)).toBe('service');
  });

  it('«Все» is a choice of its own, written as `all`', () => {
    expect(ALL_CHIP).toBe('all');
    expect(chipOnOpen('all', ROW)).toBeNull();
  });

  it('a chip the row does not hold opens the first one, not everything', () => {
    expect(chipOnOpen('sold', ROW)).toBe('available');
  });

  it('a row without chips has nothing to choose', () => {
    expect(chipOnOpen(null, [])).toBeNull();
    expect(chipOnOpen('rented', [])).toBeNull();
  });
});
