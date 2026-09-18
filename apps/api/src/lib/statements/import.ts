import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { conflict, notFound } from '../errors.js';
import { dateFromISO, isoDate } from '../dates.js';
import { prisma } from '../db.js';
import { recordPaymentTx } from '../payments.js';
import { serviceOwed } from '../money.js';
import { parseStatement, type ParsedLine } from './parse.js';
import { decide, lineGross, loadCtx, type Ctx, type Decision, type Line } from './reconcile.js';

// Loading a statement and letting it settle what it can (PAY-01, PAY-02,
// wave 2 §3.2, §3.5). Two properties it has to have, and both are about not
// making things worse than doing it by hand:
//   * loading the same file twice changes nothing the second time;
//   * a line becomes a payment only when two signs agree, and a line that is
//     money already entered by hand is linked to it, not written again.
// Everything else waits in "Разобрать" for a person.

type Tx = Prisma.TransactionClient;

export interface ImportResult {
  statementId: string;
  bank: 'bog' | 'tbc';
  lineCount: number;
  newLines: number;
  /** Linked to a payment entered by hand, or to cash taken to the bank. */
  recorded: number;
  /** Attached by a rule. */
  matched: number;
  /** Left for a person. */
  unmatched: number;
  incoming: number;
  outgoing: number;
}

export interface PreviewResult extends Omit<ImportResult, 'statementId'> {
  account: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  alreadyIn: number;
  sample: { occurredOn: string; amountTetri: number; direction: 'in' | 'out'; payer: string | null; purpose: string | null }[];
}

function asLine(bank: 'bog' | 'tbc', l: ParsedLine): Line {
  return { ...l, bank };
}

async function freshLines(parsed: { bank: 'bog' | 'tbc'; lines: ParsedLine[] }): Promise<ParsedLine[]> {
  const known = new Set(
    (
      await prisma.statementLine.findMany({
        where: { bank: parsed.bank, naturalKey: { in: parsed.lines.map((l) => l.naturalKey) } },
        select: { naturalKey: true },
      })
    ).map((l) => l.naturalKey),
  );
  return parsed.lines.filter((l) => !known.has(l.naturalKey));
}

/** Take what a decision used off the table, so the next line does not reuse it. */
function spend(ctx: Ctx, d: Decision): void {
  if (d.type === 'recorded') ctx.payments = ctx.payments.filter((p) => p.id !== d.paymentId);
  if (d.type === 'bank_deposit') ctx.bankDeposits = ctx.bankDeposits.filter((b) => b.id !== d.bankDepositId);
}

/**
 * What this file would do, without doing it (§3.5 "предпросмотр до записи"):
 * new and known lines, in and out, and how many would link to what was
 * entered by hand, how many rules would attach, how many go to "Разобрать".
 */
export async function previewStatement(input: { fileName: string; text: string }): Promise<PreviewResult> {
  const parsed = parseStatement(input.text, { fileName: input.fileName });
  const fresh = await freshLines(parsed);
  const ctx = await loadCtx();
  let recorded = 0;
  let matched = 0;
  for (const l of fresh) {
    const d = decide(asLine(parsed.bank, l), ctx);
    spend(ctx, d);
    if (d.type === 'recorded' || d.type === 'bank_deposit') recorded++;
    else if (d.type === 'rule') matched++;
  }
  // The period as the bank states it, or else as the lines span it (§3.5, QA-W2-07).
  const days = parsed.lines.map((l) => l.occurredOn).sort();
  return {
    bank: parsed.bank,
    account: parsed.account,
    periodFrom: parsed.periodFrom ?? days[0] ?? null,
    periodTo: parsed.periodTo ?? days[days.length - 1] ?? null,
    lineCount: parsed.lines.length,
    newLines: fresh.length,
    alreadyIn: parsed.lines.length - fresh.length,
    incoming: fresh.filter((l) => l.direction === 'in').length,
    outgoing: fresh.filter((l) => l.direction === 'out').length,
    recorded,
    matched,
    unmatched: fresh.length - recorded - matched,
    sample: fresh.slice(0, 5).map((l) => ({ occurredOn: l.occurredOn, amountTetri: l.amountTetri, direction: l.direction, payer: l.payer, purpose: l.purpose })),
  };
}

export async function importStatement(input: { actorId: string; fileName: string; text: string }): Promise<ImportResult> {
  const parsed = parseStatement(input.text, { fileName: input.fileName });
  const sha = createHash('sha256').update(input.text).digest('hex');
  const fresh = await freshLines(parsed);

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

  let recorded = 0;
  let matched = 0;
  let ctx = await loadCtx();
  for (const line of fresh) {
    const d = decide(asLine(parsed.bank, line), ctx);
    await prisma.$transaction(async (tx) => {
      const row = await tx.statementLine.create({
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
          status: 'unmatched',
        },
        select: { id: true },
      });
      if (d.type === 'recorded') {
        await linkPayment(tx, row.id, d.paymentId, 'recorded');
        recorded++;
      } else if (d.type === 'bank_deposit') {
        await linkBankDeposit(tx, input.actorId, row.id, d.bankDepositId);
        recorded++;
      } else if (d.type === 'rule') {
        await attach(tx, { actorId: input.actorId, lineId: row.id, rule: d.rule, rentalId: d.target.rentalId ?? null, saleId: d.target.saleId ?? null, customerId: d.customerId, reason: d.reason });
        matched++;
      }
    });
    // A line that just settled a rental changes what the next can match.
    if (d.type === 'rule') ctx = await loadCtx();
    else spend(ctx, d);
  }

  await prisma.statement.update({ where: { id: statement.id }, data: { newLines: fresh.length, matched: matched + recorded } });
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: 'statement.import',
      entityType: 'statement',
      entityId: statement.id,
      after: { bank: parsed.bank, fileName: input.fileName, sha256: sha, lineCount: parsed.lines.length, newLines: fresh.length, recorded, matched },
    },
  });

  return {
    statementId: statement.id,
    bank: parsed.bank,
    lineCount: parsed.lines.length,
    newLines: fresh.length,
    recorded,
    matched,
    unmatched: fresh.length - recorded - matched,
    incoming: fresh.filter((l) => l.direction === 'in').length,
    outgoing: fresh.filter((l) => l.direction === 'out').length,
  };
}

