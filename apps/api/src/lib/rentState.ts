import { effectiveRentalStatus, overdueDays, type ISODate, type RentalStatus } from '@ev8/shared';
import { isoDate } from './dates.js';

/**
 * What a rental is called today and how many days it is late — the one place
 * the routes ask (ADR-0017). The list, the card, "Today", the customers, the
 * vehicle card and the overdue totals used to work this out four times over,
 * and three more screens printed the stored status, which never says overdue.
 */
export function rentStateOf(
  r: { status: string; paidThrough: Date | null; pickedUpOn: Date | null },
  today: ISODate,
): { status: RentalStatus; overdueDays: number } {
  const paidThrough = isoDate(r.paidThrough);
  const pickedUpOn = isoDate(r.pickedUpOn);
  const status = effectiveRentalStatus(r.status as RentalStatus, paidThrough, pickedUpOn, today);
  return { status, overdueDays: status === 'overdue' && pickedUpOn ? overdueDays(paidThrough, pickedUpOn, today) : 0 };
}
