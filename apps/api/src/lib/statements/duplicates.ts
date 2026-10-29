import { addDays } from '@ev8/shared';
import { dateFromISO, isoDate } from '../dates.js';
import { prisma } from '../db.js';
import { CARD_DAYS, bogCardOf, cardRepeats } from './sameLine.js';

// The card payments that reached «Разобрать» twice (issue #16 of the director,
// 25.10.2026; ADR-0021, addendum of 25.10.2026). Rule 5 keeps the second
// listing of a Bank of Georgia card payment out of the queue from now on; the
// pairs that came in before it, or a pair the rule did not see, are marked
// instead of cleaned up by a script on production: the later line says which
// line it repeats, and one tap of an owner's — «Это дубль» — sets it aside,
// journaled and put back by «Вернуть в очередь» like any line set aside.

/** The line a duplicate repeats, as the queue names it: «похоже на дубль строки от 23.10 (№…)». */
export interface Twin {
  id: string;
  occurredOn: string;
  docNo: string | null;
  status: 'unmatched' | 'matched' | 'ignored';
}

/**
 * Answers that say a line is not there: such a line repeats nothing and is
 * repeated by nothing. A line parked in another currency (migration 0073) is
 * not there for the lari either.
 */
const NOT_THERE = new Set(['not_ours', 'duplicate', 'foreign']);

/** How a duplicate set aside keeps the line it repeats, for «Убранные из очереди»: `twin:<day>:<document>`. */
export const twinReason = (t: Twin): string => `twin:${t.occurredOn}:${t.docNo ?? ''}`;

/**
 * Of these lines, the ones that repeat an earlier Bank of Georgia line by
 * rule 5, each with the line it repeats. Reads the lines of the bank around
 * their days — any status: the line repeated may be sorted already.
 */
export async function twinsOf(lines: readonly { id: string; bank: string; raw: string; occurredOn: Date }[]): Promise<Map<string, Twin>> {
  const cards = lines.filter((l) => l.bank === 'bog' && bogCardOf(l.raw) != null);
  const out = new Map<string, Twin>();
  if (cards.length === 0) return out;
  const days = cards.map((l) => isoDate(l.occurredOn)!).sort();
  const near = await prisma.statementLine.findMany({
    where: { bank: 'bog', occurredOn: { gte: dateFromISO(addDays(days[0]!, -CARD_DAYS))!, lte: dateFromISO(addDays(days[days.length - 1]!, CARD_DAYS))! } },
    select: { id: true, naturalKey: true, docNo: true, occurredOn: true, direction: true, amountTetri: true, raw: true, status: true, resolution: true, createdAt: true },
  });
  const pool = near.filter((l) => !(l.status === 'ignored' && NOT_THERE.has(l.resolution ?? ''))).map((l) => ({ ...l, occurredOn: isoDate(l.occurredOn)! }));
  const repeats = cardRepeats(pool);
  for (const l of cards) {
    const t = repeats.get(l.id);
    if (t) out.set(l.id, { id: t.id, occurredOn: t.occurredOn, docNo: t.docNo, status: t.status });
  }
  return out;
}
