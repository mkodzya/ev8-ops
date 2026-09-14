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
  target: 'period' | 'deposit';
  id: string;
  amountTetri: Tetri;
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

  for (const p of [...periods].sort((a, b) => a.seq - b.seq)) {
    if (left <= 0) break;
    const owed = Math.max(0, p.amountTetri - p.paidTetri);
    const take = Math.min(owed, left);
    if (take > 0) {
      allocations.push({ target: 'period', id: p.id, amountTetri: take });
      left -= take;
    }
  }

  return { allocations, leftoverTetri: left };
}

export interface BalanceInput {
  /** Every period of every rental of this customer. */
  periods: { amountTetri: Tetri; paidTetri: Tetri }[];
  /** Deposits of rentals that are still open. */
  deposits: { amountTetri: Tetri; paidTetri: Tetri; held: boolean }[];
  /** Gross of every payment that is not voided. */
  paidTetri: Tetri;
}

export interface Balance {
  /** What has been charged: periods plus deposits asked for. */
  invoicedTetri: Tetri;
  paidTetri: Tetri;
  /** Still owed. Zero when the customer is square or ahead. */
  outstandingTetri: Tetri;
  /** Paid beyond what is owed — goes towards the next period (PAY-06). */
  creditTetri: Tetri;
  /** Deposits we are holding for this customer right now. */
  depositHeldTetri: Tetri;
}

export function customerBalance(input: BalanceInput): Balance {
  const periodsTotal = input.periods.reduce((n, p) => n + p.amountTetri, 0);
  const depositsTotal = input.deposits.reduce((n, d) => n + d.amountTetri, 0);
  const invoiced = periodsTotal + depositsTotal;
  const diff = invoiced - input.paidTetri;
  return {
    invoicedTetri: invoiced,
    paidTetri: input.paidTetri,
    outstandingTetri: Math.max(0, diff),
    creditTetri: Math.max(0, -diff),
    depositHeldTetri: input.deposits.filter((d) => d.held).reduce((n, d) => n + d.paidTetri, 0),
  };
}
