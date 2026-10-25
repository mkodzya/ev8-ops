import { createHash } from 'node:crypto';
import { MAX_SHIFT_DAYS, addDays, isShiftDays, shiftMoneyTetri } from '@ev8/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { dateFromISO, isoDate } from '../dates.js';
import { prisma } from '../db.js';
import { recomputeRental, recordPaymentTx } from '../payments.js';
import { serviceOwed } from '../money.js';
import { goodsOwed } from '../goods.js';
import { shiftWeekTx } from '../weekShift.js';
import { cardOf, parseStatement, type ParsedLine } from './parse.js';
import { lineGross, loadCtx, type Ctx, type Decision, type Line } from './reconcile.js';
import { expenseKey, liveRules, sortByRule } from './expenses.js';
import { asideByRule, attachByRule, decideWithPayers, livePayerRules, type PayerAnswer } from './payers.js';
import { markOwnTransfers } from './ownTransfers.js';
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
 * Which lines are in already. A line is in when its key is; it is in, too,
 * when the same operation came from another source — a file against the
 * API, or the day's pull against the nightly statement (`sameLine.ts`,
 * ADR-0021; TBC, ADR-0026).
 */
export async function knownLines<T extends ParsedLine>(parsed: { bank: 'bog' | 'tbc'; lines: T[] }): Promise<AlreadyIn<T>> {
  const select = { naturalKey: true, docNo: true, occurredOn: true, direction: true, amountTetri: true } as const;
  const byKey = await prisma.statementLine.findMany({ where: { bank: parsed.bank, naturalKey: { in: parsed.lines.map((l) => l.naturalKey) } }, select });
  let near: typeof byKey = [];
  if (parsed.lines.length > 0) {
    const days = parsed.lines.map((l) => l.occurredOn).sort();
    near = await prisma.statementLine.findMany({
      where: { bank: parsed.bank, occurredOn: { gte: dateFromISO(addDays(days[0]!, -1))!, lte: dateFromISO(addDays(days[days.length - 1]!, 1))! } },
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
function spend(ctx: Ctx, d: Decision | PayerAnswer): void {
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
  // Payers a person chose to remember sort their lines in the preview as on the import (0069).
  const payers = await livePayerRules(prisma);
  let recorded = 0;
  let matched = 0;
  for (const l of fresh) {
    const d = decideWithPayers(asLine(parsed.bank, l), ctx, payers);
    spend(ctx, d);
    if (d.type === 'recorded' || d.type === 'bank_deposit') recorded++;
    else if (d.type === 'rule' || d.type === 'aside') matched++;
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
  // Payees a person chose to remember: their next outgoing line is sorted here (migration 0046).
  const rules = await liveRules(prisma);
  // Payers of money coming in, likewise (migration 0069).
  const payers = await livePayerRules(prisma);
  for (const line of input.lines) {
    const d = decideWithPayers(asLine(input.bank, line), ctx, payers);
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
      } else if (d.type === 'rule' && d.rule === 'payer_rule') {
        await attachByRule(tx, row.id, d, input.actorId);
        matched++;
      } else if (d.type === 'aside') {
        if (await asideByRule(tx, row.id, d, input.actorId)) matched++;
      } else if (d.type === 'rule') {
        // A goods sale's money names the sale, never the customer's account (ADR-0045).
        await attach(tx, {
          actorId: input.actorId,
          lineId: row.id,
          rule: d.rule,
          rentalId: d.target.rentalId ?? null,
          saleId: d.target.saleId ?? null,
          goodsSaleId: d.target.goodsSaleId ?? null,
          customerId: d.target.goodsSaleId ? null : d.customerId,
          reason: d.reason,
        });
        matched++;
      } else if (line.direction === 'out') {
        const key = expenseKey(line);
        const rule = key ? rules.get(key) : undefined;
        if (rule && (await sortByRule(tx, row.id, rule, input.actorId))) matched++;
      }
    });
    // A line that just settled a rental changes what the next can match.
    if (d.type === 'rule') ctx = await loadCtx();
    else spend(ctx, d);
  }
  // Money between the company's own accounts, once both halves may be in (ADR-0028).
  await markOwnTransfers();
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
  // Rent closed by a mechanic's work (0066) is no bank money: no line is ever its.
  const done = await tx.payment.updateMany({ where: { id: paymentId, statementLineId: null, voidedAt: null, channel: { not: 'offset' } }, data: { statementLineId: lineId } });
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
  /** A goods sale (ADR-0045): paid like a repair, never beyond what is open. */
  goodsSaleId?: string | null;
  customerId?: string | null;
  /** One fine or other charge of a rental: the money goes on it alone (ADR-0023). */
  chargeId?: string | null;
  /** A week carried over as paid: this money is what paid it (ADR-0023). */
  carriedPeriodId?: string | null;
  /** The rental's deposit alone — «Залог» in «Несколько услуг» (issue #13): never beyond what it still asks for. */
  depositRentalId?: string | null;
  /** The rental's weeks and charges, its deposit left alone: the deposit is a part of its own in the same split. */
  rentOnly?: boolean;
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
  /** What the part was for, in words: the reason of a move of the pay day (issue #12). */
  note: string | null = null,
): Promise<string> {
  if (target.chargeId || target.carriedPeriodId) return placedPayment(tx, actorId, line, money, target, part);
  if (target.depositRentalId) return depositPayment(tx, actorId, line, money, target.depositRentalId, part);
  if (target.goodsSaleId) {
    // Never beyond what is open: neither by hand nor by a rule (ADR-0045 §7).
    const sale = await goodsOwed(tx, target.goodsSaleId);
    if (sale.status !== 'active') throw conflict('goods_sale_closed', 'This goods sale is cancelled.');
    if (money.grossTetri > sale.openTetri) throw conflict('goods_over_open', 'That is more than the goods sale still asks for.', { number: sale.number, openTetri: sale.openTetri });
    const p = await tx.payment.create({
      data: {
        occurredOn: line.occurredOn,
        direction: 'in',
        channel: money.channel,
        grossTetri: money.grossTetri,
        feeTetri: money.feeTetri,
        netTetri: money.grossTetri - money.feeTetri,
        customerId: sale.customerId,
        goodsSaleId: target.goodsSaleId,
        kind: 'goods',
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
    note,
    source: 'statement',
    statementLineId: line.id,
    statementPart: part,
    noDeposit: target.rentOnly === true,
  });
  return r.id;
}

/** What a rental's deposit still asks for, while the rental runs. */
async function depositOpen(tx: Tx, rentalId: string): Promise<{ id: string; customerId: string; number: string; openTetri: number }> {
  const r = await tx.rental.findUnique({ where: { id: rentalId }, select: { customerId: true, number: true, status: true, deposit: { select: { id: true, amountTetri: true, paidTetri: true } } } });
  if (!r) throw notFound('rental_not_found', 'No such rental.');
  if (!r.deposit || r.status === 'returned') throw conflict('split_over_deposit', 'This rental’s deposit asks for nothing more.', { number: r.number, openTetri: 0 });
  return { id: r.deposit.id, customerId: r.customerId, number: r.number, openTetri: Math.max(0, r.deposit.amountTetri - r.deposit.paidTetri) };
}

/** A part that is the rental's deposit alone (issue #13): «Залог 180 + Аренда 70». */
async function depositPayment(
  tx: Tx,
  actorId: string | null,
  line: StoredLine,
  money: { channel: 'transfer' | 'acquiring'; grossTetri: number; feeTetri: number },
  rentalId: string,
  part: number,
): Promise<string> {
  const d = await depositOpen(tx, rentalId);
  if (money.grossTetri > d.openTetri) throw conflict('split_over_deposit', 'That part is more than the deposit still asks for.', { number: d.number, openTetri: d.openTetri });
  const p = await tx.payment.create({
    data: {
      occurredOn: line.occurredOn,
      direction: 'in',
      channel: money.channel,
      grossTetri: money.grossTetri,
      feeTetri: money.feeTetri,
      netTetri: money.grossTetri - money.feeTetri,
      customerId: d.customerId,
      rentalId,
      kind: 'rent',
      bankText: line.raw.slice(0, 500),
      source: 'statement',
      createdById: actorId,
      statementLineId: line.id,
      statementPart: part,
    },
    select: { id: true },
  });
  await tx.paymentAllocation.create({ data: { paymentId: p.id, target: 'deposit', depositId: d.id, amountTetri: money.grossTetri } });
  await recomputeRental(tx, rentalId);
  await tx.auditLog.create({
    data: { actorId, action: 'payment.record', entityType: 'payment', entityId: p.id, after: { occurredOn: isoDate(line.occurredOn), channel: money.channel, grossTetri: money.grossTetri, rentalId, deposit: true } },
  });
  return p.id;
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
        ...(input.goodsSaleId ? { goodsSaleId: input.goodsSaleId } : {}),
        customerId: input.customerId ?? null,
        reason: (input.reason ?? null) as object | null,
      },
    },
  });
  return { paymentId };
}

