import { effectiveRentalStatus, overdueDays, payOffsetDays, weeksAnchor, type ISODate, type RentalStatus } from '@ev8/shared';
import { isoDate } from './dates.js';

/**
 * What a rental is called today and how many days it is late — the one place
 * the routes ask (ADR-0017). The list, the card, "Today", the customers, the
 * vehicle card and the overdue totals used to work this out four times over,
 * and three more screens printed the stored status, which never says overdue.
 * The rental's pay day moves the day its rent is due within the week
 * (ADR-0022), and a week made longer moves the weekday the weeks start on
 * (ADR-0041), so every query that asks here reads `payWeekday` and
 * `weekShiftDays` too.
 */
export function rentStateOf(
  r: { status: string; paidThrough: Date | null; pickedUpOn: Date | null; payWeekday: number | null; weekShiftDays: number },
  today: ISODate,
): { status: RentalStatus; overdueDays: number } {
  const paidThrough = isoDate(r.paidThrough);
  const pickedUpOn = isoDate(r.pickedUpOn);
  const offset = payOffsetOf(r);
  const status = effectiveRentalStatus(r.status as RentalStatus, paidThrough, pickedUpOn, today, offset);
  return { status, overdueDays: status === 'overdue' && pickedUpOn ? overdueDays(paidThrough, pickedUpOn, today, offset) : 0 };
}

/**
 * Days after a week's first day its rent is due, for a rental as stored
 * (ADR-0022): counted from the weekday the weeks run on now — the pickup's,
 * moved by the days its weeks were made longer (ADR-0041).
 */
export function payOffsetOf(r: { pickedUpOn: Date | null; payWeekday: number | null; weekShiftDays: number }): number {
  return payOffsetDays(weeksAnchor(isoDate(r.pickedUpOn), r.weekShiftDays), r.payWeekday);
}
