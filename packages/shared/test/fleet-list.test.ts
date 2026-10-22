// What the fleet list says beside a moped's state (the call of 21.10.2026;
// ADR-0005, addenda 21.10.2026 and 22.10.2026): which park it counts in,
// which one chip it is filtered under, and why it stands in service. Every
// reason here is invented.
import { describe, expect, it } from 'vitest';
import { FLEET_CHIPS, VEHICLE_POOLS, VEHICLE_STATES, fleetChipOf, parkOf, serviceWhyOf, type FleetChip, type VehiclePool, type VehicleState } from '../src/index.js';

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

describe('the one chip a moped is counted under (Mika, answer «Б», 22.10.2026)', () => {
  // Every combination the list can hold: each state, each park or none, a point or not.
  const every: { v: { state: VehicleState; pool: VehiclePool | null }; hasPoint: boolean }[] = VEHICLE_STATES.flatMap((state) =>
    [...VEHICLE_POOLS, null].flatMap((pool) => [true, false].map((hasPoint) => ({ v: { state, pool }, hasPoint }))),
  );

  it('asks the state first: a rented or serviced moped is under its state, whatever its park or point', () => {
    // A renter on a moped nobody put in a park: «В аренде», not «Не назначен».
    expect(fleetChipOf({ state: 'rented', pool: null }, false)).toBe('rented');
    // A renter buying a moped of the sale park out.
    expect(fleetChipOf({ state: 'rented', pool: 'sale' }, true)).toBe('rented');
    // Made ready for sale in the workshop: «В сервисе», not «На продажу».
    expect(fleetChipOf({ state: 'service', pool: 'sale' }, true)).toBe('service');
    expect(fleetChipOf({ state: 'service', pool: null }, false)).toBe('service');
  });

  it('asks of an idle moped the park first, then the point, and calls the rest free', () => {
    // For sale is answered before the missing point.
    expect(fleetChipOf({ state: 'available', pool: 'sale' }, false)).toBe('sale');
    expect(fleetChipOf({ state: 'available', pool: 'sale' }, true)).toBe('sale');
    // No park is answered before the missing point.
    expect(fleetChipOf({ state: 'available', pool: null }, false)).toBe('nopool');
    expect(fleetChipOf({ state: 'available', pool: null }, true)).toBe('nopool');
    expect(fleetChipOf({ state: 'available', pool: 'rent' }, false)).toBe('nopoint');
    expect(fleetChipOf({ state: 'available', pool: 'rent' }, true)).toBe('available');
  });

  it('puts a sold or written-off moped under no chip: it is seen only under «Все»', () => {
    for (const { v, hasPoint } of every.filter((x) => x.v.state === 'sold' || x.v.state === 'out')) {
      expect(fleetChipOf(v, hasPoint)).toBeNull();
    }
  });

  it('counts every moped still in the fleet under exactly one chip, so the chips add up to «Все» less the gone', () => {
    const counts = Object.fromEntries(FLEET_CHIPS.map((c) => [c, 0])) as Record<FleetChip, number>;
    let gone = 0;
    for (const { v, hasPoint } of every) {
      const chip = fleetChipOf(v, hasPoint);
      if (chip === null) gone++;
      else counts[chip]++;
      // Exactly one: the chips' own tests, as the list asks them, agree on it.
      expect(FLEET_CHIPS.filter((c) => fleetChipOf(v, hasPoint) === c)).toHaveLength(parkOf(v) === 'gone' ? 0 : 1);
    }
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(every.length - gone);
    expect(gone).toBe(every.filter((x) => parkOf(x.v) === 'gone').length);
  });

  it('keeps «В аренде» and «В сервисе» equal to the states’ own counts', () => {
    for (const state of ['rented', 'service'] as const) {
      expect(every.filter((x) => fleetChipOf(x.v, x.hasPoint) === state)).toEqual(every.filter((x) => x.v.state === state));
    }
  });

  it('lets every chip be reached', () => {
    const reached = new Set(every.map((x) => fleetChipOf(x.v, x.hasPoint)));
    for (const chip of FLEET_CHIPS) expect(reached.has(chip)).toBe(true);
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
