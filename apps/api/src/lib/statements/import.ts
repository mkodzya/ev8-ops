import { createHash } from 'node:crypto';
import { addDays } from '@ev8/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { dateFromISO, isoDate } from '../dates.js';
import { prisma } from '../db.js';
import { recomputeRental, recordPaymentTx } from '../payments.js';
import { serviceOwed } from '../money.js';
import { cardOf, parseStatement, type ParsedLine } from './parse.js';
import { decide, lineGross, loadCtx, type Ctx, type Decision, type Line } from './reconcile.js';
import { alreadyIn, type AlreadyIn } from './sameLine.js';

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

/**
 * Which lines are in already. A line is in when its key is; a Bank of
 * Georgia line is in, too, when the same operation came from its other
 * source — a file against the API, or the day's pull against the nightly
 * statement (`sameLine.ts`, ADR-0021).
 */
export async function knownLines<T extends ParsedLine>(parsed: { bank: 'bog' | 'tbc'; lines: T[] }): Promise<AlreadyIn<T>> {
  const select = { naturalKey: true, docNo: true, occurredOn: true, direction: true, amountTetri: true } as const;
  const byKey = await prisma.statementLine.findMany({ where: { bank: parsed.bank, naturalKey: { in: parsed.lines.map((l) => l.naturalKey) } }, select });
  let near: typeof byKey = [];
  if (parsed.bank === 'bog' && parsed.lines.length > 0) {
    const days = parsed.lines.map((l) => l.occurredOn).sort();
    near = await prisma.statementLine.findMany({
      where: { bank: 'bog', occurredOn: { gte: dateFromISO(addDays(days[0]!, -1))!, lte: dateFromISO(addDays(days[days.length - 1]!, 1))! } },
      select,
    });
  }
  const stored = new Map([...byKey, ...near].map((l) => [l.naturalKey, { ...l, occurredOn: isoDate(l.occurredOn)! }]));
  return alreadyIn(parsed.lines, [...stored.values()]);
}

