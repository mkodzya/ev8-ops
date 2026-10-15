import { acquiringFee, paidThrough, periodPayStatus, spreadOverOwed, todayISO, type Allocation } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { hasPerm, type Actor } from './auth.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { recordPaymentTx } from './payments.js';
import { recostPurchase } from './purchases.js';
import { rentalOwed, spreadRental } from './rentalMoney.js';
import { inBankAlready, type InBank } from './statements/inBank.js';
import { moveVehicle } from './vehicles.js';

// One way money moves (wave 2 §3.1). The money form, a card's "take money",
// "hand the deposit back" and "pay the supplier" all come here: one set of
// rules for who may do what, one answer to "what will this close" before it
// is written, and the same answer written after.

type Tx = Prisma.TransactionClient;

export const MONEY_KINDS = ['rent', 'sale', 'service', 'on_account', 'deposit_payout', 'buyback', 'supplier'] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];
export type Channel = 'cash' | 'acquiring' | 'transfer';

const OUT: readonly MoneyKind[] = ['deposit_payout', 'buyback', 'supplier'];
export const directionOf = (kind: MoneyKind): 'in' | 'out' => (OUT.includes(kind) ? 'out' : 'in');

export interface MoneyInput {
  kind: MoneyKind;
  rentalId?: string | null;
  saleId?: string | null;
  serviceJobId?: string | null;
  customerId?: string | null;
  purchaseId?: string | null;
  amountTetri: number;
  channel: Channel;
  occurredOn?: string | null;
  backdateReason?: string | null;
  note?: string | null;
  /** A deposit handed to someone other than the payer, and why. */
  paidTo?: string | null;
  paidToReason?: string | null;
  /** A supplier payment: what the supplier got, in the invoice's currency. */
  foreignMinor?: number | null;
  foreignCurrency?: string | null;
  /** A supplier payment: the bank's charge, a company expense. */
  bankFeeTetri?: number | null;
  /** A buy-back: where the moped goes. */
  toState?: 'available' | 'service';
  /** Bank lines of this sum the person was shown and said this money is not: another transfer (B11-03). */
  notBankLines?: string[] | null;
}

/** One thing a payment will close, in words the form can say. */
export interface Closes {
  target: 'deposit' | 'period' | 'instalment' | 'charge' | 'service' | 'sale' | 'purchase';
  amountTetri: number;
  /** What this thing asks for in full, and what was open on it before. */
  fullTetri: number;
  openTetri: number;
  seq?: number;
  startsOn?: string | null;
  endsOn?: string | null;
  dueOn?: string | null;
  number?: string | null;
}

export interface MoneyPlan {
  direction: 'in' | 'out';
  grossTetri: number;
  /** The acquirer's 1.5 % on a card, the bank's charge on a supplier transfer. */
  feeTetri: number;
  netTetri: number;
  closes: Closes[];
  /** More than was owed: the customer's credit (rent), waiting for the next week. */
  leftoverTetri: number;
  paidThroughBefore: string | null;
  paidThroughAfter: string | null;
  /** The most this kind of payment may be, when there is a ceiling (a deposit held). */
  limitTetri: number | null;
  /** A supplier payment in two currencies: GEL per unit of the invoice's currency. */
  rate: number | null;
}

function today(): string {
  return todayISO(new Date(), env.TZ);
}

/**
 * Who may do what (wave 2 §3.1). A manager takes cash, today, for a customer;
 * everything that goes out, comes through a bank, or is dated back is an
 * owner's.
 */
export function checkMoney(actor: Actor, input: MoneyInput): void {
  const owner = hasPerm(actor, 'payments.reconcile');
  if (!owner) {
    if (directionOf(input.kind) === 'out') throw forbidden('owner_only', 'Only an owner pays money out.');
    if (input.channel !== 'cash') throw forbidden('reconcile_required', 'Only an owner enters bank payments.');
    if (input.occurredOn && input.occurredOn !== today()) throw forbidden('owner_only_backdate', 'Only an owner dates a payment in the past.');
  }
  if (input.occurredOn && input.occurredOn > today()) throw badRequest('future_date', 'A payment cannot be dated in the future.', { field: 'occurredOn' });
  if (input.occurredOn && input.occurredOn < today() && !input.backdateReason?.trim()) {
    throw badRequest('missing_field', 'Say why the payment is dated in the past.', { field: 'backdateReason' });
  }
  if (input.kind === 'deposit_payout' && input.channel === 'acquiring') {
    throw badRequest('bad_channel', 'A deposit goes back in cash or by transfer.', { field: 'channel' });
  }
  if (input.kind === 'deposit_payout' && input.paidTo?.trim() && !input.paidToReason?.trim()) {
    throw badRequest('missing_field', 'Say why the deposit goes to someone else.', { field: 'paidToReason' });
  }
  if (input.kind === 'buyback' && !hasPerm(actor, 'sales.manage')) throw forbidden('owner_only', 'Only an owner buys a moped back.');
}

