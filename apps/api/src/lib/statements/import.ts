import { createHash } from 'node:crypto';
import { grossOf, matchLine, type MatchCandidate } from '@ev8/shared';
import { dateFromISO, isoDate } from '../dates.js';
import { prisma } from '../db.js';
import { recordPayment } from '../payments.js';
import { parseStatement, type ParsedLine } from './parse.js';

// Loading a statement and letting it settle what it can (PAY-01, PAY-02).
//
// Two properties this has to have, and both are about not making things
// worse than doing it by hand:
//   * loading the same file twice changes nothing the second time;
//   * a line only becomes a payment when exactly one rental can own it.
// Everything else waits in the queue for a person (PAY-03).

export interface ImportResult {
  statementId: string;
  bank: 'bog' | 'tbc';
  lineCount: number;
  newLines: number;
  matched: number;
  unmatched: number;
  outgoing: number;
}

/** Everything the rules need to know about the rentals money could belong to. */
export async function matchCandidates(): Promise<MatchCandidate[]> {
  const rentals = await prisma.rental.findMany({
    where: { status: { in: ['booked', 'active', 'overdue', 'paused', 'disputed'] } },
    include: {
      customer: { select: { id: true, name: true, nameKa: true, nameLat: true } },
      deposit: { select: { amountTetri: true, paidTetri: true } },
      periods: { orderBy: { seq: 'asc' }, select: { amountTetri: true, paidTetri: true } },
    },
  });
  return rentals.map((r) => {
    const openDeposit = r.deposit ? Math.max(0, r.deposit.amountTetri - r.deposit.paidTetri) : 0;
    const openPeriods = r.periods.map((p) => Math.max(0, p.amountTetri - p.paidTetri)).filter((n) => n > 0);
    return {
      rentalId: r.id,
      customerId: r.customerId,
      names: [r.customer.name, r.customer.nameKa, r.customer.nameLat],
      pickedUpOn: isoDate(r.pickedUpOn),
      openDepositTetri: openDeposit,
      openFirstPeriodTetri: openPeriods[0] ?? 0,
      openTotalTetri: openDeposit + openPeriods.reduce((n, x) => n + x, 0),
    };
  });
}

export interface PreviewResult {
  bank: 'bog' | 'tbc';
  account: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  lineCount: number;
  newLines: number;
  alreadyIn: number;
  incoming: number;
  outgoing: number;
  sample: { occurredOn: string; amountTetri: number; direction: 'in' | 'out'; payer: string | null; purpose: string | null }[];
}

/**
 * What this file would do, without doing it (U8). Reading a statement is the
 * one action here that cannot be undone by hand — a wrong file leaves rows
 * somebody has to unpick — so the wizard shows the count first and asks.
 *
 * It writes nothing: the same parse, the same natural keys, no inserts.
 */
export async function previewStatement(input: { fileName: string; text: string }): Promise<PreviewResult> {
  const parsed = parseStatement(input.text, { fileName: input.fileName });
  const known = new Set(
    (
      await prisma.statementLine.findMany({
        where: { bank: parsed.bank, naturalKey: { in: parsed.lines.map((l) => l.naturalKey) } },
        select: { naturalKey: true },
      })
    ).map((l) => l.naturalKey),
  );
  const fresh = parsed.lines.filter((l) => !known.has(l.naturalKey));
  return {
    bank: parsed.bank,
    account: parsed.account,
    periodFrom: parsed.periodFrom,
    periodTo: parsed.periodTo,
    lineCount: parsed.lines.length,
    newLines: fresh.length,
    alreadyIn: parsed.lines.length - fresh.length,
    incoming: fresh.filter((l) => l.direction === 'in').length,
    outgoing: fresh.filter((l) => l.direction === 'out').length,
    sample: fresh.slice(0, 5).map((l) => ({
      occurredOn: l.occurredOn,
      amountTetri: l.amountTetri,
      direction: l.direction,
      payer: l.payer,
      purpose: l.purpose,
    })),
  };
}

