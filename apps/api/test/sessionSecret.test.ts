// No database needed: the rule is pure, which is why it was written that way.
import { describe, expect, it } from 'vitest';
import { DEV_SECRET, MIN_SECRET_LENGTH, checkSessionSecret } from '../src/lib/env.js';

const strong = 'x'.repeat(MIN_SECRET_LENGTH);

describe('the session secret is not allowed a safe-looking default', () => {
  it('stops the boot on a secret that is missing, published or too short', () => {
    for (const weak of ['', DEV_SECRET, 'short', 'x'.repeat(MIN_SECRET_LENGTH - 1)]) {
      expect(() => checkSessionSecret(weak, false), JSON.stringify(weak)).toThrow(/SESSION_SECRET/);
    }
  });

  it('says how to make one', () => {
    expect(() => checkSessionSecret('', false)).toThrow(/openssl rand/);
  });

  it('accepts a real one, and the development one only when asked out loud', () => {
    expect(checkSessionSecret(strong, false)).toBe(strong);
    expect(checkSessionSecret('', true)).toBe(DEV_SECRET);
  });
});
