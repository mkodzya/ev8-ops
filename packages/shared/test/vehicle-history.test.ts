// A moped's history on its card (QA walk of 21–22.10.2026): events and the
// journal's corrections in one order, the newest on top, and the two halves of
// a swap told apart from a plain hand-over and return. Mopeds A and B, the
// rentals and every date are made up.
import { describe, expect, it } from 'vitest';
import { newestFirst, swapSideOf, type MopedAct } from '../src/index.js';

describe('the history, newest first', () => {
  it('merges events and journal rows by their day, not by where they came from', () => {
    // As the card got them: the journal newest first, the events oldest first.
    const journal = [
      { id: 'tracker fixed', day: '2026-10-21', at: '2026-10-21T09:00:00Z' },
      { id: 'tracker written', day: '2026-10-21', at: '2026-10-21T08:00:00Z' },
    ];
    const events = [
      { id: 'arrived', day: '2026-09-22', at: '2026-09-22T07:00:00Z' },
      { id: 'pickup', day: '2026-10-20', at: '2026-10-20T07:00:00Z' },
      { id: 'return', day: '2026-10-20', at: '2026-10-20T15:00:00Z' },
    ];
    expect(newestFirst([...journal, ...events]).map((l) => l.id)).toEqual(['tracker fixed', 'tracker written', 'return', 'pickup', 'arrived']);
  });

  it('puts an event entered late on its own day, below what was written that day', () => {
    const lines = [
      { id: 'return entered on the 21st for the 19th', day: '2026-10-19', at: '2026-10-21T10:00:00Z' },
      { id: 'park move on the 20th', day: '2026-10-20', at: '2026-10-20T10:00:00Z' },
    ];
    expect(newestFirst(lines).map((l) => l.id)).toEqual(['park move on the 20th', 'return entered on the 21st for the 19th']);
  });

  it('keeps the order it was given where day and moment tie — one transaction writes both', () => {
    const at = '2026-10-21T10:00:00Z';
    const lines = [
      { id: 'event', day: '2026-10-21', at },
      { id: 'journal', day: '2026-10-21', at },
    ];
    expect(newestFirst(lines).map((l) => l.id)).toEqual(['event', 'journal']);
    expect(newestFirst([...lines].reverse()).map((l) => l.id)).toEqual(['journal', 'event']);
  });

  it('reads a moment as a Date too, and puts a line without one under those that have it on the same day', () => {
    const lines = [
      { id: 'no moment', day: '2026-10-21', at: null },
      { id: 'a Date', day: '2026-10-21', at: new Date('2026-10-21T10:00:00Z') },
      { id: 'no day', day: null, at: '2026-10-22T10:00:00Z' },
    ];
    expect(newestFirst(lines).map((l) => l.id)).toEqual(['a Date', 'no moment', 'no day']);
  });

  it('does not change the list it was given', () => {
    const lines = [
      { day: '2026-10-01', at: null },
      { day: '2026-10-02', at: null },
    ];
    newestFirst(lines);
    expect(lines.map((l) => l.day)).toEqual(['2026-10-01', '2026-10-02']);
  });
});

describe('a swap in the moped’s history (ADR-0040)', () => {
  const act = (kind: string, vehicleId: string | null, occurredOn: string): MopedAct => ({ kind, vehicleId, occurredOn, createdAt: `${occurredOn}T10:00:00Z` });
  const acts = [act('pickup', 'A', '2026-10-01'), act('swap_out', 'A', '2026-10-15'), act('swap_in', 'B', '2026-10-15')];

  it('names the old moped’s return the half that gave it back', () => {
    expect(swapSideOf({ kind: 'return', occurredOn: '2026-10-15', rentalId: 'R' }, acts, 'A')).toBe('out');
  });

  it('names the new moped’s hand-over the half that brought it', () => {
    expect(swapSideOf({ kind: 'pickup', occurredOn: '2026-10-15', rentalId: 'R' }, acts, 'B')).toBe('in');
  });

  it('leaves a plain hand-over and a plain return alone', () => {
    expect(swapSideOf({ kind: 'pickup', occurredOn: '2026-10-01', rentalId: 'R' }, acts, 'A')).toBeNull();
    const ended = [...acts, act('return', 'B', '2026-10-30')];
    expect(swapSideOf({ kind: 'return', occurredOn: '2026-10-30', rentalId: 'R' }, ended, 'B')).toBeNull();
  });

  it('asks only about the moped whose history it is, on the swap’s day', () => {
    expect(swapSideOf({ kind: 'return', occurredOn: '2026-10-15', rentalId: 'R' }, acts, 'B')).toBeNull();
    expect(swapSideOf({ kind: 'return', occurredOn: '2026-10-16', rentalId: 'R' }, acts, 'A')).toBeNull();
  });

  it('says nothing of events that are not a rental’s', () => {
    expect(swapSideOf({ kind: 'return', occurredOn: '2026-10-15', rentalId: null }, acts, 'A')).toBeNull();
    expect(swapSideOf({ kind: 'service_in', occurredOn: '2026-10-15', rentalId: 'R' }, acts, 'A')).toBeNull();
  });
});