function feeFor(kind: MoneyKind, channel: Channel, gross: number, bankFee: number | null | undefined): number {
  if (directionOf(kind) === 'in') return channel === 'acquiring' ? acquiringFee(gross) : 0;
  return kind === 'supplier' ? Math.max(0, bankFee ?? 0) : 0;
}

/** What the payment would close, without writing anything. */
export async function planMoney(tx: Tx, input: MoneyInput): Promise<MoneyPlan> {
  const gross = input.amountTetri;
  const fee = feeFor(input.kind, input.channel, gross, input.bankFeeTetri);
  const base: MoneyPlan = {
    direction: directionOf(input.kind),
    grossTetri: gross,
    feeTetri: fee,
    netTetri: directionOf(input.kind) === 'in' ? gross - fee : gross + fee,
    closes: [],
    leftoverTetri: 0,
    paidThroughBefore: null,
    paidThroughAfter: null,
    limitTetri: null,
    rate: null,
  };

  switch (input.kind) {
    case 'rent': {
      if (!input.rentalId) throw badRequest('missing_field', 'rentalId is required', { field: 'rentalId' });
      const plan = await planRental(tx, input.rentalId, gross);
      return { ...base, ...plan };
    }
    case 'on_account': {
      if (!input.customerId) throw badRequest('missing_field', 'customerId is required', { field: 'customerId' });
      // Money goes to the card the person actually has (crit. 33, QA-W5-03).
      const card = await tx.customer.findUnique({ where: { id: input.customerId }, select: { archived: true } });
      if (card?.archived) throw conflict('customer_archived', 'This card was merged into another one; take the money there.');
      // The same order recordPayment follows: open rentals, oldest first.
      const rentals = await tx.rental.findMany({
        where: { customerId: input.customerId, status: { in: ['booked', 'active', 'overdue', 'paused', 'disputed'] } },
        orderBy: { pickedUpOn: 'asc' },
        select: { id: true },
      });
      let left = gross;
      const closes: Closes[] = [];
      for (const r of rentals) {
        if (left <= 0) break;
        const plan = await planRental(tx, r.id, left);
        closes.push(...plan.closes);
        left = plan.leftoverTetri;
      }
      return { ...base, closes, leftoverTetri: left };
    }
    case 'sale': {
      if (!input.saleId) throw badRequest('missing_field', 'saleId is required', { field: 'saleId' });
      const sale = await tx.sale.findUnique({ where: { id: input.saleId }, include: { instalments: { orderBy: { seq: 'asc' } } } });
      if (!sale) throw notFound('sale_not_found', 'No such sale.');
      if (sale.status !== 'active') throw conflict('sale_closed', 'This sale is closed.');
      const spread = spreadOverOwed(gross, sale.instalments.map((i) => ({ id: i.id, seq: i.seq, amountTetri: i.amountTetri, paidTetri: i.paidTetri })), 'instalment');
      const byId = new Map(sale.instalments.map((i) => [i.id, i]));
      return {
        ...base,
        closes: spread.allocations.map((a) => {
          const i = byId.get(a.id)!;
          return { target: 'instalment' as const, amountTetri: a.amountTetri, fullTetri: i.amountTetri, openTetri: i.amountTetri - i.paidTetri, seq: i.seq, dueOn: isoDate(i.dueOn) };
        }),
        leftoverTetri: spread.leftoverTetri,
      };
    }
    case 'service': {
      if (!input.serviceJobId) throw badRequest('missing_field', 'serviceJobId is required', { field: 'serviceJobId' });
      const job = await serviceOwed(tx, input.serviceJobId);
      if (gross > job.openTetri) throw conflict('over_open', 'That is more than the repair still asks for.', { field: 'amountTetri', openTetri: job.openTetri });
      return { ...base, closes: [{ target: 'service', amountTetri: gross, fullTetri: job.chargedTetri, openTetri: job.openTetri, number: job.number }], limitTetri: job.openTetri };
    }
    case 'deposit_payout': {
      if (!input.rentalId) throw badRequest('missing_field', 'rentalId is required', { field: 'rentalId' });
      const d = await depositMoney(tx, input.rentalId);
      if (gross > d.heldTetri) throw conflict('over_held', 'More than the deposit we hold cannot go back.', { field: 'amountTetri', heldTetri: d.heldTetri });
      return { ...base, closes: [{ target: 'deposit', amountTetri: gross, fullTetri: d.amountTetri, openTetri: d.heldTetri }], limitTetri: d.heldTetri };
    }
    case 'buyback': {
      if (!input.saleId) throw badRequest('missing_field', 'saleId is required', { field: 'saleId' });
      const sale = await tx.sale.findUnique({ where: { id: input.saleId }, include: { instalments: true } });
      if (!sale) throw notFound('sale_not_found', 'No such sale.');
      if (sale.status !== 'active') throw conflict('sale_closed', 'This sale is already closed.');
      const open = sale.instalments.reduce((n, i) => n + Math.max(0, i.amountTetri - i.paidTetri), 0);
      // After a buy-back the buyer owes nothing on this sale (M8).
      return { ...base, closes: [{ target: 'sale', amountTetri: 0, fullTetri: sale.priceTetri, openTetri: open, number: sale.number }] };
    }
    case 'supplier': {
      if (!input.purchaseId) throw badRequest('missing_field', 'purchaseId is required', { field: 'purchaseId' });
      const p = await tx.purchase.findUnique({ where: { id: input.purchaseId }, select: { number: true, status: true } });
      if (!p) throw notFound('purchase_not_found', 'No such order.');
      if (p.status === 'cancelled') throw conflict('purchase_closed', 'This order is cancelled.');
      const rate = input.foreignMinor ? Math.round((gross / Number(input.foreignMinor)) * 100000) / 100000 : null;
      return { ...base, closes: [{ target: 'purchase', amountTetri: gross, fullTetri: gross, openTetri: gross, number: p.number }], rate };
    }
  }
}