/**
 * Claim a line for one answer. Two people — or one double tap — reaching the
 * same line: the first claims it, the second finds it taken (B2-02). The
 * unique index on a line's live payment is the second lock behind this one.
 */
async function claim(tx: Tx, lineId: string, rule: string): Promise<void> {
  const done = await tx.statementLine.updateMany({ where: { id: lineId, status: 'unmatched' }, data: { status: 'matched', matchedRule: rule } });
  if (done.count === 0) {
    const exists = await tx.statementLine.findUnique({ where: { id: lineId }, select: { id: true } });
    if (!exists) throw notFound('line_not_found', 'No such statement line.');
    throw conflict('already_matched', 'This line is already attached.');
  }
}

/** The line is money already entered by hand: link it, write nothing new (B2-03). */
export async function linkPayment(tx: Tx, lineId: string, paymentId: string, rule: string): Promise<void> {
  await claim(tx, lineId, rule);
  const done = await tx.payment.updateMany({ where: { id: paymentId, statementLineId: null, voidedAt: null }, data: { statementLineId: lineId } });
  if (done.count === 0) throw conflict('payment_has_line', 'That payment already has a bank line.');
  await tx.statementLine.update({ where: { id: lineId }, data: { paymentId } });
}

/** The line is cash an owner took to the bank. */
export async function linkBankDeposit(tx: Tx, actorId: string, lineId: string, bankDepositId: string): Promise<void> {
  await claim(tx, lineId, 'bank_deposit');
  const done = await tx.bankCashDeposit.updateMany({ where: { id: bankDepositId, statementLineId: null, voidedAt: null }, data: { statementLineId: lineId } });
  if (done.count === 0) throw conflict('deposit_has_line', 'That bank deposit already has its line.');
  await tx.statementLine.update({ where: { id: lineId }, data: { resolution: 'bank_deposit', resolvedById: actorId, resolvedAt: new Date() } });
}

/** A customer's payment made of this line: a rental, a sale, a repair, or the customer's account. */
export async function attach(
  tx: Tx,
  input: { actorId: string; lineId: string; rule: string; rentalId?: string | null; saleId?: string | null; serviceJobId?: string | null; customerId?: string | null; reason?: unknown },
): Promise<{ paymentId: string }> {
  const line = await tx.statementLine.findUnique({ where: { id: input.lineId } });
  if (!line) throw notFound('line_not_found', 'No such statement line.');
  if (line.direction === 'out') throw conflict('outgoing_line', 'Money leaving the account is not a customer payment.');
  await claim(tx, line.id, input.rule);

  const channel: 'transfer' | 'acquiring' = line.grossTetri != null || /Wallet\/domestic MC cards/i.test(line.raw) ? 'acquiring' : 'transfer';
  const asOne: Line = {
    occurredOn: isoDate(line.occurredOn)!,
    direction: 'in',
    amountTetri: line.amountTetri,
    grossTetri: line.grossTetri,
    feeTetri: line.feeTetri,
    payer: line.payer,
    purpose: line.purpose,
    raw: line.raw,
    channel,
    bank: line.bank,
  };
  const gross = lineGross(asOne);
  const fee = channel === 'acquiring' ? line.feeTetri ?? Math.max(0, gross - line.amountTetri) : 0;

  let paymentId: string;
  if (input.serviceJobId) {
    const job = await serviceOwed(tx, input.serviceJobId);
    const p = await tx.payment.create({
      data: {
        occurredOn: line.occurredOn,
        direction: 'in',
        channel,
        grossTetri: gross,
        feeTetri: fee,
        netTetri: gross - fee,
        customerId: job.customerId,
        serviceJobId: input.serviceJobId,
        kind: 'service',
        bankText: line.raw.slice(0, 500),
        source: 'statement',
        createdById: input.actorId,
        statementLineId: line.id,
      },
      select: { id: true },
    });
    paymentId = p.id;
  } else {
    const r = await recordPaymentTx(tx, {
      actorId: input.actorId,
      occurredOn: isoDate(line.occurredOn)!,
      channel,
      grossTetri: gross,
      feeTetri: fee,
      customerId: input.customerId ?? null,
      rentalId: input.rentalId ?? null,
      saleId: input.saleId ?? null,
      bankText: line.raw.slice(0, 500),
      note: null,
      source: 'statement',
      statementLineId: line.id,
    });
    paymentId = r.id;
  }
  await tx.statementLine.update({ where: { id: line.id }, data: { paymentId } });
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.rule === 'by_hand' ? 'statement.line.assign' : 'statement.line.rule',
      entityType: 'statement_line',
      entityId: line.id,
      after: {
        paymentId,
        rule: input.rule,
        rentalId: input.rentalId ?? null,
        saleId: input.saleId ?? null,
        serviceJobId: input.serviceJobId ?? null,
        customerId: input.customerId ?? null,
        reason: (input.reason ?? null) as object | null,
      },
    },
  });
  return { paymentId };
}
