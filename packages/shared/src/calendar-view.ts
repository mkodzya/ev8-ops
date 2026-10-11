// What the payments calendar's screen has to decide that is not money
// (docs/redesign/payments-calendar.md §3.3, §3.5): reading its address,
// stepping a week or a month, which cells a grid has, the order of the rows in
// a day, the two folds. The sums are `calendar.ts`'s and the server's; nothing
// here adds one up.
//
// It lives in shared, not in the page, for the reason `paymentsQuery` does:
// screens have no tests, and each of these is a rule a person will notice
// broken — an arrow that walks past the months the API answers for, a week
// on the edge of two months drawn with three days missing.
//
// No clock, no locale and no `Date` in it: days go through the shared helpers,
// and the order of two names comes in as a comparator, because the name on
// screen depends on the interface language and this file knows neither.
import { CALENDAR_FIRST_DAY, calendarGrid, type CalendarEntry, type CalendarLate, type CalendarState } from './calendar.js';
import { addMonths } from './sales.js';
import { addDays, daysBetween, isISODate, minDate } from './time.js';
import { inPeriod, monthOf, weekOf, type Period } from './week.js';
import type { ISODate } from './types.js';

/** The whole state the address carries: the chosen day, and whether a phone shows the month. */
export interface CalendarView {
  day: ISODate;
  all: boolean;
}

/** How far the arrows go: back to the month of the earliest hand-over still running, three months ahead. */
export function calendarLimits(today: ISODate, firstPickupOn: ISODate | null): Period {
  return { from: monthOf(minDate(firstPickupOn ?? today, today)).from, to: monthOf(addMonths(today, 3)).to };
}

/**
 * A day the API answers for. Past the forward limit it refuses the range; and
 * below its floor too — there the Monday of a month's first week can lie
 * before `CALENDAR_FIRST_DAY` although the day itself does not.
 *
 * `toWeekEnd`: a chosen day may also be one of the days the limit's own week
 * runs on past it. A phone draws that week whole (§3.5.6), each of its days
 * with a payment is a button, and what a button writes into the address has
 * to read back.
 */
function answered(day: ISODate, today: ISODate, toWeekEnd = false): boolean {
  const to = calendarLimits(today, null).to;
  if (day < CALENDAR_FIRST_DAY || day > (toWeekEnd ? weekOf(to).to : to)) return false;
  return calendarGrid(day).from >= CALENDAR_FIRST_DAY;
}

/**
 * The address as a day and a mode. `d` is the chosen day; without it the day
 * is today, or the 1st of `m` when `m` names another month; `d` outside `m`
 * wins over it. A value that does not read, or a day no answer exists for,
 * counts as absent.
 */
export function calendarViewOf(read: (key: 'm' | 'd' | 'all') => string | null, today: ISODate): CalendarView {
  const all = read('all') === '1';
  const d = read('d') ?? '';
  if (isISODate(d) && answered(d, today, true)) return { day: d, all };
  const first = `${read('m') ?? ''}-01`;
  if (isISODate(first) && first !== monthOf(today).from && answered(first, today)) return { day: first, all };
  return { day: today, all };
}

/** Only what differs from "today, this month, one week" — so the plain address is the plain screen. */
export function calendarViewParams(v: CalendarView, today: ISODate): { m?: string; d?: ISODate; all?: '1' } {
  const out: { m?: string; d?: ISODate; all?: '1' } = {};
  if (v.day.slice(0, 7) !== today.slice(0, 7)) out.m = v.day.slice(0, 7);
  if (v.day !== today) out.d = v.day;
  if (v.all) out.all = '1';
  return out;
}

/** One step of an arrow: the same weekday a week away, or the same number a month away (the last day when there is none). */
export function calendarStep(day: ISODate, dir: 1 | -1, by: 'week' | 'month'): ISODate {
  return by === 'week' ? addDays(day, 7 * dir) : addMonths(day, dir);
}

/**
 * Whether an arrow has somewhere to go. Each arrow answers to its own limit
 * only, so a day outside them — an address typed by hand — can still be
 * walked back in.
 *
 * A week's step is measured by the week it lands in, not by the day: the row
 * on screen is seven days, and the week that holds a limit's first or last
 * days is reached from whichever weekday is chosen.
 */
export function calendarCanStep(day: ISODate, dir: 1 | -1, by: 'week' | 'month', limits: Period): boolean {
  const next = calendarStep(day, dir, by);
  if (by === 'week') return dir < 0 ? weekOf(next).to >= limits.from : weekOf(next).from <= limits.to;
  return dir < 0 ? next >= limits.from : next <= limits.to;
}

/**
 * Whether an answer already holds the week `day` is in — whole: its totals,
 * its days, their rows and the Monday after. A week on the edge of two months
 * is in both months' answers, and the week of today is in every answer, so a
 * phone showing one week goes on drawing it from the answer it has while the
 * month of the newly chosen day loads.
 */
export function calendarHoldsWeek(cal: { weeks: readonly Period[] }, day: ISODate): boolean {
  const from = weekOf(day).from;
  return cal.weeks.some((w) => w.from === from);
}