async function planRental(tx: Tx, rentalId: string, gross: number): Promise<Pick<MoneyPlan, 'closes' | 'leftoverTetri' | 'paidThroughBefore' | 'paidThroughAfter'>> {
  const exists = await tx.rental.findUnique({ where: { id: rentalId }, select: { id: true } });
  if (!exists) throw notFound('rental_not_found', 'No such rental.');
  const owed = await rentalOwed(tx, rentalId);
  const { periods, deposit } = owed;
  const spread = spreadRental(gross, owed);
  const added = new Map<string, number>(spread.allocations.map((a: Allocation) => [a.id, a.amountTetri]));
  const rows = (extra: boolean) =>
    periods.map((p) => ({ seq: p.seq, endsOn: isoDate(p.endsOn)!, payStatus: periodPayStatus(p.amountTetri, p.paidTetri + (extra ? added.get(p.id) ?? 0 : 0)) }));
  // Everything owed now is listed, the part this payment does not reach at 0:
  // "deposit 100 of 180, week 0 of 150" says what stays owed (§3.1, crit. 3).
  const today = todayISO(new Date(), env.TZ);
  const closes: Closes[] = [];
  if (deposit && deposit.amountTetri > deposit.paidTetri) {
    closes.push({ target: 'deposit', amountTetri: added.get(deposit.id) ?? 0, fullTetri: deposit.amountTetri, openTetri: deposit.amountTetri - deposit.paidTetri });
  }
  for (const p of periods) {
    const amount = added.get(p.id) ?? 0;
    if (p.paidTetri >= p.amountTetri || (amount === 0 && isoDate(p.startsOn)! > today)) continue;
    closes.push({ target: 'period', amountTetri: amount, fullTetri: p.amountTetri, openTetri: p.amountTetri - p.paidTetri, seq: p.seq, startsOn: isoDate(p.startsOn), endsOn: isoDate(p.endsOn) });
  }
  // What a return charged — a key, days of delay — after the weeks (B5-08).
  for (const c of owed.charges) {
    if (c.paidTetri >= c.amountTetri) continue;
    closes.push({ target: 'charge', amountTetri: added.get(c.id) ?? 0, fullTetri: c.amountTetri, openTetri: c.amountTetri - c.paidTetri, number: c.kind });
  }
  return {
    closes,
    leftoverTetri: spread.leftoverTetri,
    paidThroughBefore: paidThrough(rows(false)),
    paidThroughAfter: paidThrough(rows(true)),
  };
}

