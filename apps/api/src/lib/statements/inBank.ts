import { acquiringFee, addDays, daysBetween, nameMatches } from '@ev8/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { dateFromISO, isoDate } from '../dates.js';
import { WINDOW_DAYS, lineGross, storedLine } from './reconcile.js';

// Money entered by hand that the bank has sent already (B11-03, ADR-0021).
//
// Rule B2-03 was written for the order things used to come in: a person
// entered a transfer, and the statement came days later and was linked to it.
// Bank of Georgia now sends its lines every five minutes, so the line comes
// first — a rule may already have made a payment of it — and a transfer
// entered by hand afterwards would count the same money twice. The money form
// asks this before it writes: is there a bank line of this sum, gross or net,
// within ±3 days — the same test as B2-03, read the other way round.

type Tx = Prisma.TransactionClient;

/** A bank line this money may be. */
export interface InBank {
  lineId: string;
  bank: 'bog' | 'tbc' | 'credo';
  occurredOn: string;
  /** What the bank credited, and what the customer paid (a card line's net plus the 1.5 %). */
  amountTetri: number;
  grossTetri: number;
  payer: string | null;
  purpose: string | null;
  /** The payment the line already is, the same customer's. Null: the line waits in «Разобрать». */
  payment: { id: string; number: string | null; grossTetri: number } | null;
}

/**
 * Bank lines this customer's money may already be. A line attached to a
 * payment counts only when that payment is this customer's: the same sum on
 * somebody else's rental is somebody else's money. A line still waiting
 * counts unless it names somebody else.
 */
export async function inBankAlready(
  tx: Tx,
  input: { customerId: string | null; grossTetri: number; channel: 'cash' | 'transfer' | 'acquiring'; occurredOn: string },
): Promise<InBank[]> {
  // Cash never passes through the bank: there is no line to find.
  if (input.channel === 'cash' || input.grossTetri <= 0) return [];
  const gross = input.grossTetri;
  const net = gross - (input.channel === 'acquiring' ? acquiringFee(gross) : 0);
  const rows = await tx.statementLine.findMany({
    where: {
      direction: 'in',
      status: { in: ['unmatched', 'matched'] },
      occurredOn: { gte: dateFromISO(addDays(input.occurredOn, -WINDOW_DAYS))!, lte: dateFromISO(addDays(input.occurredOn, WINDOW_DAYS))! },
    },
    orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
    include: {
      payments: {
        where: { voidedAt: null },
        orderBy: { statementPart: 'asc' },
        select: { id: true, customerId: true, grossTetri: true, rental: { select: { number: true } }, sale: { select: { number: true } }, serviceJob: { select: { number: true } } },
      },
    },
  });
  const same = rows
    .map((row) => ({ row, line: storedLine(row) }))
    .filter(({ line }) => lineGross(line) === gross || line.amountTetri === net || line.amountTetri === gross);
  if (same.length === 0) return [];

  // Who a waiting line names, read only when one has words to read.
  const texts = same.filter(({ row }) => row.status === 'unmatched').map(({ row }) => [row.payer, row.purpose].filter(Boolean).join(' '));
  const customers = texts.some(Boolean)
    ? await tx.customer.findMany({ where: { archived: false }, select: { id: true, name: true, nameKa: true, nameLat: true } })
    : [];
  const namesSomebodyElse = (text: string): boolean => {
    if (!text) return false;
    const named = customers.filter((c) => nameMatches(text, [c.name, c.nameKa, c.nameLat]));
    return named.length > 0 && !named.some((c) => c.id === input.customerId);
  };

  const out: InBank[] = [];
  for (const { row, line } of same) {
    let payment: InBank['payment'] = null;
    if (row.status === 'matched') {
      // Cash taken to the bank is matched without a payment: not a customer's money.
      const own = row.payments.find((p) => input.customerId != null && p.customerId === input.customerId);
      if (!own) continue;
      payment = { id: own.id, number: own.rental?.number ?? own.sale?.number ?? own.serviceJob?.number ?? null, grossTetri: own.grossTetri };
    } else if (namesSomebodyElse([row.payer, row.purpose].filter(Boolean).join(' '))) {
      continue;
    }
    out.push({
      lineId: row.id,
      bank: row.bank,
      occurredOn: isoDate(row.occurredOn)!,
      amountTetri: row.amountTetri,
      grossTetri: lineGross(line),
      payer: row.payer,
      purpose: row.purpose,
      payment,
    });
  }
  // The nearest day first; on the same day, a line already counted before one waiting.
  const distance = (l: InBank) => Math.abs(daysBetween(l.occurredOn, input.occurredOn));
  return out.sort((a, b) => distance(a) - distance(b) || Number(b.payment != null) - Number(a.payment != null));
}
