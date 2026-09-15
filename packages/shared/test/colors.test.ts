// One colour, however it was written down.
import { describe, expect, it } from 'vitest';
import { colorOf } from '../src/colors.js';

describe('the colour a moped is', () => {
  it('reads the same paint through both spellings the data holds', () => {
    expect(colorOf('შავი')).toBe('black');
    expect(colorOf('Black')).toBe('black');
    expect(colorOf('წითელი')).toBe('red');
    expect(colorOf('  RED  ')).toBe('red');
    expect(colorOf('ნაცრისფერი')).toBe('grey');
    expect(colorOf('gray')).toBe('grey');
    expect(colorOf('იისფერი')).toBe('purple');
  });

  it('says nothing about a word nobody taught it, and nothing about nothing', () => {
    // The screen falls back to the word as typed; a guess would be worse.
    expect(colorOf('ლურჯი')).toBeNull();
    expect(colorOf('matte olive')).toBeNull();
    expect(colorOf('')).toBeNull();
    expect(colorOf(null)).toBeNull();
  });
});
