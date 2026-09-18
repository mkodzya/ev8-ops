// The gross a bank line stands for (PAY-04, B2-06): what closes a debt is
// what the customer paid, not what the bank credited. The rules that decide
// which record a line belongs to live with the statements in the API
// (apps/api/src/lib/statements/reconcile.ts, wave 2 §3.2).
import { acquiringGross } from './money.js';
import type { ISODate } from './types.js';

export interface StatementLine {
  amountTetri: number;
  /** For a card line, what the customer actually paid, when the bank says so. */
  grossTetri?: number | null;
  payer?: string | null;
  purpose?: string | null;
  occurredOn: ISODate;
  channel: 'transfer' | 'acquiring' | 'cash';
}

/** The gross a line represents: stated by the bank, recovered, or the amount itself. */
export function grossOf(line: StatementLine): number {
  if (line.grossTetri != null) return line.grossTetri;
  if (line.channel === 'acquiring') return acquiringGross(line.amountTetri) ?? line.amountTetri;
  return line.amountTetri;
}
