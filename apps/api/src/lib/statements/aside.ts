import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../db.js';
import { conflict, notFound } from '../errors.js';

/**
 * What a line set aside is: not ours, or one of the answers that write no
 * payment — or the second listing of a card payment the bank sent twice
 * (`duplicate`, issue #16).
 */
export type AsideResolution = 'not_ours' | 'company_expense' | 'own_transfer' | 'shareholder' | 'founder_equity' | 'other_income' | 'duplicate';

/**
 * Set a line aside, once: a second answer finds it taken. `categoryId` is an
 * expense's category (0046), `incomeCategoryId` other income's (0069).
 */
export async function setAside(
  lineId: string,
  actorId: string,
  resolution: AsideResolution,
  reason: string | null,
  categoryId: string | null = null,
  db: Prisma.TransactionClient | typeof prisma = prisma,
  incomeCategoryId: string | null = null,
): Promise<void> {
  const done = await db.statementLine.updateMany({
    where: { id: lineId, status: 'unmatched' },
    data: { status: 'ignored', matchedRule: resolution, resolution, resolutionReason: reason, resolvedById: actorId, resolvedAt: new Date(), expenseCategoryId: categoryId, incomeCategoryId },
  });
  if (done.count === 0) {
    const exists = await db.statementLine.findUnique({ where: { id: lineId }, select: { id: true } });
    if (!exists) throw notFound('line_not_found', 'No such statement line.');
    throw conflict('already_matched', 'This line is already attached.');
  }
}

/** What «Вернуть в очередь» clears on a line: every answer a person or a rule gave it. */
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
} as const;
