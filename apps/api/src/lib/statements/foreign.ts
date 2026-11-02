import { badRequest, conflict } from '../errors.js';

// A line of an account in another currency, sorted in «Разобрать» (stage 5 of
// docs/spec/usd-accounts-plan.md, migration 0076; Mika, 02.11.2026: «Да,
// начинай»). Only an owner sorts it, and only by the answers that are not a
// customer's money: rent, a sale, a repair, goods, a deposit are paid in lari.
// Sorted as money, it counts in lari at the sum the bank sent for it — the
// National Bank of Georgia's official rate of its day — or at the owner's
// correction (decision D2, 01.11.2026). Its sum in its own currency is never
// added to lari.

/** What a manager sees of the queue, and what a customer's money can be: lines in lari. */
export const LARI = { currency: 'GEL' } as const;

/** The answers that are money: a line in another currency sorted by one of them counts in lari at its `gelTetri`. */
export const COUNTS_IN_LARI: ReadonlySet<string> = new Set(['company_expense', 'own_transfer', 'shareholder', 'founder_equity', 'other_income', 'fx_exchange']);

/** The sum in lari a line counts at: its own for a line in lari; for another currency, the one it was sorted at — none while it waits. */
export function lariOf(l: { currency: string; amountTetri: number; gelTetri: number | null }): number | null {
  return l.currency === 'GEL' ? l.amountTetri : l.gelTetri;
}

/**
 * What a line in another currency counts at in lari when it is sorted as
 * money: the owner's sum when one is sent, the bank's otherwise. Refused when
 * there is neither — TBC sends no lari. Null for a line in lari.
 */
export function gelFor(line: { currency: string; bankGelTetri: number | null }, given: number | null | undefined): number | null {
  if (line.currency === 'GEL') return null;
  const gel = given ?? line.bankGelTetri;
  if (gel == null || gel <= 0) throw badRequest('gel_needed', 'Say what this line is in lari: the bank sent no sum in lari for it.', { field: 'gelTetri' });
  return gel;
}

/** A currency of the accounts in a report (0076): what of it was sorted and the lari that counts at, and what still waits — the latter in no total in lari. */
export interface ForeignInReport {
  currency: string;
  sortedMinor: number;
  sortedGelTetri: number;
  waitingMinor: number;
  waitingLines: number;
}

/**
 * Reads a report's lines in another currency, by currency. A line that waits
 * is in no sum in lari; one sorted as money counts at its `gelTetri` in the
 * report's own rows, and is said here too, with its own currency's sum.
 * Answers it for the caller: true when the line is done with (waiting, or
 * nobody's money), false when the report should count it at `lariOf`.
 */
export function foreignTally() {
  const by = new Map<string, ForeignInReport>();
  return {
    take(l: { currency: string; amountTetri: number; status: string; gelTetri: number | null }): boolean {
      if (l.currency === 'GEL') return false;
      const f = by.get(l.currency) ?? { currency: l.currency, sortedMinor: 0, sortedGelTetri: 0, waitingMinor: 0, waitingLines: 0 };
      by.set(l.currency, f);
      if (l.status === 'unmatched') {
        f.waitingMinor += l.amountTetri;
        f.waitingLines++;
        return true;
      }
      // Not ours, or a duplicate: no money of the company's.
      if (l.gelTetri == null) return true;
      f.sortedMinor += l.amountTetri;
      f.sortedGelTetri += l.gelTetri;
      return false;
    },
    list: (): ForeignInReport[] => [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

/** A line in another currency asked to pay what is paid in lari only. */
export const foreignLine = () => conflict('foreign_line', 'This line is of an account in another currency: it pays no rental, sale, repair, goods or deposit.');
