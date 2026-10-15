import { describe, expect, it } from 'vitest';
import { fleetNumber, readFleetNumber } from '../src/fleet.js';

describe('a moped’s fleet number', () => {
  it('is written EV- and three digits, four once past 999', () => {
    expect(fleetNumber(7)).toBe('EV-007');
    expect(fleetNumber(46)).toBe('EV-046');
    expect(fleetNumber(1234)).toBe('EV-1234');
    expect(fleetNumber(null)).toBeNull();
  });

  it('is read the ways people type it', () => {
    for (const s of ['EV-007', 'ev7', 'EV 7', 'ev-07', ' Ev-007 ']) expect(readFleetNumber(s)).toBe(7);
    expect(readFleetNumber('007')).toBeNull();
    expect(readFleetNumber('007', { digitsToo: true })).toBe(7);
    expect(readFleetNumber('ev')).toBeNull();
    expect(readFleetNumber('ev0')).toBeNull();
    expect(readFleetNumber('R-00007')).toBeNull();
    expect(readFleetNumber('evx7')).toBeNull();
  });
});
