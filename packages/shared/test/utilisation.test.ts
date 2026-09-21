// M-10 — how busy the rental fleet was (wave 6 §3.2, criteria 5, 6, 7).
import { describe, expect, it } from 'vitest';
import { fleetUtilisation, utilisationByModel } from '../src/utilisation.js';

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
