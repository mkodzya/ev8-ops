// The due day beside the one debt figure (ADR-0017; docs/redesign/due-today.md).
//
// A week is owed from its first day, so the figure of `customerDebt` holds it
// from that morning — and the figure does not change here. What changes is
// what the figure is called: on the due day the money is awaited, not late.
// These functions say how much of the figure is awaited today, so a screen
// can print it calmly only when the whole figure is that.
import type { Debt } from './debt.js';
import type { Tetri } from './money.js';
import type { ISODate, RentalStatus } from './types.js';

/** A rental as the due-day rule needs it: its EFFECTIVE status and its pickup day. */
export interface DueRental {
  id: string;
  status: RentalStatus;
  pickedUpOn: ISODate | null;
}

export interface DueToday {
  /** Of `debt.owesTetri`: money awaited today and not late. Never above owesTetri. */
  tetri: Tetri;
  /** Of `tetri`: the rent alone, without a hand-over-day deposit. Read by the hand-over guard. */
  rentTetri: Tetri;
  /** `tetri` by rental, before the customer's credit: a part of that rental's debt. */
  byRental: Record<string, Tetri>;
}

/**
 * How much of a customer's one figure is awaited today (ADR-0017). Awaited:
 * the rent part of a rental whose status is `due_today` — that is the week
 * that began today — and, on the hand-over day itself, its deposit part.
 * Everything else is debt as before: older weeks, a deposit short since an
 * earlier day, return charges, a sale, a repair. The figure is not touched:
 * this only says what it is made of. Credit comes off the older debt first,
 * the order `settleCredit` works in.
 */
export function dueTodayOf(debt: Debt, rentals: readonly DueRental[], today: ISODate): DueToday {
  const byRental: Record<string, Tetri> = {};
  let rent = 0;
  for (const r of rentals) {
    if (r.status !== 'due_today') continue;
    const mine = debt.parts.filter((p) => p.id === r.id);
    const rentPart = mine.filter((p) => p.kind === 'rent').reduce((n, p) => n + p.owesTetri, 0);
    const depositPart = r.pickedUpOn === today ? mine.filter((p) => p.kind === 'deposit').reduce((n, p) => n + p.owesTetri, 0) : 0;
    if (rentPart + depositPart > 0) byRental[r.id] = rentPart + depositPart;
    rent += rentPart;
  }
  const gross = debt.parts.reduce((n, p) => n + p.owesTetri, 0);
  // What the customer's own credit took off the gross: never below nought.
  const creditUsed = gross - debt.owesTetri;
  // The figure less the older debt the credit did not reach.
  const left = (awaited: Tetri) => debt.owesTetri - Math.max(0, gross - awaited - creditUsed);
  const all = Object.values(byRental).reduce((n, v) => n + v, 0);
  return { tetri: left(all), rentTetri: left(rent), byRental };
}

/**
 * Of the one figure: what makes a new hand-over an owner's decision with a
 * reason (В2, Mika 17.09.2026). ONE place, read by the server's guard and by
 * the hand-over wizard, so the screen and the answer cannot part.
 * It is the whole figure: the right is unchanged until the owner says
 * otherwise. `dueTodayRentTetri` — the rent of a week that began today,
 * without a hand-over-day deposit — is what the owner is asked about, and it
 * is not read until the owner has answered.
 */
export function handOverBlockTetri(owesTetri: Tetri, dueTodayRentTetri: Tetri): Tetri {
  return owesTetri;
}

export type WeekDue = 'paid' | 'late' | 'due_today' | 'ahead' | 'none';

export interface DueWeek {
  seq: number;
  startsOn: ISODate;
  amountTetri: Tetri;
  paidTetri: Tetri;
}

/**
 * One stored week by the due-day rule — the calendar's rule on rows. none: a
 * week at nothing; paid: nothing left; ahead: begins after today; late: began
 * before today, or began today while an older week of the same rental is not
 * fully paid; due_today: began today, nothing older open.
 * It does not know the rental's status: a screen prints `due_today` only for
 * a rental that IS due today.
 */
export function weekDue(week: DueWeek, all: readonly DueWeek[], today: ISODate): WeekDue {
  if (week.amountTetri <= 0) return 'none';
  if (week.paidTetri >= week.amountTetri) return 'paid';
  if (week.startsOn > today) return 'ahead';
  if (week.startsOn < today) return 'late';
  return all.some((w) => w.seq < week.seq && w.amountTetri > 0 && w.paidTetri < w.amountTetri) ? 'late' : 'due_today';
}
