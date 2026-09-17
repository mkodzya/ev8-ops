import { describe, expect, it } from 'vitest';
import { spellingMatches, numberMatches, phoneMatches, readQuery, vinMatches } from '../src/index.js';

const q = (s: string) => readQuery(s)!;

describe('what the header search understands (wave 1 §3.5)', () => {
  it('needs two characters', () => {
    expect(readQuery(' a ')).toBeNull();
    expect(readQuery('ab')).not.toBeNull();
  });

  it('finds a phone by its last digits however it was written', () => {
    expect(phoneMatches(q('3456'), '+995 555 12 34 56')).toBe(true);
    expect(phoneMatches(q('+995 555 123'), '555-12-34-56')).toBe(true);
    expect(phoneMatches(q('12'), '+995 555 12 34 56')).toBe(false);
  });

  it('finds a name in any of its spellings, Georgian included', () => {
    const spellings = ['Dato Gvelesiani', 'დათო გველესიანი', null];
    expect(spellingMatches(q('გველ'), spellings)).toBe(true);
    expect(spellingMatches(q('GVEL'), spellings)).toBe(true);
    expect(spellingMatches(q('kardu'), spellings)).toBe(false);
  });

  it('finds a moped by the end of its VIN', () => {
    expect(vinMatches(q('2083'), 'HH8LWFCA7N0002083')).toBe(true);
    expect(vinMatches(q('83'), 'HH8LWFCA7N0002083')).toBe(true);
    expect(vinMatches(q('2082'), 'HH8LWFCA7N0002083')).toBe(false);
  });

  it('finds a record by its number with or without prefix and zeros', () => {
    expect(numberMatches(q('R-00441'), 'R-00441')).toBe(true);
    expect(numberMatches(q('441'), 'R-00441')).toBe(true);
    expect(numberMatches(q('r-441'), 'R-00441')).toBe(true);
    expect(numberMatches(q('4412'), 'R-00441')).toBe(false);
  });

  it('reads an amount', () => {
    expect(q('150').amountTetri).toBe(15000);
    expect(q('150,5').amountTetri).toBe(15050);
    expect(q('Dato').amountTetri).toBeNull();
  });
});
