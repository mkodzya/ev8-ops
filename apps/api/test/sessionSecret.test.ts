// No database needed: the rules are pure, which is why they were written that way.
import { describe, expect, it } from 'vitest';
import { DEV_SECRET, DEV_WORKER_TOKEN, MIN_SECRET_LENGTH, checkSessionSecret, checkWorkerToken } from '../src/lib/env.js';

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

// The worker token is not a login, so it looked like a lesser thing and carried
// a default for a while. It opens /api/jobs/roll-periods, which opens a rental
// week and spends a customer's credit on it — the same money the session
// secret protects, reached by a shorter road.
describe('the worker token is held to the same rule', () => {
  it('stops the boot on a token that is missing, published or too short', () => {
    for (const weak of ['', DEV_WORKER_TOKEN, 'short', 'x'.repeat(MIN_SECRET_LENGTH - 1)]) {
      expect(() => checkWorkerToken(weak, false), JSON.stringify(weak)).toThrow(/WORKER_TOKEN/);
    }
  });

  it('says what the token opens, so the message is worth reading', () => {
    expect(() => checkWorkerToken('', false)).toThrow(/rental weeks/);
  });

  it('accepts a real one, and the development one only when asked out loud', () => {
    expect(checkWorkerToken(strong, false)).toBe(strong);
    expect(checkWorkerToken('', true)).toBe(DEV_WORKER_TOKEN);
  });
});
