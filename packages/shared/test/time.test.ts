import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, localDateTime, todayISO } from '../src/index.js';

// The company's day is Tbilisi's (CLAUDE.md). Everything the product records
// happened on that day, whoever is reading about it and from where.
describe('the company clock', () => {
  /**
   * QA-W6-18, with the instant from the report: a return written at
   * 2026-09-21 23:34:03 UTC. Three clocks give three answers, and the journal
   * used to print the UTC date beside the London time — a day that existed on
   * neither.
   */
  const at = '2026-09-21T23:34:03.000Z';

  it('names the Tbilisi day and the Tbilisi hour', () => {
    expect(localDateTime(at)).toEqual({ date: '22.09.2026', time: '03:34' });
  });

  it('gives the same answer wherever it is read from', () => {
    // The function takes no notice of the machine; a zone is asked for by name.
    expect(localDateTime(at, 'Europe/London')).toEqual({ date: '22.09.2026', time: '00:34' });
    expect(localDateTime(at, 'UTC')).toEqual({ date: '21.09.2026', time: '23:34' });
    // And the default is the company's, not the machine's.
    expect(localDateTime(at)).toEqual(localDateTime(at, 'Asia/Tbilisi'));
  });

  it('keeps the date and the time from the same clock — the bug was mixing two', () => {
    const shown = localDateTime(at);
    const utcDate = at.slice(0, 10).split('-').reverse().join('.');
    // What the journal printed: a UTC date beside a non-UTC time.
    expect(`${utcDate} ${localDateTime(at, 'Europe/London').time}`).toBe('21.09.2026 00:34');
    // What it prints now.
    expect(`${shown.date} ${shown.time}`).toBe('22.09.2026 03:34');
  });

  it('a minute before midnight in Tbilisi is still today there', () => {
    expect(localDateTime('2026-09-21T19:59:00.000Z').date).toBe('21.09.2026'); // 23:59 Tbilisi
    expect(localDateTime('2026-09-21T20:01:00.000Z').date).toBe('22.09.2026'); // 00:01 Tbilisi
  });

  it('todayISO answers in the company zone too', () => {
    expect(todayISO(new Date('2026-09-21T20:01:00.000Z'))).toBe('2026-09-22');
    expect(todayISO(new Date('2026-09-21T19:59:00.000Z'))).toBe('2026-09-21');
  });

  it('calendar arithmetic does not lose a day to daylight saving', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(daysBetween('2026-03-28', '2026-03-29')).toBe(1);
  });
});
