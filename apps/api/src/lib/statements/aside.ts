import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { COUNTS_IN_LARI, gelFor } from './foreign.js';

/**
 * What a line set aside is: not ours, or one of the answers that write no
 * payment — or the second listing of a card payment the bank sent twice
 * (`duplicate`, issue #16), or one leg of a currency exchange (`fx_exchange`,
 * migration 0076).
 */
export type AsideResolution = 'not_ours' | 'company_expense' | 'own_transfer' | 'shareholder' | 'founder_equity' | 'other_income' | 'duplicate' | 'fx_exchange';

/**
 * Set a line aside, once: a second answer finds it taken. `categoryId` is an
 * expense's category (0046), `incomeCategoryId` other income's (0069).
 *
 * A line in another currency set aside as money (migration 0076) keeps the sum
 * in lari it counts at: `gelTetri` when the owner sent one, the bank's
 * otherwise, refused when there is neither. Set aside as nobody's money — not
 * ours, a duplicate — it has none. A line in lari ignores `gelTetri`.
 */
export async function setAside(
  lineId: string,
  actorId: string,
  resolution: AsideResolution,
  reason: string | null,
  categoryId: string | null = null,
  db: Prisma.TransactionClient | typeof prisma = prisma,
  incomeCategoryId: string | null = null,
  gelTetri: number | null = null,
): Promise<void> {
  const line = await db.statementLine.findUnique({ where: { id: lineId }, select: { currency: true, bankGelTetri: true } });
  if (!line) throw notFound('line_not_found', 'No such statement line.');
  const gel = COUNTS_IN_LARI.has(resolution) ? gelFor(line, gelTetri) : null;
  const done = await db.statementLine.updateMany({
    where: { id: lineId, status: 'unmatched' },
    data: { status: 'ignored', matchedRule: resolution, resolution, resolutionReason: reason, resolvedById: actorId, resolvedAt: new Date(), expenseCategoryId: categoryId, incomeCategoryId, gelTetri: gel },
  });
  if (done.count === 0) throw conflict('already_matched', 'This line is already attached.');
}

/** What «Вернуть в очередь» clears on a line: every answer a person or a rule gave it, and the lari it was sorted at. */
export const BACK_TO_QUEUE = {
  status: 'unmatched',
  matchedRule: null,
  resolution: null,
  resolutionReason: null,
  resolvedById: null,
  resolvedAt: null,
  expenseCategoryId: null,
  expenseRuleId: null,
  incomeCategoryId: null,
  payerRuleId: null,
  gelTetri: null,
} as const;
