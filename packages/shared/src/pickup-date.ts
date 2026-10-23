// The pickup date of a running rental put right (issue #10, ADR-0044 §1).
//
// A rental was entered with the wrong day of hand-over: four days early, so
// its weeks ran four days ahead of the courier's and the screen called him a
// debtor. Mika's «А» of 23.10.2026: an owner gives the rental its true day,
// with a reason. The weeks are counted again from it; each week row keeps its
// number, and the money on it stays with the number — what closed week 2
// closes the new week 2. A week that has not begun by the new day goes, and
// what was paid on it is the customer's money again, placed by the one order
// (`settleCredit`). A week made longer keeps its days with its number
// (ADR-0041); one that would have to go is refused: its move is taken back
// first. A rental carried over keeps «оплачено по» as a date: still a week's
// end, it is kept; not one any more, it is asked again.
import { isoWeekday, periodsThrough, shiftsOf, weeksAnchor, type PeriodBounds } from './periods.js';
import { moneyWithCredit, type MoneyPart, type RentalMoney } from './rental-money.js';
import type { Tetri } from './money.js';
import type { ISODate } from './types.js';

/** A week row as the plan reads it. */
export interface RedateWeek {
  seq: number;
  startsOn: ISODate;
  endsOn: ISODate;
  /** Days it was made longer, below nought shorter (ADR-0041 and its addendum of 23.10.2026). */
  extraDays: number;
  /** Taken off by an owner (migration 0040). */
  discountTetri: Tetri;
  paidBeforeTransfer: boolean;
}

/**
 * The last day a rental carried over was paid through before the transfer:
 * the end of its last week marked paid then (B3-02). Null — none was.
 */
export function transferPaidThrough(weeks: readonly Pick<RedateWeek, 'endsOn' | 'paidBeforeTransfer'>[]): ISODate | null {
  return weeks.filter((w) => w.paidBeforeTransfer).reduce<ISODate | null>((last, w) => (last == null || w.endsOn > last ? w.endsOn : last), null);
}

export type PickupDateRefusal =
  /** The new day is after today: a moped is not handed over tomorrow. */
  | 'pickup_date_future'
  /** It is the day the rental has. */
  | 'pickup_date_same'
  /** A week made longer would not have begun: its move is taken back first (ADR-0041). */
  | 'pickup_date_week_shifted'
  /** A week with a discount would not have begun: the discount is taken back first (migration 0040). */
  | 'pickup_date_week_discounted'
  /** «Оплачено до переноса по» is no week's end on the new days: it is asked again. */
  | 'transfer_paid_through_week_end';

export interface PickupDatePlan {
  /** Every week the rental has, by its number: its days now and after; `to` null — not begun by the new day, it goes. */
  weeks: { seq: number; from: PeriodBounds; to: PeriodBounds | null; paidBeforeTransfer: boolean }[];
  /** Weeks begun by today on the new days that the rental has no row for — the night's step, now; a running rental only. */
  opened: (PeriodBounds & { paidBeforeTransfer: boolean })[];
  /** «Оплачено до переноса по» before and after; null — none. */
  paidBeforeThrough: { was: ISODate | null; now: ISODate | null };
  /** The ends of the weeks after, for a rental carried over to choose «оплачено по» from again. */
  weekEnds: ISODate[];
  /** The pay day after: kept, or none when it is the weekday the weeks now start on (ADR-0022). */
  payWeekday: number | null;
  /** The days the weeks gained (ADR-0041): the same after. */
  shiftDays: number;
  refusal: { code: PickupDateRefusal; seq?: number } | null;
}

