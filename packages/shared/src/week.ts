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
//     week entirely; the next three weeks show nothing for it. Which row it
//     lands on is the mixed rule in `weekIncome` below — the reasoning is
//     there, beside the code it governs. A card is counted at what the
//     customer actually paid: the acquirer's 1.5 % is a row of its own,
//     because it is the company's expense and not the customer's debt
//     (`money.md`).
//
// What was "paid before the transfer" is not a payment at all: it is a fact
// carried over from Odoo with no day and no money movement, so it is kept
// apart and never joins a week's takings (default Q3, crit. 9).
import { addDays } from './time.js';
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

export type WeekPaymentKind = 'rent' | 'sale' | 'service' | 'on_account' | 'deposit_payout' | 'buyback' | 'supplier';
export type WeekAllocationTarget = 'period' | 'deposit' | 'instalment' | 'charge';

export interface WeekPayment {
  occurredOn: ISODate;
  direction: 'in' | 'out';
  /** `deposit` is money kept out of a deposit: it came in once already, as the deposit. */
  channel: 'cash' | 'acquiring' | 'transfer' | 'deposit';
  kind: WeekPaymentKind;
  /** What the customer paid — a card at its face value, before the acquirer's cut. */
  grossTetri: Tetri;
  feeTetri: Tetri;
  /** What this payment closed. Empty when it closed nothing yet. */
  allocations: { target: WeekAllocationTarget; amountTetri: Tetri }[];
}

export interface WeekIncome {
  /**
   * Everything that came through the door in the period, summed straight off
   * the payments — not by adding the rows below up. It is the figure a person
   * checks against the bank statement and the till, and it can only serve as
   * that check while it is worked out independently of the breakdown.
   */
  totalTetri: Tetri;
  rentTetri: Tetri;
  saleTetri: Tetri;
  /** Deposits received. */
  depositsInTetri: Tetri;
  /** Repairs the customer paid for, and what a return charged beyond the weeks. */
  serviceTetri: Tetri;
  /** The acquirer's 1.5 % on the week's cards — a company expense, shown apart. */
  acquiringFeeTetri: Tetri;
  /** Deposits handed back. */
  depositsOutTetri: Tetri;
}

/**
 * What came in over the period, and what it came in for.
 *
 * **The day is always the payment's own day.** Four weeks paid in advance on
 * Monday belong to Monday's week entirely; the next three weeks show nothing
 * for it. That part of the designer's rule (21.09.2026) is not in question.
 *
 * **The row is mixed, and deliberately so** (designer, 22.09.2026, after the
 * tester counted the stand both pure ways). A payment's allocations name the
 * row where they exist; the part of the payment nothing has taken yet is
 * named by what the payment was for. Neither pure rule gives the table the
 * book asks for:
 *
 *   * *by the payment's kind alone* — a deposit is taken inside the rent
 *     payment at hand-over (330 ₾ = a week of 150 and a deposit of 180, one
 *     row of kind `rent`), so "получено залогов" would be nought for ever;
 *   * *by the allocations alone* — money paid ahead of the weeks it will pay
 *     for is allocated to nothing yet, so 1 020 ₾ that physically arrived
 *     landed in no row at all, the 600 ₾ of criterion 1а among them.
 *
 * The mixed rule keeps both: the hand-over splits into 150 rent and 180
 * deposit, and the 600 ₾ paid ahead counts as rent on the day it was handed
 * over. One function, because if the designer changes the rule again this is
 * the only place that should change.
 */
export function weekIncome(payments: readonly WeekPayment[], period: Period): WeekIncome {
  const out: WeekIncome = { totalTetri: 0, rentTetri: 0, saleTetri: 0, depositsInTetri: 0, serviceTetri: 0, acquiringFeeTetri: 0, depositsOutTetri: 0 };
  for (const p of payments) {
    if (!inPeriod(period, p.occurredOn)) continue;
    // Money kept out of a deposit is written as a payment so the repair it
    // paid for has one; nothing came through the door for it.
    if (p.channel === 'deposit') continue;
    if (p.direction === 'out') {
      if (p.kind === 'deposit_payout') out.depositsOutTetri += p.grossTetri;
      continue;
    }
    if (p.channel === 'acquiring') out.acquiringFeeTetri += p.feeTetri;
    out.totalTetri += p.grossTetri;

    let placed = 0;
    for (const a of p.allocations) {
      placed += a.amountTetri;
      if (a.target === 'deposit') out.depositsInTetri += a.amountTetri;
      else if (a.target === 'instalment') out.saleTetri += a.amountTetri;
      // What a return charged beyond the weeks — a key, days of delay, a
      // repair the renter pays for — reads as a repair, not as rent.
      else if (a.target === 'charge') out.serviceTetri += a.amountTetri;
      else out.rentTetri += a.amountTetri;
    }
    // The rest is named by what the payment was for. A kind that lands in no
    // row is left out on purpose: the total will then disagree with the rows,
    // and the test that compares them is what says so out loud.
    const left = Math.max(0, p.grossTetri - placed);
    if (left === 0) continue;
    if (p.kind === 'rent' || p.kind === 'on_account') out.rentTetri += left;
    else if (p.kind === 'sale') out.saleTetri += left;
    else if (p.kind === 'service') out.serviceTetri += left;
  }
  return out;
}

/** The rows of the breakdown, for the check against `totalTetri`. */
export const incomeRows = (i: WeekIncome): Tetri => i.rentTetri + i.saleTetri + i.depositsInTetri + i.serviceTetri;
