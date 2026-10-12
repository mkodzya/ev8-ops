// Weekly rental periods (spec RNT-02). A period is 7 calendar days counted
// from the pickup date, so a rental picked up on the 18th has periods
// 18–24, 25–31, … The worker creates the next one every night while the
// rental is active; "paid through" is the end of the last fully paid period.
import { addDays, daysBetween, minDate } from './time.js';
import type { ISODate, PeriodPayStatus } from './types.js';

export const PERIOD_DAYS = 7;

export interface PeriodBounds {
  /** 1-based. Stored on the row so re-runs are idempotent. */
  seq: number;
  startsOn: ISODate;
  /** Inclusive: the 7th day of the period. */
  endsOn: ISODate;
}

export function periodBounds(pickedUpOn: ISODate, seq: number): PeriodBounds {
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`period seq must be a positive integer, got ${seq}`);
  const startsOn = addDays(pickedUpOn, PERIOD_DAYS * (seq - 1));
  return { seq, startsOn, endsOn: addDays(startsOn, PERIOD_DAYS - 1) };
}

/**
 * Every period that should exist for a rental as of `asOf`: the one containing
 * the pickup day, and each following one whose first day is not after
 * `asOf`. A returned rental stops at the period containing the return day.
 *
 * Acceptance (RNT-02): picked up 2026-07-18, as of 2026-09-13 → 9 periods.
 */
export function periodsThrough(pickedUpOn: ISODate, asOf: ISODate, returnedOn?: ISODate | null): PeriodBounds[] {
  const last = returnedOn ? minDate(asOf, returnedOn) : asOf;
  if (last < pickedUpOn) return [];
  const count = Math.floor(daysBetween(pickedUpOn, last) / PERIOD_DAYS) + 1;
  const out: PeriodBounds[] = [];
  for (let seq = 1; seq <= count; seq++) out.push(periodBounds(pickedUpOn, seq));
  return out;
}

/** Which period (1-based) a date falls in, or 0 before pickup. */
export function periodSeqOf(pickedUpOn: ISODate, date: ISODate): number {
  const days = daysBetween(pickedUpOn, date);
  return days < 0 ? 0 : Math.floor(days / PERIOD_DAYS) + 1;
}

export function periodPayStatus(amountTetri: number, paidTetri: number): PeriodPayStatus {
  // A week at nothing — a pause or a dispute lifted, a rate of 0, a week a
  // late return replaced — asks for nothing, so it is paid: "paid through"
  // walks over it, as the calendar skips it (ADR-0017).
  if (amountTetri <= 0) return 'paid';
  if (paidTetri <= 0) return 'unpaid';
  return paidTetri >= amountTetri ? 'paid' : 'partial';
}

/**
 * "Paid through" = the last day of the last period in an unbroken run of
 * fully paid periods from the first. A paid week after an unpaid one does
 * not move the date: the debt is the earlier week, and the customer is
 * behind from its end.
 */
export function paidThrough(periods: { seq: number; endsOn: ISODate; payStatus: PeriodPayStatus }[]): ISODate | null {
  const sorted = [...periods].sort((a, b) => a.seq - b.seq);
  let through: ISODate | null = null;
  let expected = 1;
  for (const p of sorted) {
    if (p.seq !== expected || p.payStatus !== 'paid') break;
    through = p.endsOn;
    expected++;
  }
  return through;
}

/**
 * The day a running rental's rent is due: the first day of its oldest week not
 * fully paid — the day after "paid through", or the pickup day while no week
 * is paid. The week may have a row or not yet (today's before the 00:10 roll).
 */
export function rentDueOn(paidThroughDate: ISODate | null, pickedUpOn: ISODate): ISODate {
  return paidThroughDate ? addDays(paidThroughDate, 1) : pickedUpOn;
}

/** Days a rental is late: 0 on its due day and before it, 1 the day after (ADR-0017). */
export function overdueDays(paidThroughDate: ISODate | null, pickedUpOn: ISODate, today: ISODate): number {
  return Math.max(0, daysBetween(rentDueOn(paidThroughDate, pickedUpOn), today));
}
