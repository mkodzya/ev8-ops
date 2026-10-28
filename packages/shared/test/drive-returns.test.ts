// «Это не возврат» on a Drive return row of "Today" (issue #19 of the director,
// item 3; ADR-0034, addendum 28.10.2026). File and folder ids are invented.
import { describe, expect, it } from 'vitest';
import { driveReturnActKey, driveReturnAnswered, driveReturnKeys, driveReturnShownAct, driveReturnWhy } from '../src/index.js';

describe('what a Drive return row says beside its number', () => {
  it('names the act’s day, an act with no day, or only the folder moved among the finished', () => {
    expect(driveReturnWhy({ returnedOn: '2026-09-09' })).toBe('act');
    // The undated act in a folder among the running ones (the R-00016 shape) is an act, not a moved folder.
    expect(driveReturnWhy({ returnedOn: null })).toBe('act_undated');
    expect(driveReturnWhy(null)).toBe('finished');
  });
});

describe('the owner’s «Это не возврат»', () => {
  const at = '2026-10-27T09:00:00.000Z';
  const later = '2026-10-29T09:00:00.000Z';

  it('keys a row by its acts as Drive last changed them, or by the folder when it holds none', () => {
    expect(driveReturnKeys([{ id: 'f1', acts: [{ id: 'act-a', modifiedAt: at }] }])).toEqual([`act:act-a@${at}`]);
    expect(driveReturnKeys([{ id: 'f1', acts: [] }])).toEqual(['folder:f1']);
    // A rental with a running folder and a finished one: both are what made its row.
    expect(driveReturnKeys([{ id: 'f1', acts: [{ id: 'act-a', modifiedAt: at }] }, { id: 'f2', acts: [] }])).toEqual([`act:act-a@${at}`, 'folder:f2']);
  });

  it('keeps the row away until a new act appears in the folder, or the act there changes', () => {
    const answered = driveReturnKeys([{ id: 'f1', acts: [{ id: 'act-a', modifiedAt: at }] }]);
    expect(driveReturnAnswered(answered, answered)).toBe(true);
    // A second act filed beside it: a key nobody answered.
    expect(driveReturnAnswered(driveReturnKeys([{ id: 'f1', acts: [{ id: 'act-a', modifiedAt: at }, { id: 'act-b', modifiedAt: later }] }]), answered)).toBe(false);
    // The same file changed in Drive since.
    expect(driveReturnAnswered(driveReturnKeys([{ id: 'f1', acts: [{ id: 'act-a', modifiedAt: later }] }]), answered)).toBe(false);
    // Answers add up: the second «Это не возврат» covers both acts.
    const both = [...answered, `act:act-b@${later}`];
    expect(driveReturnAnswered(driveReturnKeys([{ id: 'f1', acts: [{ id: 'act-a', modifiedAt: at }, { id: 'act-b', modifiedAt: later }] }]), both)).toBe(true);
  });

  it('answers nothing for a row with nothing to key', () => {
    expect(driveReturnAnswered([], ['folder:f1'])).toBe(false);
  });

  it('shows the act that brought the row back, and a dated act before an undated one', () => {
    // Newest first, as the folder is read: an undated act sorts before every dated one there.
    const undated = { id: 'act-undated', modifiedAt: at, datedOn: null };
    const dated = { id: 'act-dated', modifiedAt: later, datedOn: '2026-10-25' };
    // Nothing answered: the act with a day, whatever the order it came in.
    expect(driveReturnShownAct([undated, dated], [])?.id).toBe('act-dated');
    // The undated act of the moped before (the R-00016 shape) answered, then the real act came: the real act.
    expect(driveReturnShownAct([undated, dated], [driveReturnActKey(undated)])?.id).toBe('act-dated');
    // The dated act answered, then an undated one came: the new one, though it has no day.
    expect(driveReturnShownAct([undated, dated], [driveReturnActKey(dated)])?.id).toBe('act-undated');
    // Every act answered (the row is among the answered): the first, dated.
    expect(driveReturnShownAct([undated, dated], [driveReturnActKey(undated), driveReturnActKey(dated)])?.id).toBe('act-dated');
    expect(driveReturnShownAct([], [])).toBeNull();
  });
});