/** A repair charged to the customer: what it came to less what the deposit covered, and what is still open. */
export async function serviceOwed(tx: Tx | typeof prisma, jobId: string): Promise<{ number: string; customerId: string | null; chargedTetri: number; paidTetri: number; openTetri: number }> {
  const job = await tx.serviceJob.findUnique({
    where: { id: jobId },
    include: { parts: { select: { qty: true, unitPriceTetri: true } }, payments: { where: { voidedAt: null }, select: { grossTetri: true } } },
  });
  if (!job) throw notFound('service_not_found', 'No such repair.');
  if (job.payer !== 'customer') throw conflict('not_customer_repair', 'This repair is the company’s, not the customer’s.');
  const total = job.labourTetri + job.parts.reduce((n, p) => n + p.qty * p.unitPriceTetri, 0);
  const charged = Math.max(0, total - job.withheldTetri);
  const paid = job.payments.reduce((n, p) => n + p.grossTetri, 0);
  return { number: job.number, customerId: job.customerId, chargedTetri: charged, paidTetri: paid, openTetri: Math.max(0, charged - paid) };
}

/** A deposit's money: paid in, kept, handed back — and what we still hold. */
export async function depositMoney(tx: Tx | typeof prisma, rentalId: string) {
  const d = await tx.deposit.findUnique({
    where: { rentalId },
    include: { payouts: { where: { voidedAt: null }, select: { grossTetri: true } } },
  });
  if (!d) throw notFound('deposit_not_found', 'No deposit on this rental.');
  const paidOut = d.paidOutBeforeTetri + d.payouts.reduce((n, p) => n + p.grossTetri, 0);
  return {
    id: d.id,
    amountTetri: d.amountTetri,
    paidTetri: d.paidTetri,
    withheldTetri: d.withheldTetri,
    returnedTetri: d.returnedTetri,
    paidOutTetri: paidOut,
    heldTetri: Math.max(0, d.paidTetri - d.withheldTetri - paidOut),
    toHandBackTetri: Math.max(0, d.returnedTetri - paidOut),
  };
}

/** Money a customer brings, which a bank line may already be. */
const FROM_CUSTOMER: readonly MoneyKind[] = ['rent', 'sale', 'service', 'on_account'];

/** Whose money it is: the customer of the record it pays. */
async function payerOf(tx: Tx, input: MoneyInput): Promise<string | null> {
  if (input.kind === 'rent' && input.rentalId) return (await tx.rental.findUnique({ where: { id: input.rentalId }, select: { customerId: true } }))?.customerId ?? null;
  if (input.kind === 'sale' && input.saleId) return (await tx.sale.findUnique({ where: { id: input.saleId }, select: { customerId: true } }))?.customerId ?? null;
  if (input.kind === 'service' && input.serviceJobId) return (await tx.serviceJob.findUnique({ where: { id: input.serviceJobId }, select: { customerId: true } }))?.customerId ?? null;
  return input.customerId ?? null;
}

/**
 * Bank lines this money may already be (B11-03, `statements/inBank.ts`): a
 * transfer or a card payment from a customer, of the same sum within ±3 days.
 * Cash and money going out have none.
 */
export async function bankLinesFor(tx: Tx, input: MoneyInput, occurredOn: string): Promise<InBank[]> {
  if (!FROM_CUSTOMER.includes(input.kind) || input.channel === 'cash') return [];
  return inBankAlready(tx, { customerId: await payerOf(tx, input), grossTetri: input.amountTetri, channel: input.channel, occurredOn });
}

/** Write it. The plan is worked out again inside the transaction, so what is written is what was true then. */
export async function recordMoney(actor: Actor, input: MoneyInput): Promise<{ id: string; plan: MoneyPlan }> {
  checkMoney(actor, input);
  const occurredOn = input.occurredOn ?? today();
  const backdateReason = occurredOn < today() ? input.backdateReason?.trim() ?? null : null;
  return prisma.$transaction(async (tx) => {
    const plan = await planMoney(tx, input);
    // The bank sends its lines within minutes now, so the money may be in
    // already: written again by hand it would count twice. The form shows the
    // line first; a line the person has not seen refuses the write (B11-03).
    const notBankLines = input.notBankLines ?? [];
    const unseen = (await bankLinesFor(tx, input, occurredOn)).filter((l) => !notBankLines.includes(l.lineId));
    if (unseen.length > 0) {
      throw conflict('bank_line_exists', 'The bank has sent this money already: attach its line, or say this is another transfer.', { field: 'notBankLines', lines: unseen });
    }
    let id: string;
    if (input.kind === 'rent' || input.kind === 'sale' || input.kind === 'on_account') {
      const r = await recordPaymentTx(tx, {
        actorId: actor.id,
        occurredOn,
        channel: input.channel,
        grossTetri: plan.grossTetri,
        feeTetri: plan.feeTetri,
        customerId: input.customerId ?? null,
        rentalId: input.kind === 'rent' ? input.rentalId! : null,
        saleId: input.kind === 'sale' ? input.saleId! : null,
        bankText: null,
        note: input.note ?? null,
        source: 'manual',
        kind: input.kind,
        backdateReason,
        notBankLines: notBankLines.length > 0 ? notBankLines : undefined,
      });
      id = r.id;
    } else {
      id = await writeOther(tx, actor, input, plan, occurredOn, backdateReason);
    }
    return { id, plan };
  });
}

