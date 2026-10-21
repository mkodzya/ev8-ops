// The workshops list (owner's decision of 21.10.2026): taking one off the
// list hides it from the pickers and keeps it on the repairs that had it.
// The names below are invented.
import { describe, expect, it } from 'vitest';
import { nextWorkshopOrder, workshopChoices, workshopRefusal } from '../src/index.js';

describe('giving a repair a workshop', () => {
  it('takes one on the list', () => {
    expect(workshopRefusal({ archived: false }, false)).toBeNull();
  });

  it('refuses one that does not exist', () => {
    expect(workshopRefusal(null, false)).toBe('workshop_not_found');
  });

  it('refuses one taken off the list', () => {
    expect(workshopRefusal({ archived: true }, false)).toBe('workshop_archived');
  });

  it('lets a repair keep the one it already has, even off the list', () => {
    expect(workshopRefusal({ archived: true }, true)).toBeNull();
  });
});

describe('what a repair’s workshop can be changed to', () => {
  const live = [
    { id: 'a', name: 'ТЕСТ мастерская Альфа' },
    { id: 'b', name: 'ТЕСТ мастерская Бета' },
  ];

  it('is the live list in its order when the repair has none', () => {
    expect(workshopChoices(live, null)).toEqual([
      { id: 'a', name: 'ТЕСТ мастерская Альфа', off: false },
      { id: 'b', name: 'ТЕСТ мастерская Бета', off: false },
    ]);
  });

  it('marks nothing extra when the repair’s workshop is on the list', () => {
    expect(workshopChoices(live, { id: 'b', name: 'ТЕСТ мастерская Бета' }).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('puts the repair’s own workshop first when it was taken off the list', () => {
    const choices = workshopChoices(live, { id: 'z', name: 'ТЕСТ мастерская Убранная' });
    expect(choices[0]).toEqual({ id: 'z', name: 'ТЕСТ мастерская Убранная', off: true });
    expect(choices.slice(1).every((c) => !c.off)).toBe(true);
    expect(choices).toHaveLength(3);
  });

  it('still shows the repair’s workshop when the list is empty', () => {
    expect(workshopChoices([], { id: 'z', name: 'ТЕСТ мастерская Убранная' })).toEqual([{ id: 'z', name: 'ТЕСТ мастерская Убранная', off: true }]);
  });
});

describe('a new workshop’s place in the list', () => {
  it('is after the last one', () => {
    expect(nextWorkshopOrder(2)).toBe(3);
  });

  it('is first on an empty list', () => {
    expect(nextWorkshopOrder(null)).toBe(1);
    expect(nextWorkshopOrder(undefined)).toBe(1);
  });
});