/**
 * The cells of a grid. 'week': the seven real days of the week `day` is in,
 * whatever month they belong to. 'month': the month's weeks day by day, null
 * where a day belongs to a neighbouring month — that cell is drawn empty.
 */
export function calendarCells(day: ISODate, mode: 'week' | 'month'): (ISODate | null)[] {
  const span = mode === 'week' ? weekOf(day) : calendarGrid(day);
  const month = monthOf(day);
  const out: (ISODate | null)[] = [];
  for (let d = span.from; d <= span.to; d = addDays(d, 1)) out.push(mode === 'week' || inPeriod(month, d) ? d : null);
  return out;
}

/** Where a day stands against the week of TODAY — never against the chosen day (§3.3 "текущая неделя"). */
export function calendarCellKind(date: ISODate, today: ISODate): 'past' | 'current' | 'ahead' {
  const cur = weekOf(today);
  return date < cur.from ? 'past' : date > cur.to ? 'ahead' : 'current';
}

/** 0 = Monday … 6 = Sunday. */
export function calendarWeekday(date: ISODate): number {
  return daysBetween(weekOf(date).from, date);
}

/** The days "Пришло денег" names: the week's Monday … today at the latest; null for a week wholly ahead (§4.6). */
export function calendarReceivedPeriod(week: Period, today: ISODate): Period | null {
  return week.from > today ? null : { from: week.from, to: minDate(week.to, today) };
}

const GROUP: Record<CalendarState, number> = { overdue: 0, due_today: 1, expected: 2, paid: 3, paid_ahead: 3 };

/**
 * The rows of one day in the order they are read (§3.5.9): the overdue — the
 * longest first, then the larger debt; then who is due today or expected, in
 * the screen's order of names; then the paid ones as the money came, a week
 * with no payment last. `compare` is the screen's order of two rentals — by
 * the name it shows, then by rental number. Rows it does not tell apart keep
 * the order they came in, which is the server's.
 */
export function calendarDayRows(
  entries: readonly CalendarEntry[],
  late: readonly CalendarLate[],
  compare: (aRentalId: string, bRentalId: string) => number,
): CalendarEntry[] {
  const lateOf = new Map(late.map((l) => [l.rentalId, l]));
  const days = (e: CalendarEntry): number => lateOf.get(e.rentalId)?.days ?? 0;
  const debt = (e: CalendarEntry): number => lateOf.get(e.rentalId)?.debtTetri ?? 0;
  return [...entries].sort((a, b) => {
    const group = GROUP[a.state] - GROUP[b.state];
    if (group !== 0) return group;
    if (a.state === 'overdue') return days(b) - days(a) || debt(b) - debt(a) || compare(a.rentalId, b.rentalId);
    if (GROUP[a.state] < 3) return compare(a.rentalId, b.rentalId);
    if (a.paidOn === null || b.paidOn === null) {
      return a.paidOn === b.paidOn ? compare(a.rentalId, b.rentalId) : Number(a.paidOn === null) - Number(b.paidOn === null);
    }
    return a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : 0;
  });
}

/**
 * A long day (§3.5.8): with more than `limit` rows the paid ones fold into one
 * line; whoever still owes is always shown.
 */
export function calendarFold(rows: readonly CalendarEntry[], limit = 6): { shown: CalendarEntry[]; folded: CalendarEntry[] } {
  if (rows.length <= limit) return { shown: [...rows], folded: [] };
  const paid = (e: CalendarEntry): boolean => GROUP[e.state] === 3;
  return { shown: rows.filter((e) => !paid(e)), folded: rows.filter(paid) };
}

/** The laptop's "Просрочено" shows this many until asked for all (§3.5.10). */
export const CALENDAR_LATE_SHOWN = 5;

export function calendarLateShown<T>(rows: readonly T[], whole: boolean, limit: number = CALENDAR_LATE_SHOWN): { shown: T[]; hidden: number } {
  if (whole || rows.length <= limit) return { shown: [...rows], hidden: 0 };
  return { shown: rows.slice(0, limit), hidden: rows.length - limit };
}

/**
 * "за N недели" may follow the debt only when the debt IS those weeks (§3.4):
 * more than one overdue week, and the rental's one debt figure equal to what
 * they have left. Otherwise null — an unpaid deposit, a return charge, credit
 * not placed yet or a week with no row is inside one figure and not the other.
 */
export function calendarDebtWeeks(late: CalendarLate): number | null {
  return late.weeks > 1 && late.debtTetri === late.overdueTetri ? late.weeks : null;
}

/** Which keys of the legend the cells on screen justify (§3.5.6). */
export function calendarLegend(
  cells: readonly (ISODate | null)[],
  today: ISODate,
): { counts: boolean; allPaid: boolean; late: boolean; today: boolean; aheadOnly: boolean } {
  const days = cells.filter((c): c is ISODate => c !== null);
  const kinds = days.map((d) => calendarCellKind(d, today));
  return {
    // "1 из 3" stands only in the days of the current week,
    counts: kinds.includes('current'),
    // the tick "all paid" only in the weeks before it,
    allPaid: kinds.includes('past'),
    // and nothing after today can be overdue.
    late: days.some((d) => d <= today),
    today: days.includes(today),
    aheadOnly: days.length > 0 && kinds.every((k) => k === 'ahead'),
  };
}
