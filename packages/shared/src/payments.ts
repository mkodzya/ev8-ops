// How a payment closes what a rental owes (PAY-02, PAY-04, PAY-06).
//
// Pure arithmetic, no database: the order is the rule, and the rule is the
// same whether a payment arrives as cash at the counter or as a line in a
// bank statement. The deposit comes first, because the first payment of a
// rental is rent plus deposit; then periods from the oldest, because a debt
// is paid off in the order it was incurred.
import type { Tetri } from './money.js';

export interface OpenPeriod {
  id: string;
  seq: number;
  amountTetri: Tetri;
  paidTetri: Tetri;
}

export interface OpenDeposit {
  id: string;
  amountTetri: Tetri;
  paidTetri: Tetri;
}

export interface Allocation {
  target: 'period' | 'deposit' | 'instalment' | 'charge';
  id: string;
  amountTetri: Tetri;
}

/** Anything owed in a sequence: a weekly period, a monthly instalment. */
export interface Owed {
  id: string;
  seq: number;
  amountTetri: Tetri;
  paidTetri: Tetri;
}

/**
 * Put `amountTetri` on what is owed, oldest first, and say what is left.
 * The order is the rule: a debt is paid off in the order it was incurred.
 */
export function spreadOverOwed(amountTetri: Tetri, owed: Owed[], target: 'period' | 'instalment' | 'charge'): Spread {
  const allocations: Allocation[] = [];
  let left = amountTetri;
  for (const o of [...owed].sort((a, b) => a.seq - b.seq)) {
    if (left <= 0) break;
    const due = Math.max(0, o.amountTetri - o.paidTetri);
    const take = Math.min(due, left);
    if (take > 0) {
      allocations.push({ target, id: o.id, amountTetri: take });
      left -= take;
    }
  }
  return { allocations, leftoverTetri: left };
}

export interface Spread {
  allocations: Allocation[];
  /** What is left over: the customer's credit, waiting for the next period. */
  leftoverTetri: Tetri;
}

/**
 * Spread `amountTetri` over the deposit and the open periods.
 *
 * The amount spread is the GROSS the customer paid, never the net the bank
 * credited: an acquiring fee is the company's expense, so a customer who
 * paid 320 by card owes nothing afterwards (PAY-04).
 */
export function spreadPayment(
  amountTetri: Tetri,
  periods: OpenPeriod[],
  deposit: OpenDeposit | null,
): Spread {
  const allocations: Allocation[] = [];
  let left = amountTetri;

  if (deposit) {
    const owed = Math.max(0, deposit.amountTetri - deposit.paidTetri);
    const take = Math.min(owed, left);
    if (take > 0) {
      allocations.push({ target: 'deposit', id: deposit.id, amountTetri: take });
      left -= take;
    }
  }

  const rest = spreadOverOwed(left, periods, 'period');
  return { allocations: [...allocations, ...rest.allocations], leftoverTetri: rest.leftoverTetri };
}

/**
 * A schedule for a sale (SAL-02): a deposit today, then `months` equal
 * instalments on the same day of each following month.
 *
 * The rounding goes on the first instalment rather than the last, so the
 * figure a customer is told at the counter is the one they pay every month
 * after the first. A month that is too short takes its last day: a sale on
 * the 31st instals on the 30th, and on the 28th in February.
 */
export function instalmentSchedule(input: {
  soldOn: string;
  priceTetri: Tetri;
  downPaymentTetri: Tetri;
  months: number;
}): { seq: number; dueOn: string; amountTetri: Tetri }[] {
  const { soldOn, priceTetri, downPaymentTetri, months } = input;
  if (downPaymentTetri > priceTetri) throw new Error('the down payment is more than the price');
  const out: { seq: number; dueOn: string; amountTetri: Tetri }[] = [];
  let seq = 1;
  if (downPaymentTetri > 0 || months === 0) {
    out.push({ seq: seq++, dueOn: soldOn, amountTetri: downPaymentTetri > 0 ? downPaymentTetri : priceTetri });
  }
  const rest = priceTetri - (downPaymentTetri > 0 ? downPaymentTetri : months === 0 ? priceTetri : 0);
  if (months > 0 && rest > 0) {
    const each = Math.floor(rest / months);
    const first = rest - each * (months - 1);
    const [y, m, d] = soldOn.split('-').map(Number);
    for (let i = 1; i <= months; i++) {
      const target = new Date(Date.UTC(y, m - 1 + i, 1));
      const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      target.setUTCDate(Math.min(d, lastDay));
      out.push({ seq: seq++, dueOn: target.toISOString().slice(0, 10), amountTetri: i === 1 ? first : each });
    }
  }
  return out;
}
