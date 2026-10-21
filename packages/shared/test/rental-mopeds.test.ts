// Which moped a rental had, and when (ADR-0040): read from its acts, as a
// moped's state is read from its events. Mopeds A, B, C and every date are
// made up.
import { describe, expect, it } from 'vitest';
import { actsInOrder, handOverActOf, mopedLegs, mopedOnDay, mopedSpan, type MopedAct } from '../src/index.js';

const act = (kind: string, vehicleId: string | null, occurredOn: string, createdAt: string, extra: Partial<MopedAct> & { km?: number } = {}) => ({
  kind,
  vehicleId,
  occurredOn,
  createdAt: `${createdAt}+04:00`,
  ...extra,
});

describe('one hand-over, one moped', () => {
  const acts = [act('pickup', 'A', '2031-03-01', '2031-03-01T10:00:00')];

  it('is one stretch, still running', () => {
    expect(mopedLegs(acts)).toEqual([{ vehicleId: 'A', from: '2031-03-01', to: null, began: 'pickup', ended: null }]);
  });

  it('a return ends it on its day', () => {
    const legs = mopedLegs([...acts, act('return', 'A', '2031-03-20', '2031-03-20T18:00:00')]);
    expect(legs).toEqual([{ vehicleId: 'A', from: '2031-03-01', to: '2031-03-20', began: 'pickup', ended: 'return' }]);
  });

  it('a return taken back ends nothing: the rental ran on (B5-08)', () => {
    const legs = mopedLegs([...acts, act('return', 'A', '2031-03-20', '2031-03-20T18:00:00', { undone: true })]);
    expect(legs).toEqual([{ vehicleId: 'A', from: '2031-03-01', to: null, began: 'pickup', ended: null }]);
  });

  it('an act written before the acts named their moped is the rental’s moped’s', () => {
    expect(mopedLegs([act('pickup', null, '2031-03-01', '2031-03-01T10:00:00')], 'A')).toEqual([{ vehicleId: 'A', from: '2031-03-01', to: null, began: 'pickup', ended: null }]);
    // A rental without a VIN has no moped to read.
    expect(mopedLegs([act('pickup', null, '2031-03-01', '2031-03-01T10:00:00')], null)).toEqual([]);
  });
});

describe('a swap: one rental, two mopeds', () => {
  // A from 1 March; swapped for B on 10 March, both acts written in one transaction; B returned on 20 March.
  const acts = [
    act('return', 'B', '2031-03-20', '2031-03-20T18:00:00'),
    act('swap_in', 'B', '2031-03-10', '2031-03-10T12:00:00'),
    act('swap_out', 'A', '2031-03-10', '2031-03-10T12:00:00'),
    act('pickup', 'A', '2031-03-01', '2031-03-01T10:00:00'),
  ];

  it('the moped given back comes before the one handed out, whatever order they are read in', () => {
    expect(actsInOrder(acts).map((a) => a.kind)).toEqual(['pickup', 'swap_out', 'swap_in', 'return']);
  });

  it('A until the swap, B from it', () => {
    expect(mopedLegs(acts)).toEqual([
      { vehicleId: 'A', from: '2031-03-01', to: '2031-03-10', began: 'pickup', ended: 'swap_out' },
      { vehicleId: 'B', from: '2031-03-10', to: '2031-03-20', began: 'swap_in', ended: 'return' },
    ]);
  });

  it('on the swap day the rental has the new moped; before it, the old one', () => {
    const legs = mopedLegs(acts);
    expect(mopedOnDay(legs, '2031-03-01')).toBe('A');
    expect(mopedOnDay(legs, '2031-03-09')).toBe('A');
    expect(mopedOnDay(legs, '2031-03-10')).toBe('B');
    expect(mopedOnDay(legs, '2031-03-20')).toBe('B');
    // A week begun before the first act is the first moped's.
    expect(mopedOnDay(legs, '2031-02-25')).toBe('A');
    expect(mopedOnDay([], '2031-03-01')).toBeNull();
  });

  it('the act that handed each moped out: B’s mileage is the one B’s return is checked against', () => {
    const withKm = [act('pickup', 'A', '2031-03-01', '2031-03-01T10:00:00', { km: 1200 }), act('swap_out', 'A', '2031-03-10', '2031-03-10T12:00:00', { km: 1500 }), act('swap_in', 'B', '2031-03-10', '2031-03-10T12:00:00', { km: 300 })];
    expect(handOverActOf(withKm, 'B')).toMatchObject({ kind: 'swap_in', km: 300 });
    expect(handOverActOf(withKm, 'A')).toMatchObject({ kind: 'pickup', km: 1200 });
    expect(handOverActOf(withKm, 'C')).toBeNull();
  });

  it('an act that names no moped answers for the rental when none names this one', () => {
    const old = [act('pickup', null, '2031-03-01', '2031-03-01T10:00:00')];
    expect(handOverActOf(old, 'A')).toMatchObject({ kind: 'pickup' });
    expect(handOverActOf(old, null)).toMatchObject({ kind: 'pickup' });
  });

  it('each moped’s part, for its card', () => {
    const legs = mopedLegs(acts);
    expect(mopedSpan(legs, 'A')).toEqual({ from: '2031-03-01', to: '2031-03-10', swappedIn: false, swappedOut: true });
    expect(mopedSpan(legs, 'B')).toEqual({ from: '2031-03-10', to: '2031-03-20', swappedIn: true, swappedOut: false });
    expect(mopedSpan(legs, 'C')).toBeNull();
  });
});

describe('two swaps in one rental, one of them a correction', () => {
  // A → B on 10 March; B was the wrong one, so B → C the same day, later; C still out.
  const acts = [
    act('pickup', 'A', '2031-03-01', '2031-03-01T10:00:00'),
    act('swap_out', 'A', '2031-03-10', '2031-03-10T12:00:00'),
    act('swap_in', 'B', '2031-03-10', '2031-03-10T12:00:00'),
    act('swap_out', 'B', '2031-03-10', '2031-03-10T12:30:00'),
    act('swap_in', 'C', '2031-03-10', '2031-03-10T12:30:00'),
  ];

  it('three stretches; the second lasted no day at all, which is the truth', () => {
    expect(mopedLegs(acts).map((l) => [l.vehicleId, l.from, l.to])).toEqual([
      ['A', '2031-03-01', '2031-03-10'],
      ['B', '2031-03-10', '2031-03-10'],
      ['C', '2031-03-10', null],
    ]);
  });

  it('on that day the rental has the last one handed out', () => {
    expect(mopedOnDay(mopedLegs(acts), '2031-03-10')).toBe('C');
  });

  it('a swap back to the first moped is a new stretch of it', () => {
    const back = [...acts, act('swap_out', 'C', '2031-03-15', '2031-03-15T09:00:00'), act('swap_in', 'A', '2031-03-15', '2031-03-15T09:00:00')];
    const legs = mopedLegs(back);
    expect(legs.map((l) => l.vehicleId)).toEqual(['A', 'B', 'C', 'A']);
    expect(handOverActOf(back, 'A')).toMatchObject({ kind: 'swap_in', occurredOn: '2031-03-15' });
    expect(mopedOnDay(legs, '2031-03-16')).toBe('A');
  });
});
