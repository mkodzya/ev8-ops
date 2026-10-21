// What the fleet list says beside a moped's state (the call of 21.10.2026;
// ADR-0005, addendum 21.10.2026): which park it counts in, and why it stands
// in service. Every reason here is invented.
import { describe, expect, it } from 'vitest';
import { VEHICLE_STATES, parkOf, serviceWhyOf } from '../src/index.js';

describe('which park a moped counts in', () => {
  it('is the park somebody chose, whatever is happening to the moped', () => {
    expect(parkOf({ state: 'available', pool: 'sale' })).toBe('sale');
    // Being made ready for sale in the workshop does not take it out of the sale park.
    expect(parkOf({ state: 'service', pool: 'sale' })).toBe('sale');
    // A renter buying it out: still the sale park, with its own "rented" badge.
    expect(parkOf({ state: 'rented', pool: 'sale' })).toBe('sale');
    expect(parkOf({ state: 'available', pool: 'rent' })).toBe('rent');
  });

  it('says nobody has decided rather than taking the likelier park', () => {
    expect(parkOf({ state: 'available', pool: null })).toBe('none');
    expect(parkOf({ state: 'service', pool: null })).toBe('none');
  });

  it('counts a sold or written-off moped in neither park, whatever the column still holds', () => {
    for (const pool of ['rent', 'sale', null] as const) {
      expect(parkOf({ state: 'sold', pool })).toBe('gone');
      expect(parkOf({ state: 'out', pool })).toBe('gone');
    }
  });
});

describe('why a moped stands in service', () => {
  const job = (reasonKind: string | null, reason: string | null) => ({ reasonKind, reason });
  const manual = (reason: string | null) => ({ kind: 'manual', toState: 'service', reason });

  it('is asked only of a moped in service', () => {
    for (const state of VEHICLE_STATES.filter((s) => s !== 'service')) {
      expect(serviceWhyOf(state, job('accident', 'invented: rear light broken'), manual('invented: noise'))).toBeNull();
    }
  });

  it('is the open repair’s kind when one was picked, with what happened kept beside it', () => {
    expect(serviceWhyOf('service', job('accident', '  invented: rear light broken '), null)).toEqual({
      kind: 'accident',
      text: 'invented: rear light broken',
      from: 'job',
    });
    expect(serviceWhyOf('service', job('planned', ''), manual('invented: noise'))).toEqual({ kind: 'planned', text: null, from: 'job' });
  });

  it('is what the repair says happened when no kind was picked', () => {
    expect(serviceWhyOf('service', job(null, 'invented: brake pads'), manual('invented: noise'))).toEqual({
      kind: null,
      text: 'invented: brake pads',
      from: 'job',
    });
  });

  it('takes no kind it does not know, rather than inventing one', () => {
    expect(serviceWhyOf('service', job('other', 'invented: brake pads'), null)).toEqual({ kind: null, text: 'invented: brake pads', from: 'job' });
  });

  it('falls back to the reason of the move by hand when there is no repair', () => {
    expect(serviceWhyOf('service', null, manual(' invented: waits for a part '))).toEqual({ kind: null, text: 'invented: waits for a part', from: 'manual' });
    // A repair that says nothing at all does not hide the reason somebody gave.
    expect(serviceWhyOf('service', job(null, '   '), manual('invented: waits for a part'))).toEqual({
      kind: null,
      text: 'invented: waits for a part',
      from: 'manual',
    });
  });

  it('reads the move by hand only when it was a move into service', () => {
    expect(serviceWhyOf('service', null, { kind: 'service_in', toState: 'service', reason: 'invented: brake pads' })).toEqual({ kind: null, text: null, from: null });
    expect(serviceWhyOf('service', null, { kind: 'manual', toState: 'available', reason: 'invented: fixed' })).toEqual({ kind: null, text: null, from: null });
  });

  it('is nothing when nothing was written — a quiet dash on the screen, never a guess', () => {
    expect(serviceWhyOf('service', null, null)).toEqual({ kind: null, text: null, from: null });
    expect(serviceWhyOf('service', null, manual(null))).toEqual({ kind: null, text: null, from: null });
    expect(serviceWhyOf('service', null, manual('  '))).toEqual({ kind: null, text: null, from: null });
  });
});
