import type { ISODate } from '@ev8/shared';

/** A `date` column comes back as a Date at UTC midnight; hand out the calendar date. */
export function isoDate(d: Date | null | undefined): ISODate | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** The reverse, for writes: a calendar date as the UTC midnight Prisma expects for `date`. */
export function dateFromISO(s: ISODate | null | undefined): Date | null {
  return s ? new Date(`${s}T00:00:00Z`) : null;
}
