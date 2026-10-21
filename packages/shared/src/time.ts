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

/**
 * A moment as it reads in Tbilisi, whatever the clock of the device or the
 * server says: `{ date: '18.09.2026', time: '21:39' }`. Signatures, drafts and
 * deadlines are read by people here (book: Asia/Tbilisi).
 */
export function localDateTime(at: Date | string, tz: string = ORG_TZ): { date: string; time: string } {
  const d = typeof at === 'string' ? new Date(at) : at;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.day}.${parts.month}.${parts.year}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * Whole minutes from `a` to `b`, never below nought (stage 6, ADR-0038 §5).
 * Minutes between two instants are the same in every zone; the zone matters
 * only when they are cut to the company's days.
 */
export function minutesBetween(a: Date | string, b: Date | string): number {
  const ms = (typeof b === 'string' ? Date.parse(b) : b.getTime()) - (typeof a === 'string' ? Date.parse(a) : a.getTime());
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
}

/** How far the zone's clock is ahead of UTC at that instant, in milliseconds. */
function zoneOffsetMs(at: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * The instant a calendar day begins in the company's zone: Tbilisi midnight
 * is 20:00 UTC of the day before. Read from the zone itself rather than a
 * written "+04:00", so a zone that changes its clock still gets its midnight.
 */
export function dayStart(day: ISODate, tz: string = ORG_TZ): Date {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  const guess = utcMidnight - zoneOffsetMs(utcMidnight, tz);
  // The offset at midnight itself, should the zone have moved its clock in between.
  return new Date(utcMidnight - zoneOffsetMs(guess, tz));
}
