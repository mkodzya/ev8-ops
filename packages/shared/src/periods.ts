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

// ---------------------------------------------------------------------------
// The day of the week the rent is due (ADR-0021)
// ---------------------------------------------------------------------------
//
// A week runs from the pickup's weekday, and its rent was due on its first
// day. Some renters pay on another weekday by agreement (Mika, 14.10.2026:
// one on Wednesday for a week from Tuesday, one on Thursday for a week from
// Monday). The weeks do not move — what was paid stays paid, "paid through"
// is still the end of a week — only the day each week's rent is due does:
// the first day of the week that is that weekday, 0–6 days after its start.

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: ISODate): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * How many days after its first day a week's rent is due: 0 when the rental
 * names no pay day or names the pickup's own weekday.
 */
export function payOffsetDays(pickedUpOn: ISODate | null, payWeekday: number | null | undefined): number {
  if (!pickedUpOn || payWeekday == null) return 0;
  return (((payWeekday - isoWeekday(pickedUpOn)) % 7) + 7) % 7;
}

/** The day a week's rent is due: its first day, or the pay day within it. */
export function weekDueOn(startsOn: ISODate, offsetDays = 0): ISODate {
  return offsetDays > 0 ? addDays(startsOn, offsetDays) : startsOn;
}

/**
 * The day a running rental's rent is due: in its oldest week not fully paid —
 * the week after "paid through", or the first week while none is paid — the
 * first day, or the pay day within it (ADR-0021). The week may have a row or
 * not yet (today's before the 00:10 roll).
 */
export function rentDueOn(paidThroughDate: ISODate | null, pickedUpOn: ISODate, offsetDays = 0): ISODate {
  return weekDueOn(paidThroughDate ? addDays(paidThroughDate, 1) : pickedUpOn, offsetDays);
}

/** Days a rental is late: 0 on its due day and before it, 1 the day after (ADR-0017). */
export function overdueDays(paidThroughDate: ISODate | null, pickedUpOn: ISODate, today: ISODate, offsetDays = 0): number {
  return Math.max(0, daysBetween(rentDueOn(paidThroughDate, pickedUpOn, offsetDays), today));
}
