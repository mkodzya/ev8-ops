// Weekly rental periods (spec RNT-02). A period is 7 calendar days counted
// from the pickup date, so a rental picked up on the 18th has periods
// 18–24, 25–31, … The worker creates the next one every night while the
// rental is active; "paid through" is the end of the last fully paid period.
//
// An owner may make the running week 1–6 days longer (ADR-0041): that week
// ends later, and every week after it starts as many days later. The weeks
// are then counted from the pickup plus the days earlier weeks gained — the
// `shifts` every function here takes, empty for a rental never moved.
import { addDays, daysBetween, minDate } from './time.js';
import type { Tetri } from './money.js';
import type { ISODate, PeriodPayStatus } from './types.js';

export const PERIOD_DAYS = 7;

export interface PeriodBounds {
  /** 1-based. Stored on the row so re-runs are idempotent. */
  seq: number;
  startsOn: ISODate;
  /** Inclusive: the 7th day of the period, or later for a week made longer (ADR-0041). */
  endsOn: ISODate;
}

/** A week made longer by an owner (ADR-0041): its seq and the days it gained — `rental_periods.extra_days`. */
export interface WeekShift {
  seq: number;
  days: number;
}

/** The longest a week is made: seven more days is simply the next week, unpaid. */
export const MAX_SHIFT_DAYS = 6;

/** A rental's shifts, read off its week rows; a row with no extra days is not one. */
export function shiftsOf(rows: readonly { seq: number; extraDays?: number | null }[]): WeekShift[] {
  return rows.filter((r) => (r.extraDays ?? 0) > 0).map((r) => ({ seq: r.seq, days: r.extraDays ?? 0 }));
}

/**
 * The days of week `seq`: from the pickup, 7 days a week, later by the days
 * the weeks before it gained, and longer by its own (ADR-0041). With no
 * shifts — every rental never moved — exactly the 7-day grid of RNT-02.
 */
export function periodBounds(pickedUpOn: ISODate, seq: number, shifts: readonly WeekShift[] = []): PeriodBounds {
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`period seq must be a positive integer, got ${seq}`);
  let before = 0;
  let own = 0;
  for (const s of shifts) {
    if (s.seq < seq) before += s.days;
    else if (s.seq === seq) own += s.days;
  }
  const startsOn = addDays(pickedUpOn, PERIOD_DAYS * (seq - 1) + before);
  return { seq, startsOn, endsOn: addDays(startsOn, PERIOD_DAYS - 1 + own) };
}

/**
 * Every period that should exist for a rental as of `asOf`: the one containing
 * the pickup day, and each following one whose first day is not after
 * `asOf`. A returned rental stops at the period containing the return day.
 *
 * Acceptance (RNT-02): picked up 2026-07-18, as of 2026-09-13 → 9 periods.
 */
export function periodsThrough(pickedUpOn: ISODate, asOf: ISODate, returnedOn?: ISODate | null, shifts: readonly WeekShift[] = []): PeriodBounds[] {
  const last = returnedOn ? minDate(asOf, returnedOn) : asOf;
  if (last < pickedUpOn) return [];
  const out: PeriodBounds[] = [];
  for (let seq = 1; ; seq++) {
    const b = periodBounds(pickedUpOn, seq, shifts);
    if (b.startsOn > last) break;
    out.push(b);
  }
  return out;
}