export async function importStatement(input: {
  actorId: string;
  fileName: string;
  text: string;
}): Promise<ImportResult> {
  const parsed = parseStatement(input.text, { fileName: input.fileName });
  const sha = createHash('sha256').update(input.text).digest('hex');

  const statement = await prisma.statement.create({
    data: {
      bank: parsed.bank,
      fileName: input.fileName.slice(0, 200),
      fileSha256: sha,
      account: parsed.account,
      periodFrom: dateFromISO(parsed.periodFrom),
      periodTo: dateFromISO(parsed.periodTo),
      lineCount: parsed.lines.length,
      uploadedById: input.actorId,
    },
    select: { id: true },
  });

  // Which of these lines are already in, from an earlier upload of the same
  // file or of an overlapping period.
  const known = new Set(
    (
      await prisma.statementLine.findMany({
        where: { bank: parsed.bank, naturalKey: { in: parsed.lines.map((l) => l.naturalKey) } },
        select: { naturalKey: true },
      })
    ).map((l) => l.naturalKey),
  );

  const fresh = parsed.lines.filter((l) => !known.has(l.naturalKey));
  let matched = 0;
  let outgoing = 0;

  for (const line of fresh) {
    const row = await prisma.statementLine.create({
      data: {
        statementId: statement.id,
        bank: parsed.bank,
        naturalKey: line.naturalKey,
        occurredOn: dateFromISO(line.occurredOn)!,
        direction: line.direction,
        amountTetri: line.amountTetri,
        grossTetri: line.grossTetri,
        feeTetri: line.feeTetri,
        payer: line.payer,
        purpose: line.purpose,
        raw: line.raw,
        // Money going out is not a customer's payment. It is kept — the
        // purchases and the acquirer's own charges live there — but it is
        // not put in the queue of things to attach to a rental.
        status: line.direction === 'out' ? 'ignored' : 'unmatched',
      },
      select: { id: true },
    });
    if (line.direction === 'out') {
      outgoing++;
      continue;
    }
    // Candidates are re-read for every line: a line that just settled a
    // rental changes what the next line can match.
    const hit = matchLine(toMatchLine(line), await matchCandidates());
    if (!hit) continue;
    const payment = await recordPayment({
      actorId: input.actorId,
      occurredOn: line.occurredOn,
      channel: line.channel,
      grossTetri: hit.grossTetri,
      feeTetri: line.feeTetri ?? Math.max(0, hit.grossTetri - line.amountTetri),
      customerId: hit.customerId,
      rentalId: hit.rentalId,
      bankText: line.raw.slice(0, 500),
      note: null,
      source: 'statement',
    });
    await prisma.payment.update({ where: { id: payment.id }, data: { statementLineId: row.id } });
    await prisma.statementLine.update({
      where: { id: row.id },
      data: { status: 'matched', matchedRule: hit.rule, paymentId: payment.id },
    });
    matched++;
  }

  await prisma.statement.update({ where: { id: statement.id }, data: { newLines: fresh.length, matched } });
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: 'statement.import',
      entityType: 'statement',
      entityId: statement.id,
      after: {
        bank: parsed.bank,
        fileName: input.fileName,
        sha256: sha,
        lineCount: parsed.lines.length,
        newLines: fresh.length,
        matched,
      },
    },
  });

  return {
    statementId: statement.id,
    bank: parsed.bank,
    lineCount: parsed.lines.length,
    newLines: fresh.length,
    matched,
    unmatched: fresh.length - matched - outgoing,
    outgoing,
  };
}

function toMatchLine(line: ParsedLine) {
  return {
    amountTetri: line.amountTetri,
    grossTetri: line.grossTetri,
    payer: line.payer,
    purpose: line.purpose,
    occurredOn: line.occurredOn,
    channel: line.channel,
  };
}

/**
 * What a person needs in order to answer an unmatched line in two taps
 * (PAY-03): the rentals whose open amount is exactly this, and the ones
 * handed over that day.
 */
