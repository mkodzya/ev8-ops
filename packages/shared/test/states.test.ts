// A moped's state by hand (FLT-03, wave 4 §3.6): one rule for the sheet on
// the moped card and for POST /api/fleet/:id/state (21.10.2026).
import { describe, expect, it } from 'vitest';
import { VEHICLE_STATES, manualMoveRefusal, manualStateTargets, type ManualMoveWho, type VehicleState } from '../src/index.js';

const owner: ManualMoveWho = { mayWriteOff: true, hasRental: false };
const manager: ManualMoveWho = { mayWriteOff: false, hasRental: false };

describe('the states a person may set by hand', () => {
  it('offers the owner free, service and written off — never the one it is in', () => {
    expect(manualStateTargets('service', owner)).toEqual(['available', 'out']);
    expect(manualStateTargets('available', owner)).toEqual(['service', 'out']);
    expect(manualStateTargets('out', owner)).toEqual(['available', 'service']);
  });

  it('offers a manager free and service only', () => {
    expect(manualStateTargets('service', manager)).toEqual(['available']);
    expect(manualStateTargets('available', manager)).toEqual(['service']);
  });

  it('lets a manager bring a written-off moped back, as the API always has (Mika, 21.10.2026)', () => {
    expect(manualStateTargets('out', manager)).toEqual(['available', 'service']);
  });

  it('offers nothing for a sold moped, nor for one out on a rental', () => {
    expect(manualStateTargets('sold', owner)).toEqual([]);
    expect(manualStateTargets('sold', manager)).toEqual([]);
    expect(manualStateTargets('rented', { ...owner, hasRental: true })).toEqual([]);
    expect(manualStateTargets('rented', { ...manager, hasRental: true })).toEqual([]);
  });

  it('lets a moped marked rented with no rental behind it be put right', () => {
    expect(manualStateTargets('rented', owner)).toEqual(['available', 'service', 'out']);
    expect(manualStateTargets('rented', manager)).toEqual(['available', 'service']);
  });

  it('never offers the state it is in, rented or sold, from anywhere, to anyone', () => {
    for (const from of VEHICLE_STATES) {
      for (const who of [owner, manager, { ...owner, hasRental: true }, { ...manager, hasRental: true }]) {
        const targets = manualStateTargets(from, who);
        expect(targets).not.toContain(from);
        expect(targets).not.toContain('rented');
        expect(targets).not.toContain('sold');
      }
    }
  });

  it('offers exactly what the server would accept', () => {
    for (const from of VEHICLE_STATES) {
      for (const who of [owner, manager]) {
        const accepted = VEHICLE_STATES.filter((to: VehicleState) => manualMoveRefusal(from, to, who) === null);
        expect(manualStateTargets(from, who)).toEqual(accepted);
      }
    }
  });
});

describe('why a move by hand is refused', () => {
  it('answers in the order the API always has, so each refusal keeps its code', () => {
    // A moped out on a rental first: even "sold" is answered by "close the rental".
    expect(manualMoveRefusal('rented', 'sold', { ...owner, hasRental: true })).toBe('vehicle_rented_move');
    expect(manualMoveRefusal('rented', 'available', { ...manager, hasRental: true })).toBe('vehicle_rented_move');
    // Sold either way is a sale's word, before anyone's role is asked.
    expect(manualMoveRefusal('available', 'sold', manager)).toBe('sold_by_sale');
    expect(manualMoveRefusal('sold', 'available', owner)).toBe('sold_by_sale');
    expect(manualMoveRefusal('sold', 'out', manager)).toBe('sold_by_sale');
    // Writing off is the owners'; so is "rented" for a manager, as the API answered it.
    expect(manualMoveRefusal('available', 'out', manager)).toBe('owner_only');
    expect(manualMoveRefusal('available', 'rented', manager)).toBe('owner_only');
    expect(manualMoveRefusal('out', 'out', manager)).toBe('owner_only');
    // Rented comes from a hand-over.
    expect(manualMoveRefusal('available', 'rented', owner)).toBe('use_rental');
    expect(manualMoveRefusal('rented', 'rented', owner)).toBe('use_rental');
  });

  it('refuses the state the moped is already in, instead of writing X → X', () => {
    expect(manualMoveRefusal('service', 'service', owner)).toBe('same_state');
    expect(manualMoveRefusal('service', 'service', manager)).toBe('same_state');
    expect(manualMoveRefusal('available', 'available', manager)).toBe('same_state');
    expect(manualMoveRefusal('out', 'out', owner)).toBe('same_state');
  });

  it('lets the allowed moves through', () => {
    expect(manualMoveRefusal('available', 'service', manager)).toBeNull();
    expect(manualMoveRefusal('service', 'available', manager)).toBeNull();
    expect(manualMoveRefusal('out', 'available', manager)).toBeNull();
    expect(manualMoveRefusal('available', 'out', owner)).toBeNull();
    expect(manualMoveRefusal('out', 'service', owner)).toBeNull();
  });
});