async function freshLines<T extends ParsedLine>(parsed: { bank: 'bog' | 'tbc'; lines: T[] }): Promise<T[]> {
  return (await knownLines(parsed)).fresh;
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

  const { recorded, matched } = await ingest({ statementId: statement.id, bank: parsed.bank, actorId: input.actorId, lines: fresh });

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
 * Put new lines into the queue under a statement, and let each settle what
 * it can — the same for a file and for the bank's API. A line that is money
 * entered by hand is linked to it (B2-03), cash taken to the bank to its
 * deposit, a line two signs agree on is attached by its rule; the rest wait
 * in "Разобрать" for a person. `actorId` is the person who uploaded the file,
 * or null when the bank was asked by the stand itself.
 */
export async function ingest(input: { statementId: string; bank: 'bog' | 'tbc'; actorId: string | null; lines: ParsedLine[] }): Promise<{ recorded: number; matched: number }> {
  let recorded = 0;
  let matched = 0;
  let ctx = await loadCtx();
  for (const line of input.lines) {
    const d = decide(asLine(input.bank, line), ctx);
    await prisma.$transaction(async (tx) => {
      const row = await tx.statementLine.create({
        data: {
          statementId: input.statementId,
          bank: input.bank,
          naturalKey: line.naturalKey,
          docNo: line.docNo ?? null,
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
  return { recorded, matched };
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
export async function linkBankDeposit(tx: Tx, actorId: string | null, lineId: string, bankDepositId: string): Promise<void> {
  await claim(tx, lineId, 'bank_deposit');
  const done = await tx.bankCashDeposit.updateMany({ where: { id: bankDepositId, statementLineId: null, voidedAt: null }, data: { statementLineId: lineId } });
  if (done.count === 0) throw conflict('deposit_has_line', 'That bank deposit already has its line.');
  await tx.statementLine.update({ where: { id: lineId }, data: { resolution: 'bank_deposit', resolvedById: actorId, resolvedAt: new Date() } });
}

/** What a line, or a part of it, pays: a rental, a sale, a repair, or the customer's account. */
export interface LineTarget {
  rentalId?: string | null;
  saleId?: string | null;
  serviceJobId?: string | null;
  customerId?: string | null;
  /** One fine or other charge of a rental: the money goes on it alone (ADR-0023). */
  chargeId?: string | null;
  /** A week carried over as paid: this money is what paid it (ADR-0023). */
  carriedPeriodId?: string | null;
}

/** A part that is a new fine on a rental, charged and paid in the same split (Mika, 15.10.2026). */
export interface NewFine {
  fineRentalId?: string | null;
  fineReason?: string | null;
}

/** A charge of a rental and what of it is still open. */
async function chargeOwed(tx: Tx, chargeId: string): Promise<{ rentalId: string; customerId: string; openTetri: number }> {
  const c = await tx.rentalCharge.findUnique({
    where: { id: chargeId },
    include: { rental: { select: { customerId: true } }, allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } },
  });
  if (!c || c.voidedAt) throw notFound('charge_not_found', 'No such charge on the rental.');
  return { rentalId: c.rentalId, customerId: c.rental.customerId, openTetri: c.amountTetri - c.allocations.reduce((n, a) => n + a.amountTetri, 0) };
}

/** A week carried over as paid that no bank money stands behind yet. */
async function carriedWeek(tx: Tx, periodId: string): Promise<{ rentalId: string; customerId: string; seq: number; amountTetri: number }> {
  const w = await tx.rentalPeriod.findUnique({ where: { id: periodId }, include: { rental: { select: { customerId: true } } } });
  if (!w) throw notFound('week_not_found', 'No such week in this rental.');
  if (!w.paidBeforeTransfer) throw conflict('week_not_carried', 'This week was not carried over as paid.');
  if (w.carriedPaymentId) throw conflict('week_has_bank_money', 'This week already has its bank money.');
  return { rentalId: w.rentalId, customerId: w.rental.customerId, seq: w.seq, amountTetri: w.amountTetri };
}

type StoredLine = NonNullable<Awaited<ReturnType<Tx['statementLine']['findUnique']>>>;

/** A line as money: a card line is what the customer paid less what the acquirer kept (PAY-04). */
function moneyOf(line: StoredLine): { channel: 'transfer' | 'acquiring'; grossTetri: number; feeTetri: number } {
  // Read from the line as it is stored: a card line loaded before its wording was known says so in its raw text.
  const card = cardOf(line);
  const channel: 'transfer' | 'acquiring' = card ? 'acquiring' : 'transfer';
  const asOne: Line = {
    occurredOn: isoDate(line.occurredOn)!,
    direction: 'in',
    amountTetri: line.amountTetri,
    grossTetri: card?.grossTetri ?? null,
    feeTetri: card?.feeTetri ?? null,
    payer: line.payer,
    purpose: line.purpose,
    raw: line.raw,
    channel,
    bank: line.bank,
  };
  const gross = lineGross(asOne);
  const fee = channel === 'acquiring' ? asOne.feeTetri ?? Math.max(0, gross - line.amountTetri) : 0;
  return { channel, grossTetri: gross, feeTetri: fee };
}

/**
 * A payment that goes on one charge, or that is a carried week's money
 * (ADR-0023). Not spread over the rental: the person said where it goes. A
 * carried week stays paid as it was; the money is placed on it so that it is
 * neither the customer's credit nor paid onto the next week.
 */
async function placedPayment(
  tx: Tx,
  actorId: string | null,
  line: StoredLine,
  money: { channel: 'transfer' | 'acquiring'; grossTetri: number; feeTetri: number },
  target: { chargeId?: string | null; carriedPeriodId?: string | null },
  part: number,
): Promise<string> {
  const to = target.chargeId ? await chargeOwed(tx, target.chargeId) : await carriedWeek(tx, target.carriedPeriodId!);
  const p = await tx.payment.create({
    data: {
      occurredOn: line.occurredOn,
      direction: 'in',
      channel: money.channel,
      grossTetri: money.grossTetri,
      feeTetri: money.feeTetri,
      netTetri: money.grossTetri - money.feeTetri,
      customerId: to.customerId,
      rentalId: to.rentalId,
      kind: 'rent',
      bankText: line.raw.slice(0, 500),
      source: 'statement',
      createdById: actorId,
      statementLineId: line.id,
      statementPart: part,
    },
    select: { id: true },
  });
  await tx.paymentAllocation.create({
    data: {
      paymentId: p.id,
      target: target.chargeId ? 'charge' : 'period',
      chargeId: target.chargeId ?? null,
      periodId: target.carriedPeriodId ?? null,
      amountTetri: money.grossTetri,
    },
  });
  if (target.carriedPeriodId) {
    const done = await tx.rentalPeriod.updateMany({ where: { id: target.carriedPeriodId, carriedPaymentId: null }, data: { carriedPaymentId: p.id, updatedAt: new Date() } });
    if (done.count === 0) throw conflict('week_has_bank_money', 'This week already has its bank money.');
  }
  await recomputeRental(tx, to.rentalId);
  await tx.auditLog.create({
    data: {
      actorId,
      action: 'payment.record',
      entityType: 'payment',
      entityId: p.id,
      after: {
        occurredOn: isoDate(line.occurredOn),
        channel: money.channel,
        grossTetri: money.grossTetri,
        rentalId: to.rentalId,
        ...(target.chargeId ? { chargeId: target.chargeId } : { carriedWeek: 'seq' in to ? to.seq : null }),
      },
    },
  });
  return p.id;
}

/** One payment made of a line, or of one part of it. */
async function paymentOf(
  tx: Tx,
  actorId: string | null,
  line: StoredLine,
  money: { channel: 'transfer' | 'acquiring'; grossTetri: number; feeTetri: number },
  target: LineTarget,
  part: number,
): Promise<string> {
  if (target.chargeId || target.carriedPeriodId) return placedPayment(tx, actorId, line, money, target, part);
  if (target.serviceJobId) {
    const job = await serviceOwed(tx, target.serviceJobId);
    const p = await tx.payment.create({
      data: {
        occurredOn: line.occurredOn,
        direction: 'in',
        channel: money.channel,
        grossTetri: money.grossTetri,
        feeTetri: money.feeTetri,
        netTetri: money.grossTetri - money.feeTetri,
        customerId: job.customerId,
        serviceJobId: target.serviceJobId,
        kind: 'service',
        bankText: line.raw.slice(0, 500),
        source: 'statement',
        createdById: actorId,
        statementLineId: line.id,
        statementPart: part,
      },
      select: { id: true },
    });
    return p.id;
  }
  const r = await recordPaymentTx(tx, {
    actorId,
    occurredOn: isoDate(line.occurredOn)!,
    channel: money.channel,
    grossTetri: money.grossTetri,
    feeTetri: money.feeTetri,
    customerId: target.customerId ?? null,
    rentalId: target.rentalId ?? null,
    saleId: target.saleId ?? null,
    bankText: line.raw.slice(0, 500),
    note: null,
    source: 'statement',
    statementLineId: line.id,
    statementPart: part,
  });
  return r.id;
}

async function incomingLine(tx: Tx, lineId: string): Promise<StoredLine> {
  const line = await tx.statementLine.findUnique({ where: { id: lineId } });
  if (!line) throw notFound('line_not_found', 'No such statement line.');
  if (line.direction === 'out') throw conflict('outgoing_line', 'Money leaving the account is not a customer payment.');
  return line;
}

/** A customer's payment made of this line: a rental, a sale, a repair, or the customer's account. */
export async function attach(
  tx: Tx,
  input: { actorId: string | null; lineId: string; rule: string; reason?: unknown } & LineTarget,
): Promise<{ paymentId: string }> {
  const line = await incomingLine(tx, input.lineId);
  await claim(tx, line.id, input.rule);
  const paymentId = await paymentOf(tx, input.actorId, line, moneyOf(line), input, 1);
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

export const SPLIT_MAX = 9;

/**
 * One line, several records (meeting of 14.10.2026: one transfer for a rental
 * week and a repair). The parts are what the customer paid and add up to the
 * line's whole; on a card line the acquirer's fee is shared in proportion, the
 * last part taking the tetri the division leaves. Each part is its own
 * payment, so each record closes as if it had been paid apart. The parts live
 * and die together: voiding one voids them all and the line goes back to the
 * queue (payments.ts, voidPayment).
 */
export async function split(
  tx: Tx,
  input: { actorId: string; lineId: string; parts: (LineTarget & NewFine & { grossTetri: number })[] },
): Promise<{ paymentIds: string[] }> {
  const line = await incomingLine(tx, input.lineId);
  const parts = input.parts;
  if (parts.length < 2) throw badRequest('split_needs_two', 'A split has at least two parts.');
  if (parts.length > SPLIT_MAX) throw badRequest('split_too_many', `A split has at most ${SPLIT_MAX} parts.`);
  const keys = new Set<string>();
  for (const p of parts) {
    if (!Number.isInteger(p.grossTetri) || p.grossTetri <= 0) throw badRequest('split_bad_amount', 'Every part is a sum above zero.', { field: 'grossTetri' });
    const named = (
      [
        ['rental', p.rentalId],
        ['sale', p.saleId],
        ['repair', p.serviceJobId],
        ['account', p.customerId],
        ['charge', p.chargeId],
        ['week', p.carriedPeriodId],
        ['fine', p.fineRentalId],
      ] as const
    ).filter(([, id]) => !!id);
    if (named.length !== 1) throw badRequest('split_bad_target', 'Every part pays exactly one record.', { field: 'rentalId' });
    // A rental's rent and a new fine on the same rental are two records.
    const key = `${named[0]![0]}:${named[0]![1]}`;
    if (p.fineRentalId && !p.fineReason?.trim()) throw badRequest('missing_field', 'Say what the fine is for.', { field: 'fineReason' });
    if (keys.has(key)) throw badRequest('split_same_target', 'Two parts pay the same record: make them one.');
    keys.add(key);
  }
  const money = moneyOf(line);
  const sum = parts.reduce((n, p) => n + p.grossTetri, 0);
  if (sum !== money.grossTetri) {
    throw badRequest('split_sum', 'The parts must add up to the whole line.', { lineTetri: money.grossTetri, partsTetri: sum });
  }
  for (const p of parts) {
    if (p.serviceJobId) {
      const job = await serviceOwed(tx, p.serviceJobId);
      if (p.grossTetri > job.openTetri) throw conflict('split_over_repair', 'That part is more than the repair still owes.', { number: job.number, openTetri: job.openTetri });
    }
    if (p.chargeId) {
      const charge = await chargeOwed(tx, p.chargeId);
      if (p.grossTetri > charge.openTetri) throw conflict('split_over_charge', 'That part is more than the charge still owes.', { openTetri: charge.openTetri });
    }
    if (p.carriedPeriodId) {
      // The whole week or nothing: it was carried over paid in full.
      const week = await carriedWeek(tx, p.carriedPeriodId);
      if (p.grossTetri !== week.amountTetri) throw conflict('split_carried_week', 'A carried week is paid by exactly its price.', { amountTetri: week.amountTetri });
    }
  }

  await claim(tx, line.id, 'split');
  // A fine typed into the split is charged here, in the same transaction as
  // its payment: it exists only if the money that pays it is written too.
  for (const p of parts) {
    if (!p.fineRentalId) continue;
    const rental = await tx.rental.findUnique({ where: { id: p.fineRentalId }, select: { id: true } });
    if (!rental) throw notFound('rental_not_found', 'No such rental.');
    const fine = await tx.rentalCharge.create({ data: { rentalId: rental.id, kind: 'fine', amountTetri: p.grossTetri, note: p.fineReason!.trim(), createdById: input.actorId }, select: { id: true } });
    await tx.auditLog.create({
      data: { actorId: input.actorId, action: 'rental.charge.add', entityType: 'rental', entityId: rental.id, after: { chargeId: fine.id, kind: 'fine', amountTetri: p.grossTetri, statementLineId: line.id }, note: p.fineReason!.trim() },
    });
    p.chargeId = fine.id;
    p.fineRentalId = null;
  }
  const paymentIds: string[] = [];
  let feeLeft = money.feeTetri;
  for (const [i, p] of parts.entries()) {
    const last = i === parts.length - 1;
    const fee = last ? feeLeft : Math.floor((money.feeTetri * p.grossTetri) / money.grossTetri);
    feeLeft -= fee;
    paymentIds.push(await paymentOf(tx, input.actorId, line, { channel: money.channel, grossTetri: p.grossTetri, feeTetri: fee }, p, i + 1));
  }
  await tx.statementLine.update({ where: { id: line.id }, data: { paymentId: paymentIds[0] } });
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: 'statement.line.split',
      entityType: 'statement_line',
      entityId: line.id,
      after: {
        paymentIds,
        parts: parts.map((p) => ({
          grossTetri: p.grossTetri,
          rentalId: p.rentalId ?? null,
          saleId: p.saleId ?? null,
          serviceJobId: p.serviceJobId ?? null,
          customerId: p.customerId ?? null,
          chargeId: p.chargeId ?? null,
          carriedPeriodId: p.carriedPeriodId ?? null,
        })),
      },
    },
  });
  return { paymentIds };
}
