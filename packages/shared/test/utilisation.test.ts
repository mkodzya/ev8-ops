// M-10 — how busy the rental fleet was (wave 6 §3.2, criteria 5, 6, 7).
import { describe, expect, it } from 'vitest';
import {
  UTILISATION_FILTERS,
  fleetBlockers,
  fleetUtilisation,
  utilisationByModel,
  utilisationModelVehicles,
  utilisationPath,
  utilisationQuery,
} from '../src/utilisation.js';

const arrived = (day: string) => ({ occurredOn: day, toState: 'available' as const, toPool: 'rent' as const });

describe('utilisation of the rental fleet', () => {
  it('counts the days a moped stood in the park, not the mopeds (crit. 5)', () => {
    // Two mopeds, fourteen days each; one of them out for seven of them.
    const u = fleetUtilisation({
      from: '2026-09-01',
      to: '2026-09-14',
      vehicles: [
        {
          id: 'a',
          initialPool: 'rent',
          events: [arrived('2026-08-01'), { occurredOn: '2026-09-01', toState: 'rented' }, { occurredOn: '2026-09-08', toState: 'available' }],
        },
        { id: 'b', initialPool: 'rent', events: [arrived('2026-08-01')] },
      ],
    });
    expect(u.poolDays).toBe(28);
    expect(u.rentedDays).toBe(7);
    expect(u.percent).toBe(25);
  });

  it('stops counting a moped the day it is sold (crit. 6)', () => {
    const u = fleetUtilisation({
      from: '2026-09-01',
      to: '2026-09-30',
      vehicles: [{ id: 'a', initialPool: 'rent', events: [arrived('2026-08-01'), { occurredOn: '2026-09-16', toState: 'sold' }] }],
    });
    // The first fifteen days only; the sixteenth is the day it went.
    expect(u.poolDays).toBe(15);
    expect(u.percent).toBe(0);
  });

  it('follows a moped between parks by the day, not by where it ended up', () => {
    const u = fleetUtilisation({
      from: '2026-09-01',
      to: '2026-09-10',
      vehicles: [
        {
          id: 'a',
          initialPool: 'rent',
          events: [arrived('2026-08-01'), { occurredOn: '2026-09-06', toPool: 'sale' }],
        },
      ],
    });
    expect(u.poolDays).toBe(5);
  });

  it('leaves a moped with no park out of both figures, and says how many (§3.2)', () => {
    const u = fleetUtilisation({
      from: '2026-09-01',
      to: '2026-09-10',
      vehicles: [
        { id: 'a', initialPool: 'rent', events: [arrived('2026-08-01')] },
        { id: 'nobody', initialPool: null, events: [{ occurredOn: '2026-08-01', toState: 'available' }] },
      ],
    });
    expect(u.poolDays).toBe(10);
    expect(u.unassigned).toBe(1);
    expect(u.rows).toHaveLength(1);
  });

  it('counts a moped only from the day it arrived', () => {
    const u = fleetUtilisation({
      from: '2026-09-01',
      to: '2026-09-10',
      vehicles: [{ id: 'a', initialPool: 'rent', events: [arrived('2026-09-06')] }],
    });
    expect(u.poolDays).toBe(5);
  });

  it('adds up by model to the same total (crit. 7)', () => {
    const u = fleetUtilisation({
      from: '2026-09-01',
      to: '2026-09-10',
      vehicles: [
        { id: 'a', modelId: 'm1', initialPool: 'rent', events: [arrived('2026-08-01'), { occurredOn: '2026-09-01', toState: 'rented' }] },
        { id: 'b', modelId: 'm1', initialPool: 'rent', events: [arrived('2026-08-01')] },
        { id: 'c', modelId: 'm2', initialPool: 'rent', events: [arrived('2026-08-01')] },
      ],
    });
    const byModel = utilisationByModel(u);
    expect(byModel.reduce((n, m) => n + m.poolDays, 0)).toBe(u.poolDays);
    expect(byModel.reduce((n, m) => n + m.rentedDays, 0)).toBe(u.rentedDays);
    expect(byModel.find((m) => m.modelId === 'm1')?.percent).toBe(50);
  });

  it('says nothing rather than zero when no moped stood in the park', () => {
    const u = fleetUtilisation({ from: '2026-09-01', to: '2026-09-10', vehicles: [] });
    expect(u.percent).toBeNull();
    expect(u.poolDays).toBe(0);
  });
});

