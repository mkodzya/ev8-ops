// A tracker already on a moped, written and corrected from the moped's card
// (ADR-0036, addendum 21.10.2026). The IMEIs and SIMs are invented: the IMEIs
// begin with 99 and are made valid by their check digit, not read off a tracker.
import { describe, expect, it } from 'vitest';
import { imeiGroups, journalKind, readImei, trackerCorrection, trackerDayFault, trackerTails } from '../src/index.js';

const A = '990000000000010';
const B = '990000000000028';

describe('the invented IMEIs of these tests', () => {
  it('pass the check digit, so a refusal below is never about them', () => {
    expect(readImei(A)).toBe(A);
    expect(readImei(B)).toBe(B);
  });
});

describe('an IMEI on the card', () => {
  it('reads in threes, as it is held against the sticker', () => {
    expect(imeiGroups(A)).toBe('990 000 000 000 010');
  });
});

describe('the day a tracker was on the moped', () => {
  const day = (on: string, more: { arrivedOn?: string | null; lastRemovedOn?: string | null } = {}) =>
    trackerDayFault({ on, today: '2026-10-21', arrivedOn: more.arrivedOn ?? null, lastRemovedOn: more.lastRemovedOn ?? null });

  it('may be today — the default, always true — or any day before it', () => {
    expect(day('2026-10-21')).toBeNull();
    expect(day('2026-07-01')).toBeNull();
  });

  it('is not tomorrow', () => {
    expect(day('2026-10-22')).toBe('future');
  });

  it('is not before the moped came; a moped nobody dated takes any past day', () => {
    expect(day('2026-08-31', { arrivedOn: '2026-09-01' })).toBe('before_arrival');
    expect(day('2026-09-01', { arrivedOn: '2026-09-01' })).toBeNull();
    expect(day('2026-01-01', { arrivedOn: null })).toBeNull();
  });

  it('is not before the last tracker came off: one tracker on a moped at a time, the same day allowed', () => {
    expect(day('2026-10-14', { lastRemovedOn: '2026-10-15' })).toBe('before_last_removed');
    expect(day('2026-10-15', { lastRemovedOn: '2026-10-15' })).toBeNull();
  });
});

describe('a correction', () => {
  const kept = { imei: A, simPhone: '555010203' };

  it('changes only what differs from what is kept', () => {
    expect(trackerCorrection(kept, { imei: B, simPhone: '555010203' })).toEqual({ imei: B });
    expect(trackerCorrection(kept, { simPhone: '555010204' })).toEqual({ simPhone: '555010204' });
    expect(trackerCorrection(kept, { imei: B, simPhone: '555010204' })).toEqual({ imei: B, simPhone: '555010204' });
  });

  it('is nothing when nothing differs — then nothing is written', () => {
    expect(trackerCorrection(kept, { imei: A, simPhone: '555010203' })).toBeNull();
    expect(trackerCorrection(kept, {})).toBeNull();
  });

  it('takes one Georgian SIM written two ways for the same SIM', () => {
    expect(trackerCorrection(kept, { simPhone: '+995555010203' })).toBeNull();
    expect(trackerCorrection({ imei: A, simPhone: '+995555010203' }, { simPhone: '555010203' })).toBeNull();
  });

  it('compares a short SIM, which is no Georgian mobile, as it is written', () => {
    expect(trackerCorrection({ imei: A, simPhone: '7001234' }, { simPhone: '7001234' })).toBeNull();
    expect(trackerCorrection({ imei: A, simPhone: '7001234' }, { simPhone: '7001235' })).toEqual({ simPhone: '7001235' });
  });

  it('gives a tracker kept without a SIM its SIM', () => {
    expect(trackerCorrection({ imei: A, simPhone: null }, { simPhone: '555010203' })).toEqual({ simPhone: '555010203' });
  });
});

describe('what of a tracker the journal keeps (ADR-0036 §7)', () => {
  it('is the last four digits of each number, named — never the number', () => {
    const tails = trackerTails({ imei: A, simPhone: '+995555010203' });
    expect(tails).toEqual({ imei: 'IMEI ···0010', sim: 'SIM ···0203' });
    expect(JSON.stringify(tails)).not.toContain(A);
    expect(JSON.stringify(tails)).not.toContain('555010203');
  });

  it('names only what it is given', () => {
    expect(trackerTails({ simPhone: '555010204' })).toEqual({ sim: 'SIM ···0204' });
    expect(trackerTails({ imei: B, simPhone: null })).toEqual({ imei: 'IMEI ···0028' });
  });

  it('files a tracker written as something that happened, and a correction as a change', () => {
    expect(journalKind('tracker.write')).toBe('event');
    expect(journalKind('tracker.correct')).toBe('change');
  });
});
