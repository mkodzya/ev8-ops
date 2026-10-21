import { describe, expect, it } from 'vitest';
import { addDays, dayStart, daysBetween, localDateTime, minutesBetween, todayISO } from '../src/index.js';

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

// Stage 6 (ADR-0038 §5): repair hours are minutes between two instants, cut
// to the company's days only when a period asks for them.
describe('minutes and the start of a day', () => {
  it('counts whole minutes, never below nought', () => {
    expect(minutesBetween('2026-10-18T23:30:00+04:00', '2026-10-19T01:30:00+04:00')).toBe(120);
    expect(minutesBetween(new Date('2026-10-19T10:00:00Z'), new Date('2026-10-19T10:00:59Z'))).toBe(0);
    expect(minutesBetween('2026-10-19T10:00:00Z', '2026-10-19T10:01:59Z')).toBe(1);
    expect(minutesBetween('2026-10-19T10:00:00Z', '2026-10-19T09:00:00Z')).toBe(0);
  });

  it('a Tbilisi day starts at 20:00 UTC the evening before', () => {
    expect(dayStart('2026-10-19').toISOString()).toBe('2026-10-18T20:00:00.000Z');
    expect(dayStart('2026-01-01', 'Asia/Tbilisi').toISOString()).toBe('2025-12-31T20:00:00.000Z');
    expect(todayISO(dayStart('2026-10-19'))).toBe('2026-10-19');
    expect(todayISO(new Date(dayStart('2026-10-19').getTime() - 1))).toBe('2026-10-18');
  });

  it('reads the offset from the zone, so a zone that moves its clock gets its own midnight', () => {
    expect(dayStart('2026-10-19', 'UTC').toISOString()).toBe('2026-10-19T00:00:00.000Z');
    // London at midnight is GMT on the morning the clocks go forward, BST on the one they go back.
    expect(dayStart('2026-03-29', 'Europe/London').toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(dayStart('2026-10-25', 'Europe/London').toISOString()).toBe('2026-10-24T23:00:00.000Z');
  });
});
