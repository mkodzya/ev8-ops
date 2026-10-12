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
 * this only says what it is made of.
 * The customer's unplaced credit is taken off the awaited money, never off
 * the older debt. The roll puts it on a rental's own deposit, weeks and
 * charges and on nothing else (`settleCredit`): never on a sale or a repair,
 * and not on another rental when the payment names one. So credit is not
 * taken to have cleared an older part: while one is listed in `debt.parts`,
 * the figure is not wholly awaited — it is a debt, as it was.
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
  const all = Object.values(byRental).reduce((n, v) => n + v, 0);
  // The figure less everything older, whole: equal to the figure only when
  // nothing older is listed.
  const tetri = Math.max(0, debt.owesTetri - (gross - all));
  // Of the awaited money credit takes the hand-over-day deposit first — the
  // order a rental's money is spread in — so the rent is the last to go.
  return { tetri, rentTetri: Math.min(rent, tetri), byRental };
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

/**
 * Is there a ready WhatsApp message for a rental in this state today
 * (ADR-0017)? For one that is due today there is none: «Просрочка» calls a
 * week that began this morning a debt, «Завтра оплата» says "tomorrow" with
 * today's date, and a text for the due day itself goes to a customer only
 * after the owner has read it. So the buttons that open the sheet are not
 * drawn for such a rental, and the sheet says so when it is reached by
 * another door.
 * The pickup day and today are asked for already: with the owner's text the
 * rule narrows to the hand-over day, and no caller changes.
 */
export function waOffered(status: string, pickedUpOn: ISODate | null, today: ISODate): boolean {
  return status !== 'due_today';
}

/** A customer's rental as the choice of a message needs it: its EFFECTIVE status and its pickup day. */
export interface WaRental {
  id: string;
  status: string;
  pickedUpOn: ISODate | null;
}

/**
 * The ONE rental a message from a customer's card is about, and whether the
 * card offers a message at all (ADR-0017). The most urgent: an overdue one,
 * then one due today, then any not returned. While that one has no ready
 * message — on its due day — a debtor is not left without the door: another
 * rental of the customer's that holds a part of the figure (`owes`) and has a
 * message takes its place — returned, paused, disputed, or running with a
 * deposit short; «Просрочка» is true of it. `rental: null` with `offered`:
 * nothing is running, and the card writes about no rental in particular, as
 * it did.
 */
export function waRentalOf<R extends WaRental>(rentals: readonly R[], owes: (rentalId: string) => boolean, today: ISODate): { rental: R | null; offered: boolean } {
  const live = rentals.find((r) => r.status === 'overdue') ?? rentals.find((r) => r.status === 'due_today') ?? rentals.find((r) => r.status !== 'returned') ?? null;
  if (!live || waOffered(live.status, live.pickedUpOn, today)) return { rental: live, offered: true };
  const older = rentals.find((r) => r.id !== live.id && waOffered(r.status, r.pickedUpOn, today) && owes(r.id)) ?? null;
  return { rental: older ?? live, offered: older !== null };
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
