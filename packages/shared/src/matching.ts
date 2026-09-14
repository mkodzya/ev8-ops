// Which rental a statement line belongs to (PAY-02).
//
// The rules are tried in order and the first that answers wins, because they
// are ordered by how much they know:
//   1. the payer's name is in the line, and it is a customer's name;
//   2. the amount is exactly what one rental has open — deposit plus first
//      week, or a week on its own;
//   3. a card payment of a typical amount on the day a moped went out.
//
// A rule only matches when it points at exactly one rental. Two candidates
// is not a match, it is a question, and it goes to the queue for a person to
// answer (PAY-03). Attaching money to the wrong rental is worse than
// attaching it to none.
import { acquiringGross } from './money.js';
import { nameMatches } from './georgian.js';
import type { ISODate } from './types.js';

export interface MatchCandidate {
  rentalId: string;
  customerId: string;
  /** Every spelling of the customer's name we hold. */
  names: (string | null | undefined)[];
  pickedUpOn: ISODate | null;
  /** What this rental still has open, deposit first. */
  openDepositTetri: number;
  openFirstPeriodTetri: number;
  openTotalTetri: number;
}

export interface StatementLine {
  amountTetri: number;
  /** For a card line, what the customer actually paid, when the bank says so. */
  grossTetri?: number | null;
  payer?: string | null;
  purpose?: string | null;
  occurredOn: ISODate;
  channel: 'transfer' | 'acquiring' | 'cash';
}

export type MatchRule = 'payer_name' | 'exact_amount' | 'acquiring_pickup_day';

export interface MatchResult {
  rentalId: string;
  customerId: string;
  rule: MatchRule;
  /** What the customer paid: the gross, which is what closes a debt. */
  grossTetri: number;
}

/** The gross a line represents: stated by the bank, recovered, or the amount itself. */
export function grossOf(line: StatementLine): number {
  if (line.grossTetri != null) return line.grossTetri;
  if (line.channel === 'acquiring') return acquiringGross(line.amountTetri) ?? line.amountTetri;
  return line.amountTetri;
}

export function matchLine(line: StatementLine, candidates: MatchCandidate[]): MatchResult | null {
  const gross = grossOf(line);
  const only = (hits: MatchCandidate[], rule: MatchRule): MatchResult | null =>
    hits.length === 1 ? { rentalId: hits[0].rentalId, customerId: hits[0].customerId, rule, grossTetri: gross } : null;

  // 1. The name in the line.
  const text = [line.payer, line.purpose].filter(Boolean).join(' ');
  if (text) {
    const byName = candidates.filter((c) => nameMatches(text, c.names));
    // One customer may have two rentals; the oldest open one takes the money,
    // the same order in which a debt is paid off.
    if (byName.length > 0) {
      const customers = new Set(byName.map((c) => c.customerId));
      if (customers.size === 1) {
        const sorted = [...byName].sort((a, b) => (a.pickedUpOn ?? '').localeCompare(b.pickedUpOn ?? ''));
        return { rentalId: sorted[0].rentalId, customerId: sorted[0].customerId, rule: 'payer_name', grossTetri: gross };
      }
    }
  }

  // 2. The amount is exactly what one rental has open.
  const byAmount = candidates.filter(
    (c) =>
      gross === c.openDepositTetri + c.openFirstPeriodTetri ||
      gross === c.openFirstPeriodTetri ||
      gross === c.openTotalTetri,
  );
  const amountHit = only(byAmount, 'exact_amount');
  if (amountHit) return amountHit;

  // 3. A card payment on the day a moped went out. The acquiring sums the
  //    company sees are 315.20 for 320 and 325.05 for 330 — the first
  //    payment of a new renter, rent plus deposit.
  if (line.channel === 'acquiring') {
    const sameDay = candidates.filter(
      (c) => c.pickedUpOn === line.occurredOn && gross === c.openDepositTetri + c.openFirstPeriodTetri,
    );
    const dayHit = only(sameDay, 'acquiring_pickup_day');
    if (dayHit) return dayHit;
  }

  return null;
}