export const SPLIT_MAX = 9;

/**
 * «Перенос дня оплаты» in «Разнести» (issue #12 of the director, Mika's «А» of
 * 23.10.2026; ADR-0041, addendum): the renter's latest week moved by the pay
 * day he asked for, in the same transaction as the line's payments. `days`
 * above nought — longer, and `extraTetri` is money of the line, written as a
 * rent payment of its own after the move; below nought — shorter, and
 * `extraTetri` is the discount, no money of the line.
 */
export interface SplitShift {
  rentalId: string;
  seq: number;
  days: number;
  extraTetri: number | null;
  reason: string | null;
}

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
  input: { actorId: string; lineId: string; parts: (LineTarget & NewFine & { grossTetri: number })[]; shift?: SplitShift | null; today?: string },
): Promise<{ paymentIds: string[] }> {
  const line = await incomingLine(tx, input.lineId);
  const parts = input.parts;
  const shift = input.shift ?? null;
  // A move of the pay day is one more thing the line writes: with it, one
  // part of money is enough — or none, when the line is the move's money
  // alone. The sum below still asks the line to be placed whole.
  if (!shift && parts.length < 2) throw badRequest('split_needs_two', 'A split has at least two parts.');
  if (parts.length > SPLIT_MAX) throw badRequest('split_too_many', `A split has at most ${SPLIT_MAX} parts.`);
  if (shift) {
    if (!isShiftDays(shift.days) || shift.days === 0) {
      throw badRequest('shift_days_range', `A week is made 1 to ${MAX_SHIFT_DAYS} days longer or shorter.`, { field: 'days' });
    }
    if (shift.extraTetri == null) throw badRequest('missing_field', 'Say what the days are worth.', { field: 'extraTetri' });
    if (!shift.reason) throw badRequest('missing_field', 'Say why the week is moved.', { field: 'reason' });
  }
  // A longer week's extra is money of the line; a shorter week's discount is not.
  const shiftMoney = shift && shift.days > 0 ? shift.extraTetri ?? 0 : 0;
  const keys = new Set<string>();
  for (const p of parts) {
    if (!Number.isInteger(p.grossTetri) || p.grossTetri <= 0) throw badRequest('split_bad_amount', 'Every part is a sum above zero.', { field: 'grossTetri' });
    const named = (
      [
        ['rental', p.rentalId],
        ['sale', p.saleId],
        ['repair', p.serviceJobId],
        ['goods', p.goodsSaleId],
        ['account', p.customerId],
        ['charge', p.chargeId],
        ['week', p.carriedPeriodId],
        ['fine', p.fineRentalId],
        ['deposit', p.depositRentalId],
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
  const sum = parts.reduce((n, p) => n + p.grossTetri, 0) + shiftMoney;
  if (sum !== money.grossTetri) {
    throw badRequest('split_sum', 'The parts must add up to the whole line.', { lineTetri: money.grossTetri, partsTetri: sum });
  }
  for (const p of parts) {
    if (p.serviceJobId) {
      const job = await serviceOwed(tx, p.serviceJobId);
      if (p.grossTetri > job.openTetri) throw conflict('split_over_repair', 'That part is more than the repair still owes.', { number: job.number, openTetri: job.openTetri });
    }
    if (p.goodsSaleId) {
      const sale = await goodsOwed(tx, p.goodsSaleId);
      if (sale.status !== 'active') throw conflict('goods_sale_closed', 'This goods sale is cancelled.');
      if (p.grossTetri > sale.openTetri) throw conflict('split_over_goods', 'That part is more than the goods sale still owes.', { number: sale.number, openTetri: sale.openTetri });
    }
    if (p.chargeId) {
      const charge = await chargeOwed(tx, p.chargeId);
      if (p.grossTetri > charge.openTetri) throw conflict('split_over_charge', 'That part is more than the charge still owes.', { openTetri: charge.openTetri });
    }
    if (p.depositRentalId) {
      const d = await depositOpen(tx, p.depositRentalId);
      if (p.grossTetri > d.openTetri) throw conflict('split_over_deposit', 'That part is more than the deposit still asks for.', { number: d.number, openTetri: d.openTetri });
    }
    if (p.carriedPeriodId) {
      // The whole week or nothing: it was carried over paid in full.
      const week = await carriedWeek(tx, p.carriedPeriodId);
      if (p.grossTetri !== week.amountTetri) throw conflict('split_carried_week', 'A carried week is paid by exactly its price.', { amountTetri: week.amountTetri });
    }
  }

  if (shift) {
    // Only the latest week, and only once the weeks before it are paid: a
    // line that pays an older week leaves the move for later (issue #12 —
    // «сначала оплатите текущую неделю»). In «Разнести» the move is counted
    // from the week as it is; a week moved already is changed on its card.
    const older = await tx.rentalPeriod.count({ where: { rentalId: shift.rentalId, seq: { lt: shift.seq }, payStatus: { not: 'paid' } } });
    if (older > 0) throw conflict('shift_older_week_open', 'An older week is still owed: the latest one is moved once it is paid.', { field: 'days' });
    const week = await tx.rentalPeriod.findUnique({ where: { rentalId_seq: { rentalId: shift.rentalId, seq: shift.seq } }, select: { extraDays: true } });
    if (week && week.extraDays !== 0) throw conflict('week_moved_already', 'This week was moved already: change the move on the rental card.', { field: 'days' });
  }

  await claim(tx, line.id, 'split');
  // The move first, so the week costs what the line pays for it: 150 + 20 = 170 (issue #12).
  if (shift) {
    if (!input.today) throw new Error('a split that moves a week needs today');
    await shiftWeekTx(tx, { actorId: input.actorId, rentalId: shift.rentalId, seq: shift.seq, days: shift.days, extraTetri: shift.extraTetri, reason: shift.reason, today: input.today });
  }
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
  // The longer week's extra is the last part: a rent payment of its own, with the move's reason in words.
  const written: (LineTarget & { grossTetri: number; note?: string | null; shift?: true })[] = [
    ...parts,
    ...(shift && shiftMoney > 0 ? [{ rentalId: shift.rentalId, grossTetri: shiftMoney, note: shift.reason, shift: true as const }] : []),
  ];
  const paymentIds: string[] = [];
  let feeLeft = money.feeTetri;
  for (const [i, p] of written.entries()) {
    const last = i === written.length - 1;
    const fee = last ? feeLeft : Math.floor((money.feeTetri * p.grossTetri) / money.grossTetri);
    feeLeft -= fee;
    paymentIds.push(await paymentOf(tx, input.actorId, line, { channel: money.channel, grossTetri: p.grossTetri, feeTetri: fee }, p, i + 1, p.note ?? null));
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
        parts: written.map((p) => ({
          grossTetri: p.grossTetri,
          rentalId: p.rentalId ?? null,
          saleId: p.saleId ?? null,
          serviceJobId: p.serviceJobId ?? null,
          ...(p.goodsSaleId ? { goodsSaleId: p.goodsSaleId } : {}),
          customerId: p.customerId ?? null,
          chargeId: p.chargeId ?? null,
          carriedPeriodId: p.carriedPeriodId ?? null,
          ...(p.depositRentalId ? { depositRentalId: p.depositRentalId } : {}),
          ...(p.shift ? { shift: true } : {}),
        })),
        // The pay day moved with the line (issue #12): the week, the days, the money with the days' sign.
        ...(shift ? { shift: { rentalId: shift.rentalId, seq: shift.seq, days: shift.days, extraTetri: shiftMoneyTetri(shift.days, shift.extraTetri ?? 0) } } : {}),
      },
    },
  });
  return { paymentIds };
}