async function writeOther(tx: Tx, actor: Actor, input: MoneyInput, plan: MoneyPlan, occurredOn: string, backdateReason: string | null): Promise<string> {
  const common = {
    occurredOn: dateFromISO(occurredOn)!,
    direction: plan.direction,
    channel: input.channel,
    grossTetri: plan.grossTetri,
    feeTetri: plan.feeTetri,
    netTetri: plan.netTetri,
    note: input.note ?? null,
    source: 'manual' as const,
    createdById: actor.id,
    kind: input.kind,
    backdateReason,
  };
  let customerId: string | null = null;
  const extra: Record<string, unknown> = {};
  switch (input.kind) {
    case 'service': {
      const job = await serviceOwed(tx, input.serviceJobId!);
      customerId = job.customerId;
      extra.serviceJobId = input.serviceJobId;
      break;
    }
    case 'deposit_payout': {
      const d = await depositMoney(tx, input.rentalId!);
      const rental = await tx.rental.findUnique({ where: { id: input.rentalId! }, select: { customerId: true } });
      customerId = rental!.customerId;
      Object.assign(extra, { depositId: d.id, rentalId: input.rentalId, paidTo: input.paidTo?.trim() || null, paidToReason: input.paidTo?.trim() ? input.paidToReason?.trim() : null });
      break;
    }
    case 'buyback': {
      const sale = await tx.sale.findUnique({ where: { id: input.saleId! } });
      if (!sale!.vehicleId) throw conflict('no_vehicle', 'This sale names no moped in the fleet.');
      if (occurredOn < isoDate(sale!.soldOn)!) throw conflict('before_sale', 'A moped cannot be bought back before it was sold.');
      customerId = sale!.customerId;
      extra.saleId = sale!.id;
      await tx.sale.update({ where: { id: sale!.id }, data: { status: 'bought_back', boughtBackOn: dateFromISO(occurredOn)!, updatedAt: new Date() } });
      await moveVehicle(tx, { vehicleId: sale!.vehicleId, kind: 'bought_back', occurredOn, actorId: actor.id, reason: sale!.number });
      if (input.toState === 'service') {
        await moveVehicle(tx, { vehicleId: sale!.vehicleId, kind: 'manual', toState: 'service', occurredOn, actorId: actor.id, reason: `bought back under ${sale!.number}, needs work` });
      }
      break;
    }
    case 'supplier': {
      const p = await tx.purchase.findUnique({ where: { id: input.purchaseId! }, select: { supplierId: true } });
      customerId = p!.supplierId;
      Object.assign(extra, { purchaseId: input.purchaseId, foreignMinor: input.foreignMinor != null ? BigInt(input.foreignMinor) : null, foreignCurrency: input.foreignCurrency ?? null });
      break;
    }
    default:
      throw new Error(`not written here: ${input.kind}`);
  }
  const payment = await tx.payment.create({ data: { ...common, customerId, ...extra }, select: { id: true } });
  // The mopeds of a shipment are already out earning; their cost follows the
  // money the same day (§7). This sits here, on the one way money is written,
  // rather than on a route: the screen pays the supplier through the money
  // form, and a cost that only followed one of the two doors was a cost that
  // silently lied on the other (QA-W5-10).
  if (input.kind === 'supplier') await recostPurchase(tx, input.purchaseId!, actor.id, 'paid the supplier');
  await tx.auditLog.create({
    data: {
      actorId: actor.id,
      action: `payment.${input.kind}`,
      entityType: 'payment',
      entityId: payment.id,
      after: {
        occurredOn,
        channel: input.channel,
        grossTetri: plan.grossTetri,
        feeTetri: plan.feeTetri,
        kind: input.kind,
        paidTo: input.paidTo ?? null,
        paidToReason: input.paidToReason ?? null,
        rate: plan.rate,
        ...(input.notBankLines?.length ? { notBankLines: input.notBankLines } : {}),
      },
    },
  });
  return payment.id;
}
