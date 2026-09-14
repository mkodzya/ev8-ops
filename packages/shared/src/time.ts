import { ORG_TZ, type ISODate } from './types.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(s: string): s is ISODate {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today as a calendar date in the company's zone, whatever the server's clock says. */
export function todayISO(now: Date = new Date(), tz: string = ORG_TZ): ISODate {
  return now.toLocaleDateString('en-CA', { timeZone: tz });
}

/** Calendar arithmetic on dates, done in UTC so daylight-saving never eats a day. */
export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}
