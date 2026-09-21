// The week of the book (wave 6 §3.1, `weekly.md` "Какие цифры") — the rules,
// with no database in them, so the screen, the API and the PDF answer with
// one arithmetic and a test can put a number in and read a number out.
//
// Two decisions of the designer (21.09.2026) live here and nowhere else:
//
//   * **A week is Monday to Sunday**, in the company's zone, and the previous
//     week is *its* seven days — never "the last seven days". A figure that
//     slides with the clock cannot be read out at a Monday meeting.
//   * **Money is counted by the date it was paid**, not by the weeks it was
//     spread over. Four weeks paid in advance on Monday belong to Monday's
//     week entirely; the next three weeks show nothing for it. Which row a
//     payment lands on comes from what it was paid for (`payment.kind`), and
//     a card is counted at what the customer actually paid — the acquirer's
//     1.5 % is a row of its own, because it is the company's expense and not
//     the customer's debt (`money.md`).
//
// What was "paid before the transfer" is not a payment at all: it is a fact
// carried over from Odoo with no day and no money movement, so it is kept
// apart and never joins a week's takings (default Q3, crit. 9).
import { addDays, daysBetween } from './time.js';
import type { Tetri } from './money.js';
import type { ISODate } from './types.js';

export interface Period {
  from: ISODate;
  /** Inclusive. */
  to: ISODate;
}

/** Monday…Sunday of the week `day` falls in. */
export function weekOf(day: ISODate): Period {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const from = addDays(day, -((dow + 6) % 7));
  return { from, to: addDays(from, 6) };
}

/** The week before `p` — by its own dates, seven days earlier. */
export function previousWeek(p: Period): Period {
  return { from: addDays(p.from, -7), to: addDays(p.to, -7) };
}

export const inPeriod = (p: Period, day: ISODate): boolean => day >= p.from && day <= p.to;

/** Days in the period, both ends counted. */
export const lengthOf = (p: Period): number => Math.max(0, daysBetween(p.from, p.to) + 1);

export type WeekPaymentKind = 'rent' | 'sale' | 'service' | 'on_account' | 'deposit_payout' | 'buyback' | 'supplier';

export interface WeekPayment {
  occurredOn: ISODate;
  direction: 'in' | 'out';
  /** `deposit` is money kept out of a deposit: it came in once already, as the deposit. */
  channel: 'cash' | 'acquiring' | 'transfer' | 'deposit';
  kind: WeekPaymentKind;
  /** What the customer paid — a card at its face value, before the acquirer's cut. */
  grossTetri: Tetri;
  feeTetri: Tetri;
  /** How much of this payment's gross went onto the deposit rather than the rent. */
  toDepositTetri: Tetri;
}

export interface WeekMoney {
  /** Rent that came in this week, the deposit part of it taken out. */
  rentTetri: Tetri;
  saleTetri: Tetri;
  /** Deposits received: the part of the week's payments that landed on a deposit. */
  depositsInTetri: Tetri;
  /** The acquirer's 1.5 % on the week's cards — a company expense, shown apart. */
  acquiringFeeTetri: Tetri;
  /** Deposits handed back this week. */
  depositsOutTetri: Tetri;
}

/**
 * What came in and went out over the period, by the day each payment carries.
 *
 * A deposit has no payment kind of its own — it is taken with the rent and
 * the allocation says which part of that one payment it was. So the split of
 * a single payment into "rent" and "deposit" comes from the allocation, while
 * *which week the payment belongs to* stays the payment's own date. The rows
 * are disjoint: 330 ₾ taken as 180 deposit + 150 rent shows 150 and 180, and
 * never 330 twice.
 */
export function weekMoney(payments: readonly WeekPayment[], period: Period): WeekMoney {
  const out: WeekMoney = { rentTetri: 0, saleTetri: 0, depositsInTetri: 0, acquiringFeeTetri: 0, depositsOutTetri: 0 };
  for (const p of payments) {
    if (!inPeriod(period, p.occurredOn)) continue;
    // Money kept out of a deposit is written as a payment so the repair it
    // paid for has one; no money came through the door for it.
    if (p.channel === 'deposit') continue;
    if (p.direction === 'in') {
      if (p.channel === 'acquiring') out.acquiringFeeTetri += p.feeTetri;
      out.depositsInTetri += Math.min(p.toDepositTetri, p.grossTetri);
      const rest = Math.max(0, p.grossTetri - p.toDepositTetri);
      if (p.kind === 'rent' || p.kind === 'on_account') out.rentTetri += rest;
      else if (p.kind === 'sale') out.saleTetri += rest;
    } else if (p.kind === 'deposit_payout') {
      out.depositsOutTetri += p.grossTetri;
    }
  }
  return out;
}

export interface ArrearsRental {
  id: string;
  /** Weeks of this rental, with what each had been paid **by the day asked about**. */
  periods: { startsOn: ISODate; amountTetri: Tetri; paidTetri: Tetri }[];
}

export interface Arrears {
  rentals: number;
  tetri: Tetri;
}

/**
 * Rent that was due and unpaid on `day`. A week is owed from the day it
 * starts (the same rule the customer's debt follows), so a week that begins
 * on `day` already counts.
 */
export function arrearsOn(rentals: readonly ArrearsRental[], day: ISODate): Arrears {
  let count = 0;
  let tetri = 0;
  for (const r of rentals) {
    const owed = r.periods
      .filter((p) => p.startsOn <= day)
      .reduce((n, p) => n + Math.max(0, p.amountTetri - p.paidTetri), 0);
    if (owed > 0) {
      count++;
      tetri += owed;
    }
  }
  return { rentals: count, tetri };
}

/** Deposit money we are still holding: taken in, less kept, less handed back. */
export function depositsHeld(deposits: readonly { paidTetri: Tetri; withheldTetri: Tetri; paidOutTetri: Tetri }[]): Tetri {
  return deposits.reduce((n, d) => n + Math.max(0, d.paidTetri - d.withheldTetri - d.paidOutTetri), 0);
}
