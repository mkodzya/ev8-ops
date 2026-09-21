// A VIN is 17 characters without I, O or Q (wave 5 §3.9, B3-06, ISO 3779),
// and a CMR pasted in says which line is wrong rather than refusing the lot.
import { describe, expect, it } from 'vitest';
import { checkVinList, isVin, normalizeVin, vinFault } from '../src/index.js';

describe('a VIN', () => {
  it('is seventeen characters and has no I, O or Q (crit. 31)', () => {
    expect(isVin('LSJA24U91NZ033145')).toBe(true);
    expect(vinFault('TEST-1')).toBe('length');
    expect(vinFault('LSJA24U91NZ03314')).toBe('length');
    expect(vinFault('LSJA24U9INZ033145')).toBe('letters');
    expect(vinFault('LSJA24U91NZ0331O5')).toBe('letters');
  });

  it('is stored the way it is written on the frame', () => {
    expect(normalizeVin(' lsja24u91nz033145 ')).toBe('LSJA24U91NZ033145');
    expect(normalizeVin('LSJA-24U9-1NZ-033145')).toBe('LSJA24U91NZ033145');
  });
});

describe('a CMR pasted in', () => {
  it('names the line that is wrong (crit. 14)', () => {
    const rows = checkVinList('LSJA24U91NZ033145\nLSJA24U91NZ03314');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ line: 2, fault: 'length' });
    expect(rows[0].fault).toBeNull();
  });

  it('catches a VIN twice in one paste, and one the fleet already holds (crit. 15)', () => {
    const rows = checkVinList('LSJA24U91NZ033145\nLSJA24U91NZ033145\nLSJA24U91NZ033146', ['LSJA24U91NZ033146']);
    expect(rows.map((r) => r.fault)).toEqual([null, 'duplicate', 'known']);
  });

  it('ignores the blank lines a copy-paste leaves behind', () => {
    expect(checkVinList('\n LSJA24U91NZ033145 \n\n')).toHaveLength(1);
  });
});
