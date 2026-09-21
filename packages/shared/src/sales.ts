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
  /** paid · overdue · ahead — due today counts as due (a week and a month alike). */
  state: 'paid' | 'overdue' | 'ahead';
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
        state: openTetri === 0 ? 'paid' : due ? 'overdue' : 'ahead',
        days: openTetri > 0 && due ? daysBetween(i.dueOn, input.today) : 0,
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

const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

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