export function pickupDatePlan(input: {
  /** The day the rental has now. */
  pickedUpOn: ISODate;
  /** The day it is given. */
  to: ISODate;
  today: ISODate;
  weeks: readonly RedateWeek[];
  payWeekday: number | null;
  /** Active or overdue: the weeks begun by today are opened, as the night would. A paused or disputed rental's wait for «running again» (Q11). */
  running: boolean;
  /** «Оплачено до переноса по» as a person says it again; undefined — the one it has. */
  paidBeforeThrough?: ISODate | null;
}): PickupDatePlan {
  const shifts = shiftsOf(input.weeks);
  const shiftDays = shifts.reduce((n, s) => n + s.days, 0);
  const future = input.to > input.today;
  // The weeks begun by today on the new days (none for a day after today, which is refused).
  const grid = future ? [] : periodsThrough(input.to, input.today, null, shifts);
  const begun = new Map(grid.map((b) => [b.seq, b]));
  const had = transferPaidThrough(input.weeks);
  const asked = input.paidBeforeThrough === undefined ? had : input.paidBeforeThrough;
  const paidBefore = (endsOn: ISODate) => asked != null && endsOn <= asked;

  const weeks = [...input.weeks]
    .sort((a, b) => a.seq - b.seq)
    .map((w) => {
      const to = begun.get(w.seq) ?? null;
      return { seq: w.seq, from: { seq: w.seq, startsOn: w.startsOn, endsOn: w.endsOn }, to, paidBeforeTransfer: to != null && paidBefore(to.endsOn) };
    });
  const have = new Set(input.weeks.map((w) => w.seq));
  const opened = input.running ? grid.filter((b) => !have.has(b.seq)).map((b) => ({ ...b, paidBeforeTransfer: paidBefore(b.endsOn) })) : [];
  const weekEnds = [...weeks.flatMap((w) => (w.to ? [w.to.endsOn] : [])), ...opened.map((b) => b.endsOn)];

  const gone = input.weeks.filter((w) => !begun.has(w.seq)).sort((a, b) => a.seq - b.seq);
  const shiftedGone = gone.find((w) => w.extraDays !== 0);
  const discountedGone = gone.find((w) => w.discountTetri > 0);
  let refusal: PickupDatePlan['refusal'] = null;
  if (future) refusal = { code: 'pickup_date_future' };
  else if (input.to === input.pickedUpOn) refusal = { code: 'pickup_date_same' };
  else if (shiftedGone) refusal = { code: 'pickup_date_week_shifted', seq: shiftedGone.seq };
  else if (discountedGone) refusal = { code: 'pickup_date_week_discounted', seq: discountedGone.seq };
  else if (asked != null && !weekEnds.includes(asked)) refusal = { code: 'transfer_paid_through_week_end' };

  // The pay day is a weekday and stays one; on the weeks' own weekday it is
  // kept as none, the rule of `PATCH /api/rentals/:id` (ADR-0022).
  const anchor = weeksAnchor(input.to, shiftDays)!;
  const payWeekday = input.payWeekday != null && input.payWeekday !== isoWeekday(anchor) ? input.payWeekday : null;

  return { weeks, opened, paidBeforeThrough: { was: had, now: asked ?? null }, weekEnds, payWeekday, shiftDays, refusal };
}

/**
 * The money after the weeks moved, before `settleCredit` places what was
 * freed: each week keeps its number, its price and the payments on it, with
 * its new days; a week that goes frees what was on it; a week now paid
 * before the transfer frees what payments put on it, since it is paid without
 * them; the weeks opened are at the rate.
 */
export function pickupDateMoney(m: RentalMoney, plan: PickupDatePlan, weeklyRateTetri: Tetri): { money: RentalMoney; freed: MoneyPart[] } {
  const freed: MoneyPart[] = [];
  const weeks: RentalMoney['weeks'] = [];
  for (const w of m.weeks) {
    const p = plan.weeks.find((x) => x.seq === w.seq);
    if (!p?.to) {
      // A week that goes frees all that was on it — a week paid before the
      // transfer, the payment named its money too (ADR-0023).
      freed.push(...w.parts);
      continue;
    }
    const nowPaidBefore = p.paidBeforeTransfer && !w.paidBeforeTransfer;
    if (nowPaidBefore) freed.push(...w.parts);
    weeks.push({ ...w, startsOn: p.to.startsOn, endsOn: p.to.endsOn, paidBeforeTransfer: p.paidBeforeTransfer, parts: nowPaidBefore ? [] : [...w.parts] });
  }
  for (const b of plan.opened) {
    weeks.push({ id: `new-${b.seq}`, seq: b.seq, startsOn: b.startsOn, endsOn: b.endsOn, amountTetri: weeklyRateTetri, paidBeforeTransfer: b.paidBeforeTransfer, parts: [] });
  }
  weeks.sort((a, b) => a.seq - b.seq);
  return { money: { ...m, weeks, credit: moneyWithCredit(m.credit, freed) }, freed };
}