describe('what kept the figure down (§3.2, "что мешает")', () => {
  const inRepair = (id: string, since: string) => ({
    id,
    initialPool: 'rent' as const,
    events: [arrived('2026-08-01'), { occurredOn: since, toState: 'service' as const }],
  });

  it('counts a moped in repair every day of the period, and not one that came back', () => {
    const b = fleetBlockers({
      from: '2026-09-01',
      to: '2026-09-30',
      vehicles: [
        inRepair('stuck', '2026-08-20'),
        { ...inRepair('back', '2026-08-20'), events: [arrived('2026-08-01'), { occurredOn: '2026-08-20', toState: 'service' }, { occurredOn: '2026-09-15', toState: 'available' }] },
      ],
    });
    expect(b.inRepairAllPeriod.map((r) => r.id)).toEqual(['stuck']);
    expect(b.inRepairAllPeriod[0]?.days).toBe(30);
  });

  it('leaves out a moped stuck in repair in another park: the figure is the rental park', () => {
    const b = fleetBlockers({
      from: '2026-09-01',
      to: '2026-09-30',
      vehicles: [{ ...inRepair('sale-park', '2026-08-20'), initialPool: 'sale' }],
    });
    expect(b.inRepairAllPeriod).toHaveLength(0);
  });

  it('names the mopeds free longer than fourteen days, longest first', () => {
    // Free "since" is the day it came back, so a rental in between is what
    // sets the clock — an arrival alone leaves it standing from day one.
    const cameBack = (id: string, on: string) => ({
      id,
      initialPool: 'rent' as const,
      events: [
        arrived('2026-08-01'),
        { occurredOn: '2026-08-05', toState: 'rented' as const },
        { occurredOn: on, toState: 'available' as const },
      ],
    });
    const b = fleetBlockers({
      from: '2026-09-01',
      to: '2026-09-30',
      // Exactly fourteen days is not "longer than fourteen days".
      vehicles: [cameBack('long', '2026-08-20'), cameBack('short', '2026-09-16')],
    });
    expect(b.freeTooLong.map((r) => r.id)).toEqual(['long']);
    expect(b.freeTooLong[0]?.days).toBe(41);
  });

  it('says nothing about batteries rather than zero: no record ties a repair to one', () => {
    const b = fleetBlockers({ from: '2026-09-01', to: '2026-09-30', vehicles: [] });
    expect(b.batteriesHolding).toBeNull();
  });
});

describe('the period reaches the server (QA-W6-05, the lesson)', () => {
  it('carries every key the link puts in the address', () => {
    const path = utilisationPath({ from: '2026-09-01', to: '2026-09-30' });
    expect(path).toBe('/reports/utilisation?from=2026-09-01&to=2026-09-30');

    // What the screen would then ask the server, read back out of that very
    // address: the two must be the same query, or the period is lost in the
    // middle again.
    const asked = new URLSearchParams(path.split('?')[1]);
    expect(utilisationQuery((k) => asked.get(k))).toBe('from=2026-09-01&to=2026-09-30');
    expect([...asked.keys()].every((k) => (UTILISATION_FILTERS as readonly string[]).includes(k))).toBe(true);
  });

  it('asks for nothing it was not given', () => {
    expect(utilisationQuery(() => null)).toBe('');
    expect(utilisationQuery((k) => (k === 'from' ? '  ' : null))).toBe('');
  });
});

describe('mopeds per model (§3.2, the middle column)', () => {
  it('counts each VIN once, and only the ones that stood in the park', () => {
    const u = fleetUtilisation({
      from: '2026-09-01',
      to: '2026-09-10',
      vehicles: [
        { id: 'a', modelId: 'm1', initialPool: 'rent', events: [arrived('2026-08-01')] },
        { id: 'b', modelId: 'm1', initialPool: 'rent', events: [arrived('2026-08-01')] },
        { id: 'c', modelId: 'm2', initialPool: 'sale', events: [arrived('2026-08-01')] },
      ],
    });
    const per = utilisationModelVehicles(u);
    expect(per.get('m1')).toBe(2);
    expect(per.has('m2')).toBe(false);
  });
});
