// Selling a moped, and the company's own instalments (wave 5 §3.1–3.3,
// `sales.md`). Three things live here because three places ask them and the
// answers have to agree: what the schedule is, where it stands today, and
// what a buy-back closes.
//
// The schedule itself is built by `instalmentSchedule` (payments.ts), where
// it has lived since the first version: a down payment on the day of the sale
// and N monthly instalments after it. What is here is everything read off a
// schedule — nothing is stored that can be derived, so a row knows only what
// it asked for and what has been paid against it.
import type { Tetri } from './money.js';
import { addDays, daysBetween } from './time.js';
import type { ISODate } from './types.js';

/** A moped is under warranty for a year from the day it was sold (`sales.md`). */
export const WARRANTY_MONTHS = 12;

export interface ScheduleRow {
  seq: number;
  dueOn: ISODate;
  amountTetri: Tetri;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The same day of a later month, as a person would say it: 31.01 plus one
 * month is the last day of February, because there is no 31st to move to.
 */
export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

/** Twelve months from the sale, the day the warranty runs to (`sales.md`). */
export function warrantyUntil(soldOn: ISODate): ISODate {
  return addMonths(soldOn, WARRANTY_MONTHS);
}

export function scheduleTotal(rows: readonly { amountTetri: Tetri }[]): Tetri {
  return rows.reduce((n, r) => n + r.amountTetri, 0);
}

/**
 * What a schedule edited by hand no longer adds up to. The wizard shows this
 * before the sale is made: a schedule that does not come to the price is
 * allowed — somebody may be rounding a last instalment on purpose — but it
 * is never allowed to be a surprise (crit. 4).
 */
export function scheduleGap(priceTetri: Tetri, rows: readonly { amountTetri: Tetri }[]): Tetri {
  return scheduleTotal(rows) - priceTetri;
}

export interface InstalmentState {
  seq: number;
  dueOn: ISODate;
  amountTetri: Tetri;
  paidTetri: Tetri;
  openTetri: Tetri;
  /**
   * paid · overdue · ahead — due today counts as due (a week and a month
   * alike) — and `closed` for what a buy-back or a cancellation settled: a
   * row that is nobody's debt any more is not "ahead" either (QA-W5-07).
   */
  state: 'paid' | 'overdue' | 'ahead' | 'closed';
  /** Days since it was due, for an overdue row. */
  days: number;
}

export interface SaleState {
  rows: InstalmentState[];
  /** Instalments due and unpaid: the buyer owes this now. */
  owesTetri: Tetri;
  /** Instalments not due yet — not a debt (Q21). */
  aheadTetri: Tetri;
  paidTetri: Tetri;
  /** The longest any instalment has been overdue, 0 when none is. */
  worstDays: number;
}

/**
 * Where a sale stands today. A bought-back or cancelled sale owes nothing
 * (M8): its rows are shown, but neither debt nor what is still ahead.
 */
export function saleState(input: {
  today: ISODate;
  status: 'active' | 'cancelled' | 'bought_back';
  instalments: readonly { seq: number; dueOn: ISODate; amountTetri: Tetri; paidTetri: Tetri }[];
}): SaleState {
  const live = input.status === 'active';
  const rows: InstalmentState[] = [...input.instalments]
    .sort((a, b) => a.seq - b.seq)
    .map((i) => {
      const openTetri = Math.max(0, i.amountTetri - i.paidTetri);
      const due = i.dueOn <= input.today;
      return {
        seq: i.seq,
        dueOn: i.dueOn,
        amountTetri: i.amountTetri,
        paidTetri: i.paidTetri,
        openTetri,
        state: openTetri === 0 ? 'paid' : !live ? 'closed' : due ? 'overdue' : 'ahead',
        days: live && openTetri > 0 && due ? daysBetween(i.dueOn, input.today) : 0,
      };
    });
  return {
    rows,
    owesTetri: live ? rows.filter((r) => r.state === 'overdue').reduce((n, r) => n + r.openTetri, 0) : 0,
    aheadTetri: live ? rows.filter((r) => r.state === 'ahead').reduce((n, r) => n + r.openTetri, 0) : 0,
    paidTetri: rows.reduce((n, r) => n + r.paidTetri, 0),
    worstDays: rows.reduce((n, r) => Math.max(n, r.days), 0),
  };
}

/**
 * How many whole months after `from` a day falls on the same day of the month
 * as `from` — the way `addMonths` and the schedule count, a short month's
 * last day standing in for a day it does not have — or null when it does not.
 */
function monthsAfter(from: ISODate, day: ISODate): number | null {
  const [fy, fm] = from.split('-').map(Number);
  const [dy, dm] = day.split('-').map(Number);
  const months = (dy - fy) * 12 + (dm - fm);
  return months >= 0 && addMonths(from, months) === day ? months : null;
}

export interface SaleRedate {
  /** The warranty after the move: the twelve months follow the date, a warranty set by hand stays. */
  warrantyUntil: ISODate | null;
  /** The instalments whose day moves, and from what to what. A line that stays is not listed. */
  instalments: { seq: number; from: ISODate; to: ISODate }[];
}

/**
 * A sale entered on the wrong day, put right (call of 21.10.2026). What was
 * worked out from the day of the sale follows it, and nothing else does:
 *
 *  - the warranty, when it is the twelve months the sale gave it; one an
 *    owner set by hand stays where it was put;
 *  - an instalment on the day of the sale, or on the same day of a later
 *    month, moves to that day counted from the new date — the schedule a
 *    sale entered on the right day would have built, month ends included
 *    (a sale on the 31st instals on the 28th in February, one on the 28th
 *    does too, and in March they part again);
 *  - a line somebody moved by hand moves by the same number of days;
 *  - a sale carried over from paper keeps its schedule: those dates are the
 *    contract's (B3-03), not ours to work out.
 *
 * Paid lines move with the rest. Money hangs on the instalment, not on its
 * date, so nothing paid changes — only the day the line reads as due.
 *
 * The API writes this and the date sheet shows it before anything is sent,
 * so the two cannot disagree about what moves.
 */
export function redateSale(
  input: {
    soldOn: ISODate;
    warrantyUntil: ISODate | null;
    transferred: boolean;
    instalments: readonly { seq: number; dueOn: ISODate }[];
  },
  newSoldOn: ISODate,
): SaleRedate {
  const old = input.soldOn;
  const shift = daysBetween(old, newSoldOn);
  const warranty = input.warrantyUntil != null && input.warrantyUntil === warrantyUntil(old) ? warrantyUntil(newSoldOn) : input.warrantyUntil;
  if (shift === 0 || input.transferred) return { warrantyUntil: warranty, instalments: [] };
  const instalments = [...input.instalments]
    .sort((a, b) => a.seq - b.seq)
    .map((i) => {
      const months = monthsAfter(old, i.dueOn);
      return { seq: i.seq, from: i.dueOn, to: months != null ? addMonths(newSoldOn, months) : addDays(i.dueOn, shift) };
    })
    .filter((i) => i.from !== i.to);
  return { warrantyUntil: warranty, instalments };
}

/**
 * A sale carried over from the old way of working (B3-03): the schedule is
 * copied from the paper contract and one figure says what had been paid by
 * the day of the move. It closes instalments oldest first, exactly as a
 * payment does, so the carried-over sale owes what the paper one owed.
 */
export function applyPaidBefore(rows: readonly ScheduleRow[], paidBeforeTetri: Tetri): { seq: number; paidTetri: Tetri }[] {
  let left = Math.max(0, paidBeforeTetri);
  return [...rows]
    .sort((a, b) => a.seq - b.seq)
    .map((r) => {
      const take = Math.min(left, r.amountTetri);
      left -= take;
      return { seq: r.seq, paidTetri: take };
    });
}

export interface Buyback {
  /** What the buyer had paid on this sale, and keeps. */
  paidTetri: Tetri;
  /** The rest of the schedule, which the buy-back writes off (Q20). */
  writeOffTetri: Tetri;
  /** What the company pays out for the moped — a cost of its own, not a refund. */
  payoutTetri: Tetri;
}

/**
 * Buying a sold moped back (B7-01, M8). The two figures never mix: what is
 * left of the schedule is written off, and the buy-back price is an expense.
 * After it the buyer owes nothing on this sale.
 */
export function buyback(input: {
  instalments: readonly { amountTetri: Tetri; paidTetri: Tetri }[];
  buybackTetri: Tetri;
}): Buyback {
  return {
    paidTetri: input.instalments.reduce((n, i) => n + i.paidTetri, 0),
    writeOffTetri: input.instalments.reduce((n, i) => n + Math.max(0, i.amountTetri - i.paidTetri), 0),
    payoutTetri: Math.max(0, Math.round(input.buybackTetri)),
  };
}
