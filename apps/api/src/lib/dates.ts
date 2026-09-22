import { todayISO, type ISODate } from '@ev8/shared';
import { env } from './env.js';

/** A `date` column comes back as a Date at UTC midnight; hand out the calendar date. */
export function isoDate(d: Date | null | undefined): ISODate | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** The reverse, for writes: a calendar date as the UTC midnight Prisma expects for `date`. */
export function dateFromISO(s: ISODate | null | undefined): Date | null {
  return s ? new Date(`${s}T00:00:00Z`) : null;
}

/**
 * Which of the company's days an instant fell on (QA-W6-18, QA-W6-19).
 *
 * A `timestamptz` is a moment, not a day, and slicing its ISO string names
 * the UTC day: between 20:00 UTC and midnight that is yesterday in Tbilisi,
 * so a feed showed a return on the 21st beside the act it produced on the
 * 22nd. Use this for anything with a time in it; `isoDate` is for the `date`
 * columns, which carry no time to get wrong.
 */
export function dayOf(at: Date | null | undefined): ISODate | null {
  return at ? todayISO(at, env.TZ) : null;
}