export interface Hint {
  rentalId: string;
  number: string;
  customer: string;
  why: 'amount' | 'pickup_day' | 'open';
}

/**
 * The same ranking for one line and for a queue of them. The candidates and
 * the rental numbers are read once by the caller: asking the database for
 * them per line turned a queue of two hundred into two hundred round trips.
 */
function rankHints(
  gross: number,
  occurredOn: string | null,
  candidates: Awaited<ReturnType<typeof matchCandidates>>,
  byId: Map<string, { number: string; customer: { name: string } }>,
): Hint[] {
  return candidates
    .map((c) => {
      const why: Hint['why'] | null =
        gross === c.openDepositTetri + c.openFirstPeriodTetri || gross === c.openFirstPeriodTetri || gross === c.openTotalTetri
          ? 'amount'
          : c.pickedUpOn === occurredOn
            ? 'pickup_day'
            : c.openTotalTetri > 0
              ? 'open'
              : null;
      const r = byId.get(c.rentalId);
      return why && r ? { rentalId: c.rentalId, number: r.number, customer: r.customer.name, why } : null;
    })
    .filter((h): h is Hint => h != null)
    .sort((a, b) => (a.why === b.why ? a.number.localeCompare(b.number) : a.why === 'amount' ? -1 : b.why === 'amount' ? 1 : a.why === 'pickup_day' ? -1 : 1))
    .slice(0, 12);
}

/** Hints for a whole queue, so the list can show them without being asked. */
export async function hintsForLines(rows: { id: string; amountTetri: number; grossTetri: number | null; occurredOn: Date }[]): Promise<Map<string, Hint[]>> {
  if (rows.length === 0) return new Map();
  const candidates = await matchCandidates();
  const numbers = await prisma.rental.findMany({
    where: { id: { in: candidates.map((c) => c.rentalId) } },
    select: { id: true, number: true, customer: { select: { name: true } } },
  });
  const byId = new Map(numbers.map((n) => [n.id, n]));
  const out = new Map<string, Hint[]>();
  for (const row of rows) {
    const channel: 'transfer' | 'acquiring' = row.grossTetri != null ? 'acquiring' : 'transfer';
    const occurredOn = isoDate(row.occurredOn);
    const gross = grossOf({ amountTetri: row.amountTetri, grossTetri: row.grossTetri, occurredOn: occurredOn!, channel });
    out.set(row.id, rankHints(gross, occurredOn, candidates, byId));
  }
  return out;
}

export async function hintsFor(lineId: string): Promise<{
  line: { id: string; occurredOn: string; amountTetri: number; grossTetri: number | null; payer: string | null; purpose: string | null; raw: string; channel: 'transfer' | 'acquiring' };
  hints: { rentalId: string; number: string; customer: string; why: 'amount' | 'pickup_day' | 'open' }[];
} | null> {
  const row = await prisma.statementLine.findUnique({ where: { id: lineId } });
  if (!row) return null;
  const channel: 'transfer' | 'acquiring' = row.grossTetri != null ? 'acquiring' : 'transfer';
  const gross = grossOf({
    amountTetri: row.amountTetri,
    grossTetri: row.grossTetri,
    occurredOn: isoDate(row.occurredOn)!,
    channel,
  });
  const candidates = await matchCandidates();
  const numbers = await prisma.rental.findMany({
    where: { id: { in: candidates.map((c) => c.rentalId) } },
    select: { id: true, number: true, customer: { select: { name: true } } },
  });
  const byId = new Map(numbers.map((n) => [n.id, n]));
  const occurredOn = isoDate(row.occurredOn);

  const hints = rankHints(gross, occurredOn, candidates, byId);

  return {
    line: {
      id: row.id,
      occurredOn: occurredOn!,
      amountTetri: row.amountTetri,
      grossTetri: row.grossTetri,
      payer: row.payer,
      purpose: row.purpose,
      raw: row.raw,
      channel,
    },
    hints,
  };
}
