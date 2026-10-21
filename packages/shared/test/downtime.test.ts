// Repair downtime in hours by Asia/Tbilisi (stage 6; ADR-0038 §5): from the
// minute it opened to the minute it closed, the wait for the approval apart,
// cut to a period by the company's days — and no hours at all where the
// minutes cannot be trusted, never hours made up from days.
import { describe, expect, it } from 'vitest';
import { downtimeInPeriod, repairDowntime, type RepairClock } from '../src/index.js';

const T = (s: string) => `${s}+04:00`;
/** The repair of the plan's example: opened at 23:30 one evening, closed at 01:30 the next night. */
const night: RepairClock = {
  status: 'done',
  openedOn: '2026-10-18',
  closedOn: '2026-10-19',
  openedAt: T('2026-10-18T23:30:00'),
  approvedAt: T('2026-10-18T23:40:00'),
  rejectedAt: null,
  closedAt: T('2026-10-19T01:30:00'),
};
const NOW = new Date(T('2026-10-21T12:00:00'));

describe('the hours of one repair', () => {
  it('counts across Tbilisi midnight: 23:30 to 01:30 is 120 minutes, ten of them waiting', () => {
    expect(repairDowntime(night, NOW)).toEqual({ minutes: 120, waitMinutes: 10, running: false });
  });

  it('a whole working day: 23:30 to 10:00 is ten and a half hours', () => {
    const j = { ...night, closedAt: T('2026-10-19T10:00:00') };
    expect(repairDowntime(j, NOW)?.minutes).toBe(630);
  });

  it('waits to the first approval, to the refusal, until now while waiting — and not at all when opened in work', () => {
    // Refused: cancelled with who and when; it waited until then and stood until then.
    const refused = { ...night, status: 'cancelled', approvedAt: null, rejectedAt: T('2026-10-19T00:15:00'), closedAt: T('2026-10-19T00:15:00') };
    expect(repairDowntime(refused, NOW)).toEqual({ minutes: 45, waitMinutes: 45, running: false });
    // Still waiting: both run to now.
    const waiting = { ...night, status: 'draft', closedOn: null, approvedAt: null, closedAt: null, openedOn: '2026-10-21', openedAt: T('2026-10-21T09:00:00') };
    expect(repairDowntime(waiting, NOW)).toEqual({ minutes: 180, waitMinutes: 180, running: true });
    // A work found later sent it back to waiting: the wait is the first one, the repair runs on.
    expect(repairDowntime({ ...waiting, approvedAt: T('2026-10-21T09:20:00') }, NOW)).toEqual({ minutes: 180, waitMinutes: 20, running: true });
    // Opened in work by an owner: never waited.
    const owners = { ...night, approvedAt: null };
    expect(repairDowntime(owners, NOW)).toEqual({ minutes: 120, waitMinutes: 0, running: false });
    // In work now: runs to now.
    expect(repairDowntime({ ...night, status: 'open', closedOn: null, closedAt: null }, NOW)?.running).toBe(true);
  });

  it('has no hours without the minute of opening, or where a day was written in afterwards', () => {
    // A repair from before stage 2.
    expect(repairDowntime({ ...night, openedAt: null }, NOW)).toBeNull();
    // Opened today, but the owner said it opened on the 10th.
    expect(repairDowntime({ ...night, openedOn: '2026-10-10' }, NOW)).toBeNull();
    // Closed tonight, but the owner said it was finished on the 20th.
    expect(repairDowntime({ ...night, closedOn: '2026-10-20' }, NOW)).toBeNull();
    // Closed before stage 3: only the day.
    expect(repairDowntime({ ...night, closedAt: null }, NOW)).toBeNull();
  });

  it('reads the day of a minute in Tbilisi: 23:30 there is still the 18th, though in UTC it is 19:30', () => {
    expect(repairDowntime({ ...night, openedOn: '2026-10-19' }, NOW)).toBeNull();
  });
});

describe('the hours of a period, cut by Tbilisi days', () => {
  it('splits the night repair between its two days', () => {
    expect(downtimeInPeriod([night], '2026-10-18', '2026-10-18', NOW)).toEqual({ minutes: 30, waitMinutes: 10, counted: 1, unknown: 0 });
    expect(downtimeInPeriod([night], '2026-10-19', '2026-10-19', NOW)).toEqual({ minutes: 90, waitMinutes: 0, counted: 1, unknown: 0 });
    expect(downtimeInPeriod([night], '2026-10-18', '2026-10-19', NOW)).toEqual({ minutes: 120, waitMinutes: 10, counted: 1, unknown: 0 });
    expect(downtimeInPeriod([night], '2026-10-17', '2026-10-17', NOW)).toEqual({ minutes: 0, waitMinutes: 0, counted: 0, unknown: 0 });
    expect(downtimeInPeriod([night], '2026-10-20', '2026-10-26', NOW).counted).toBe(0);
  });

  it('cuts a running repair at the end of the period, and runs one in it to now', () => {
    const running = { ...night, status: 'open', closedOn: null, closedAt: null };
    // The 19th ends at 24:00 Tbilisi: 23:30 the 18th to then is a day and half an hour.
    expect(downtimeInPeriod([running], '2026-10-18', '2026-10-19', NOW).minutes).toBe(30 + 24 * 60);
    // To now (the 21st, 12:00): two days, twelve and a half hours.
    expect(downtimeInPeriod([running], '2026-10-15', '2026-10-21', NOW).minutes).toBe(30 + 2 * 24 * 60 + 12 * 60);
  });

  it('counts a repair with no hours apart, as unknown — never as nought — and only if its days touch the period', () => {
    const old = { ...night, openedAt: null };
    expect(downtimeInPeriod([night, old], '2026-10-18', '2026-10-19', NOW)).toEqual({ minutes: 120, waitMinutes: 10, counted: 1, unknown: 1 });
    expect(downtimeInPeriod([old], '2026-10-20', '2026-10-26', NOW).unknown).toBe(0);
    // Still open by its days, with no minute of opening.
    expect(downtimeInPeriod([{ ...old, status: 'open', closedOn: null, closedAt: null }], '2026-10-20', '2026-10-26', NOW).unknown).toBe(1);
  });

  it('leaves out a repair called off by mistake, and keeps a refused one', () => {
    const calledOff = { ...night, status: 'cancelled' };
    const refused = { ...night, status: 'cancelled', approvedAt: null, rejectedAt: T('2026-10-19T00:15:00'), closedAt: T('2026-10-19T00:15:00') };
    expect(downtimeInPeriod([calledOff], '2026-10-18', '2026-10-19', NOW)).toEqual({ minutes: 0, waitMinutes: 0, counted: 0, unknown: 0 });
    expect(downtimeInPeriod([refused], '2026-10-18', '2026-10-19', NOW)).toEqual({ minutes: 45, waitMinutes: 45, counted: 1, unknown: 0 });
  });
});