/** Which period (1-based) a date falls in, or 0 before pickup. */
export function periodSeqOf(pickedUpOn: ISODate, date: ISODate, shifts: readonly WeekShift[] = []): number {
  const days = daysBetween(pickedUpOn, date);
  if (days < 0) return 0;
  if (shifts.length === 0) return Math.floor(days / PERIOD_DAYS) + 1;
  let seq = 1;
  while (periodBounds(pickedUpOn, seq, shifts).endsOn < date) seq++;
  return seq;
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
// The day of the week the rent is due (ADR-0022)
// ---------------------------------------------------------------------------
//
// A week runs from the pickup's weekday, and its rent was due on its first
// day. Some renters pay on another weekday by agreement (Mika, 14.10.2026:
// one on Wednesday for a week from Tuesday, one on Thursday for a week from
// Monday). The weeks do not move — what was paid stays paid, "paid through"
// is still the end of a week — only the day each week's rent is due does:
// the first day of the week that is that weekday, 0–6 days after its start.
// Moving the weeks themselves is another tool, below (ADR-0041); the pay day
// travels with them and keeps its place within a week.

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: ISODate): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * How many days after its first day a week's rent is due: 0 when the rental
 * names no pay day or names the weeks' own weekday. Pass the day the weeks
 * run from — the pickup, or `weeksAnchor` once a week was moved (ADR-0041).
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
 * first day, or the pay day within it (ADR-0022). The week may have a row or
 * not yet (today's before the 00:10 roll).
 */
export function rentDueOn(paidThroughDate: ISODate | null, pickedUpOn: ISODate, offsetDays = 0): ISODate {
  return weekDueOn(paidThroughDate ? addDays(paidThroughDate, 1) : pickedUpOn, offsetDays);
}

/** Days a rental is late: 0 on its due day and before it, 1 the day after (ADR-0017). */
export function overdueDays(paidThroughDate: ISODate | null, pickedUpOn: ISODate, today: ISODate, offsetDays = 0): number {
  return Math.max(0, daysBetween(rentDueOn(paidThroughDate, pickedUpOn, offsetDays), today));
}

// ---------------------------------------------------------------------------
// Moving the running week (ADR-0041)
// ---------------------------------------------------------------------------
//
// A courier paid for his week three days late and paid for the three days on
// top: 150 + 64 (call of Mika and Kardu, 21.10.2026; Mika's answer «А» the
// same day). The week he is in becomes three days longer and costs the extra;
// every later week, and the day it is paid, starts three days later. What was
// paid for earlier weeks stays where it is. Only the last week of a running
// rental, 1–6 days, by an owner with a reason — never by itself from the size
// of a payment: a bank line comes without a name.

/**
 * The day the weeks of a rental run from now: the pickup, later by every day
 * its weeks gained. Its weekday is the weeks' weekday — what the pay day is
 * counted from (`payOffsetDays`).
 */
export function weeksAnchor(pickedUpOn: ISODate | null, shiftDays = 0): ISODate | null {
  if (!pickedUpOn) return null;
  return shiftDays > 0 ? addDays(pickedUpOn, shiftDays) : pickedUpOn;
}

/** A weekday moved round the week: Saturday (6) + 3 = Tuesday (2). */
export function rotateWeekday(day: number, by: number): number {
  return ((((day - 1 + by) % 7) + 7) % 7) + 1;
}

/**
 * A rental's pay day after its weeks moved `by` days: the same day of the
 * week, moved with them, so it falls as many days into a week as before. No
 * pay day stays none; a day that lands on the weeks' own weekday is kept as
 * none, the rule of `PATCH /api/rentals/:id` (ADR-0022).
 */
export function shiftedPayWeekday(payWeekday: number | null, by: number, anchorAfter: ISODate): number | null {
  if (payWeekday == null) return null;
  const day = rotateWeekday(payWeekday, by);
  return day === isoWeekday(anchorAfter) ? null : day;
}

/**
 * What `days` more days cost by the weekly rate: rate ÷ 7 × days, to whole
 * lari — 150 a week, 3 days → 64. Only the form's suggestion: the sum is
 * typed by a person (Mika, 21.10.2026), as a discount is.
 */
export function shiftExtraTetri(weeklyRateTetri: Tetri, days: number): Tetri {
  return Math.round((weeklyRateTetri * days) / PERIOD_DAYS / 100) * 100;
}

export interface WeekShiftPlan {
  /** The week's last day once it is `days` longer. */
  endsOn: ISODate;
  /** Its length in days: 7 + days. */
  lengthDays: number;
  /** The first day of the week after it, and the day that week is due. */
  nextStartsOn: ISODate;
  nextDueOn: ISODate;
  /** The suggestion for the extra days' price (`shiftExtraTetri`). */
  suggestedExtraTetri: Tetri;
}

/**
 * One arithmetic for the sheet and the server: the week starting `startsOn`
 * made `days` longer (0 — as it was). The pay day keeps its place within a
 * week, so the next week is due `payOffsetDays` after its first day.
 */
export function weekShiftPlan(input: { startsOn: ISODate; days: number; weeklyRateTetri: Tetri; payOffsetDays?: number }): WeekShiftPlan {
  if (!Number.isInteger(input.days) || input.days < 0 || input.days > MAX_SHIFT_DAYS) {
    throw new Error(`a week is made 0–${MAX_SHIFT_DAYS} days longer, got ${input.days}`);
  }
  const endsOn = addDays(input.startsOn, PERIOD_DAYS - 1 + input.days);
  const nextStartsOn = addDays(endsOn, 1);
  return {
    endsOn,
    lengthDays: PERIOD_DAYS + input.days,
    nextStartsOn,
    nextDueOn: weekDueOn(nextStartsOn, input.payOffsetDays ?? 0),
    suggestedExtraTetri: shiftExtraTetri(input.weeklyRateTetri, input.days),
  };
}
