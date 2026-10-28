// A moped's state by hand (FLT-03, wave 4 §3.6): one rule for the sheet on
// the moped card and for POST /api/fleet/:id/state (21.10.2026).
import { describe, expect, it } from 'vitest';
import { EVENT_TARGET_STATE, VEHICLE_STATES, eventTargetState, manualMoveRefusal, manualStateTargets, type ManualMoveWho, type VehicleState } from '../src/index.js';

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

  it('never offers the state it is in, nor sold, from anywhere, to anyone', () => {
    for (const from of VEHICLE_STATES) {
      for (const who of [owner, manager, { ...owner, hasRental: true }, { ...manager, hasRental: true }]) {
        const targets = manualStateTargets(from, who);
        expect(targets).not.toContain(from);
        expect(targets).not.toContain('sold');
      }
    }
  });

  it('offers rented only to an owner, only for a moped whose rental is open (issue #17)', () => {
    for (const from of VEHICLE_STATES) {
      expect(manualStateTargets(from, owner)).not.toContain('rented');
      expect(manualStateTargets(from, manager)).not.toContain('rented');
      expect(manualStateTargets(from, { ...manager, hasRental: true })).not.toContain('rented');
    }
  });

  it('a moped whose rental is open but which is not rented: an owner may give it back «В аренде», and nothing else (issue #17)', () => {
    const rentalOpen = { ...owner, hasRental: true };
    expect(manualStateTargets('available', rentalOpen)).toEqual(['rented']);
    expect(manualStateTargets('service', rentalOpen)).toEqual(['rented']);
    expect(manualStateTargets('out', rentalOpen)).toEqual(['rented']);
    // A manager sees nothing to choose: the sheet stays closed, the owner fixes it.
    expect(manualStateTargets('available', { ...manager, hasRental: true })).toEqual([]);
    expect(manualStateTargets('service', { ...manager, hasRental: true })).toEqual([]);
    // Sold stays a sale's.
    expect(manualStateTargets('sold', rentalOpen)).toEqual([]);
  });

  it('offers exactly what the server would accept', () => {
    for (const from of VEHICLE_STATES) {
      for (const who of [owner, manager, { ...owner, hasRental: true }, { ...manager, hasRental: true }]) {
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

  it('a moped whose rental is open: back to rented by an owner; anything else waits for the rental (issue #17)', () => {
    expect(manualMoveRefusal('available', 'rented', { ...owner, hasRental: true })).toBeNull();
    expect(manualMoveRefusal('service', 'rented', { ...owner, hasRental: true })).toBeNull();
    expect(manualMoveRefusal('available', 'rented', { ...manager, hasRental: true })).toBe('owner_only');
    expect(manualMoveRefusal('available', 'service', { ...manager, hasRental: true })).toBe('vehicle_rented_move');
    expect(manualMoveRefusal('available', 'out', { ...owner, hasRental: true })).toBe('vehicle_rented_move');
    expect(manualMoveRefusal('service', 'available', { ...owner, hasRental: true })).toBe('vehicle_rented_move');
    expect(manualMoveRefusal('available', 'sold', { ...owner, hasRental: true })).toBe('sold_by_sale');
    // Without an open rental rented still comes from a hand-over only.
    expect(manualMoveRefusal('available', 'rented', owner)).toBe('use_rental');
  });

  it('lets the allowed moves through', () => {
    expect(manualMoveRefusal('available', 'service', manager)).toBeNull();
    expect(manualMoveRefusal('service', 'available', manager)).toBeNull();
    expect(manualMoveRefusal('out', 'available', manager)).toBeNull();
    expect(manualMoveRefusal('available', 'out', owner)).toBeNull();
    expect(manualMoveRefusal('out', 'service', owner)).toBeNull();
  });
});

describe('where an event leaves a moped (issue #17)', () => {
  it('a repair ends with the customer while the rental is open, in the yard otherwise', () => {
    expect(eventTargetState('service_out', true)).toBe('rented');
    expect(eventTargetState('service_out', false)).toBe('available');
  });

  it('every other event keeps its own state, rental or none', () => {
    for (const kind of Object.keys(EVENT_TARGET_STATE) as (keyof typeof EVENT_TARGET_STATE)[]) {
      if (kind === 'service_out') continue;
      expect(eventTargetState(kind, true)).toBe(EVENT_TARGET_STATE[kind]);
      expect(eventTargetState(kind, false)).toBe(EVENT_TARGET_STATE[kind]);
    }
  });
});
