// Goods sold over the counter (issue #11, ADR-0045; Mika 23.10.2026 «А»).
//
// A part off the shelf or a charger from the count, sold to an own customer
// or to a retail buyer with no card. One transaction writes the sale, takes
// the goods off the shelf or the count, and records the money paid at the
// counter — cash through the one money form's own writing, or a bank line
// that has already come — so a sale never exists without what it moved.
//
// The rules themselves are shared (`@ev8/shared` goods.ts): the VAT inside
// the price, what may be sold beyond the count, the stocktake question, what
// a cancellation does with each payment. This file reads the database for
// them and writes what they decide.
import {
  GOODS_MAX_LINES,
  GOODS_MAX_QTY,
  GOODS_UNDONE_AT_ONCE,
  GOODS_UNDO_MS,
  SELLABLE_COUNTED,
  cancelPlan,
  countedName,
  goodsCancelReason,
  goodsLineNets,
  goodsTotals,
  needsCountAnswer,
  paymentProblem,
  priceEdited,
  stockDecision,
  todayISO,
  type CountedGoods,
  type PromisedChannel,
  type StockDecision,
} from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { batteriesNow, countedItemLastCountOn } from '../routes/batteries.js';
import { hasPerm, type Actor } from './auth.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { checkMoney, planMoney, recordMoneyTx, type Closes } from './money.js';
import { rebookToCredit, voidPaymentTx } from './payments.js';
import { settleCredit } from './periods.js';
import { attach } from './statements/import.js';
import { inBankAlready, type InBank } from './statements/inBank.js';
import { lineGross, storedLine } from './statements/reconcile.js';
import { issueForGoodsLine, lastCountOn, partOnHandTx, returnGoodsLine, shelfCost } from './stock.js';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/** What the counter sends for one line. */
export interface GoodsLineInput {
  partId: string | null;
  countedItem: string | null;
  /** A counted item's model, as the seller typed it ("73V6A"). */
  spec: string | null;
  qty: number;
  /** Final, VAT inside. Null: not typed yet. */
  unitPriceTetri: number | null;
  /** A charger's cost, an owner's figure; a part's is the shelf's. */
  unitCostTetri: number | null;
  /** Sold beyond the count: the owner's words. */
  shortReason: string | null;
  /** The answer to «Пересчёт dd.mm уже не видел этот товар?»; null — not asked. */
  countedAlready: boolean | null;
}

export type PaidNow = { channel: 'cash'; amountTetri: number } | { statementLineId: string } | null;

export interface GoodsSaleInput {
  soldOn: string | null;
  backdateReason: string | null;
  customerId: string | null;
  buyerName: string | null;
  buyerPhone: string | null;
  lines: GoodsLineInput[];
  paidNow: PaidNow;
  promisedChannel: PromisedChannel | null;
  notes: string | null;
}

const today = () => todayISO(new Date(), env.TZ);

/** A cancelled sale's reason when its seller undid it at once. The screen says it in its language (shared `goodsCancelNote`). */
export const UNDONE_AT_ONCE = GOODS_UNDONE_AT_ONCE;

/**
 * A goods sale's money: what its lines come to, what its live payments of
 * the kind paid, and what is open — nought once it is cancelled. The
 * sibling of `serviceOwed`.
 */
export async function goodsOwed(
  db: Db,
  id: string,
): Promise<{ id: string; number: string; status: 'active' | 'cancelled'; customerId: string | null; promisedChannel: PromisedChannel | null; totalTetri: number; paidTetri: number; openTetri: number }> {
  const sale = await db.goodsSale.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      customerId: true,
      promisedChannel: true,
      lines: { select: { qty: true, unitPriceTetri: true } },
      payments: { where: { voidedAt: null, kind: 'goods' }, select: { grossTetri: true } },
    },
  });
  if (!sale) throw notFound('goods_sale_not_found', 'No such goods sale.');
  const total = goodsTotals(sale.lines).grossTetri;
  const paid = sale.payments.reduce((n, p) => n + p.grossTetri, 0);
  const status = sale.status === 'cancelled' ? 'cancelled' : 'active';
  return {
    id: sale.id,
    number: sale.number,
    status,
    customerId: sale.customerId,
    promisedChannel: (sale.promisedChannel as PromisedChannel | null) ?? null,
    totalTetri: total,
    paidTetri: paid,
    openTetri: status === 'active' ? Math.max(0, total - paid) : 0,
  };
}

/** One line as the counter would sell it now. */
export interface LinePlan {
  index: number;
  /** `part:<id>` or the counted item: what a lock and the running count are kept by. */
  key: string;
  partId: string | null;
  countedItem: CountedGoods | null;
  spec: string | null;
  name: string;
  nameKa: string | null;
  unit: string | null;
  qty: number;
  unitPriceTetri: number;
  shelfPriceTetri: number | null;
  unitCostTetri: number | null;
  /** What there is for this line, after the lines above it in the same sale took theirs. */
  available: number;
  lastCountOn: string | null;
  needsCountAnswer: boolean;
  decision: StockDecision;
  shortReason: string | null;
}

/**
 * The checks that need no stock: the shape of the lines, the dates, who may
 * type a cost. The same for the preview and the sale, except that the
 * preview lets a price or a reason not typed yet pass.
 */
function shapeChecks(actor: Actor, input: GoodsSaleInput, soldOn: string, strict: boolean): void {
  if (input.lines.length === 0) throw badRequest('goods_no_lines', 'Say what is sold.', { field: 'lines' });
  if (input.lines.length > GOODS_MAX_LINES) throw badRequest('goods_too_many_lines', `At most ${GOODS_MAX_LINES} lines a sale.`, { field: 'lines' });
  const seen = new Set<string>();
  input.lines.forEach((l, i) => {
    if ((l.partId == null) === (l.countedItem == null)) throw badRequest('goods_line_bad', 'A line is a part off the shelf or a counted item, one of the two.', { field: `lines[${i}]` });
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > GOODS_MAX_QTY) throw badRequest('goods_bad_qty', `From 1 to ${GOODS_MAX_QTY}.`, { field: `lines[${i}].qty` });
    if (l.countedItem != null && !(SELLABLE_COUNTED as readonly string[]).includes(l.countedItem)) {
      throw conflict('goods_item_not_sellable', 'This item is not sold yet.', { field: `lines[${i}].countedItem` });
    }
    const key = l.partId ? `part:${l.partId}` : `${l.countedItem}:${(l.spec ?? '').trim().toLowerCase()}`;
    if (seen.has(key)) throw badRequest('goods_same_item', 'The same item twice: make it one line.', { field: `lines[${i}]` });
    seen.add(key);
    if (strict && (l.unitPriceTetri == null || l.unitPriceTetri < 1)) throw badRequest('missing_field', 'Say the price.', { field: `lines[${i}].unitPriceTetri` });
    if (l.unitCostTetri != null && !hasPerm(actor, 'cost.view')) throw forbidden('owner_only', 'Only an owner names what an item cost.');
  });
  const now = today();
  if (soldOn > now) throw badRequest('future_date', 'A sale cannot be dated in the future.', { field: 'soldOn' });
  if (soldOn < now) {
    if (!hasPerm(actor, 'sales.manage')) throw forbidden('owner_only_backdate', 'Only an owner dates a sale in the past.');
    if (strict && !input.backdateReason?.trim()) throw badRequest('missing_field', 'Say why the sale is dated in the past.', { field: 'backdateReason' });
  }
}

/** The buyer: an own customer's card that is still his, or a retail buyer. */
async function buyerChecks(db: Db, input: GoodsSaleInput): Promise<void> {
  if (!input.customerId) return;
  const c = await db.customer.findUnique({ where: { id: input.customerId }, select: { archived: true } });
  if (!c) throw notFound('customer_not_found', 'No such customer.');
  if (c.archived) throw conflict('customer_archived', 'This card was merged into another one; sell to that one.');
}

/**
 * Every line as the shelf and the count stand now, read through the client
 * given — inside the sale's transaction, after its locks. Nothing is written.
 */
export async function planLines(db: Db, actor: Actor, input: GoodsSaleInput, soldOn: string): Promise<LinePlan[]> {
  const partIds = input.lines.map((l) => l.partId).filter((x): x is string => !!x);
  const parts = new Map((await db.part.findMany({ where: { id: { in: partIds } }, select: { id: true, name: true, nameKa: true, unit: true, salePriceTetri: true, archived: true } })).map((p) => [p.id, p]));
  const owner = hasPerm(actor, 'stock.count');
  const now = today();
  const taken = new Map<string, number>();
  const counted = new Map<string, { showroom: number; lastCountOn: string | null }>();
  const out: LinePlan[] = [];
  for (const [index, l] of input.lines.entries()) {
    let plan: Omit<LinePlan, 'available' | 'needsCountAnswer' | 'decision'>;
    let base: number;
    if (l.partId) {
      const part = parts.get(l.partId);
      if (!part) throw notFound('goods_item_not_found', 'No such item.');
      if (part.archived) throw conflict('goods_item_archived', 'This part is archived; it is not sold.', { field: `lines[${index}].partId` });
      base = Math.max(0, (await partOnHandTx(db, part.id)).onHand);
      plan = {
        index,
        key: `part:${part.id}`,
        partId: part.id,
        countedItem: null,
        spec: null,
        name: part.name,
        nameKa: part.nameKa,
        unit: part.unit,
        qty: l.qty,
        unitPriceTetri: l.unitPriceTetri ?? 0,
        shelfPriceTetri: part.salePriceTetri,
        unitCostTetri: await shelfCost(db, part.id),
        lastCountOn: await lastCountOn(db, part.id),
        shortReason: l.shortReason?.trim() || null,
      };
    } else {
      const item = l.countedItem as CountedGoods;
      if (!counted.has(item)) counted.set(item, { showroom: (await batteriesNow(item, db)).showroom, lastCountOn: await countedItemLastCountOn(item, db) });
      const c = counted.get(item)!;
      base = c.showroom;
      const names = countedName(item, l.spec);
      plan = {
        index,
        key: item,
        partId: null,
        countedItem: item,
        spec: l.spec?.trim() || null,
        name: names.ru,
        nameKa: names.ka,
        unit: null,
        qty: l.qty,
        unitPriceTetri: l.unitPriceTetri ?? 0,
        shelfPriceTetri: null,
        // A charger has no card to keep a cost on: an owner may say it here (§1 п. 20).
        unitCostTetri: hasPerm(actor, 'cost.view') ? l.unitCostTetri : null,
        lastCountOn: c.lastCountOn,
        shortReason: l.shortReason?.trim() || null,
      };
    }
    const asks = needsCountAnswer(soldOn, plan.lastCountOn, now);
    const available = Math.max(0, base - (taken.get(plan.key) ?? 0));
    const decision = stockDecision({
      asked: l.qty,
      available,
      counted: plan.countedItem != null,
      owner,
      shortReason: plan.shortReason,
      countedAlready: asks && l.countedAlready === true,
    });
    if (decision === 'ok' || decision === 'minus' || decision === 'found_then_sold') taken.set(plan.key, (taken.get(plan.key) ?? 0) + l.qty);
    out.push({ ...plan, available, needsCountAnswer: asks, decision });
  }
  return out;
}

/** What the money at the counter amounts to: cash typed, or the gross of the bank line chosen. */
async function paidNowTetri(db: Db, paidNow: PaidNow): Promise<number> {
  if (!paidNow) return 0;
  if ('amountTetri' in paidNow) return paidNow.amountTetri;
  const line = await db.statementLine.findUnique({ where: { id: paidNow.statementLineId } });
  if (!line) throw notFound('line_not_found', 'No such statement line.');
  if (line.direction === 'out') throw conflict('outgoing_line', 'Money leaving the account is not a customer payment.');
  // A card line closes what the customer paid: the bank's net plus the acquirer's 1.5 %.
  return lineGross(storedLine(line));
}

export interface GoodsPreview {
  soldOn: string;
  totals: { grossTetri: number; netTetri: number; vatTetri: number };
  lines: {
    index: number;
    name: string;
    available: number;
    decision: StockDecision;
    needsCountAnswer: boolean;
    lastCountOn: string | null;
    shelfPriceTetri: number | null;
    priceEdited: boolean;
    unitCostTetri: number | null;
    marginTetri: number | null;
  }[];
  paidNowTetri: number;
  openTetri: number;
  paymentProblem: 'retail_must_pay' | 'goods_paid_over' | null;
  /** Bank lines of exactly the sum left to the bank within ±3 days, for an owner who said card or transfer — the one chosen among them. */
  inBank: InBank[];
}

/** The counter's question before it sells: what there is, what it comes to, what the bank may have sent. Nothing is written. */
export async function previewGoodsSale(actor: Actor, input: GoodsSaleInput): Promise<GoodsPreview> {
  const soldOn = input.soldOn ?? today();
  shapeChecks(actor, input, soldOn, false);
  await buyerChecks(prisma, input);
  const costs = hasPerm(actor, 'cost.view');
  return prisma.$transaction(async (tx) => {
    const plans = await planLines(tx, actor, input, soldOn);
    const totals = goodsTotals(plans);
    const nets = goodsLineNets(plans);
    const paid = await paidNowTetri(tx, input.paidNow);
    const open = Math.max(0, totals.grossTetri - paid);
    // What the counter leaves to the bank: the whole, less cash typed. The
    // lines are looked for against it, not against what a line already chosen
    // leaves open — so the line chosen as «Это она» stays on the list, chosen.
    // Only a line whose customer's sum is exactly that is offered: «Это она»
    // pays the sale with it, and a transfer of a card's net would leave the
    // fee open, a card line whose net is the sum would pay over it.
    const cash = input.paidNow && 'amountTetri' in input.paidNow ? input.paidNow.amountTetri : 0;
    const toBank = Math.max(0, totals.grossTetri - cash);
    const bank = input.promisedChannel && toBank > 0 && hasPerm(actor, 'payments.reconcile')
      ? (await inBankAlready(tx, { customerId: input.customerId, grossTetri: toBank, channel: input.promisedChannel, occurredOn: soldOn })).filter((l) => l.grossTetri === toBank)
      : [];
    return {
      soldOn,
      totals,
      lines: plans.map((p) => ({
        index: p.index,
        name: p.name,
        available: p.available,
        decision: p.decision,
        needsCountAnswer: p.needsCountAnswer,
        lastCountOn: p.lastCountOn,
        shelfPriceTetri: p.shelfPriceTetri,
        priceEdited: priceEdited(p.shelfPriceTetri, p.unitPriceTetri),
        unitCostTetri: costs ? p.unitCostTetri : null,
        // A line's margin: its share of the net less what it cost — an owner's figure.
        marginTetri: costs && p.unitCostTetri != null && p.unitPriceTetri > 0 ? nets[p.index]! - p.qty * p.unitCostTetri : null,
      })),
      paidNowTetri: paid,
      openTetri: open,
      paymentProblem: paymentProblem({ retail: !input.customerId, totalTetri: totals.grossTetri, paidNowTetri: paid, promisedChannel: input.promisedChannel }),
      inBank: bank,
    };
  });
}

/**
 * Sell (ADR-0045 §6.2). One transaction: the locks, the count after them,
 * the sale and its lines, what they took off the shelf and the count, the
 * money paid at the counter, and the journal.
 */
export async function createGoodsSale(actor: Actor, input: GoodsSaleInput): Promise<{ id: string; number: string; paymentId: string | null; openTetri: number }> {
  const soldOn = input.soldOn ?? today();
  shapeChecks(actor, input, soldOn, true);
  await buyerChecks(prisma, input);
  const retail = !input.customerId;
  const backdateReason = soldOn < today() ? input.backdateReason?.trim() ?? null : null;
  // The money at the counter, checked before anything is locked.
  const total = input.lines.reduce((n, l) => n + l.qty * (l.unitPriceTetri ?? 0), 0);
  if (input.paidNow && 'statementLineId' in input.paidNow && !hasPerm(actor, 'payments.reconcile')) {
    throw forbidden('reconcile_required', 'Only an owner attaches a bank line.');
  }
  const paid = await paidNowTetri(prisma, input.paidNow);
  const problem = paymentProblem({ retail, totalTetri: total, paidNowTetri: paid, promisedChannel: input.promisedChannel });
  if (problem === 'retail_must_pay') throw conflict('retail_must_pay', 'A retail buyer pays now, or the money comes from the bank.', { field: 'paidNow' });
  if (problem === 'goods_paid_over') throw conflict('goods_paid_over', 'That is more than the sale comes to.', { field: 'paidNow', totalTetri: total });
  const cash = input.paidNow && 'amountTetri' in input.paidNow && input.paidNow.amountTetri > 0 ? input.paidNow.amountTetri : 0;
  if (cash > 0) checkMoney(actor, { kind: 'goods', amountTetri: cash, channel: 'cash', occurredOn: soldOn, backdateReason });

  const keys = [...new Set(input.lines.map((l) => (l.partId ? `part:${l.partId}` : String(l.countedItem))))].sort();
  return prisma.$transaction(
    async (tx) => {
      // The last charger, wanted by two counters at once: one sells it, the
      // other is told there is none (§5). The count is read after the lock.
      for (const key of keys) await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`goods:${key}`}))) AS l`;
      const plans = await planLines(tx, actor, input, soldOn);

      const unanswered = plans.find((p, i) => p.needsCountAnswer && input.lines[i]!.countedAlready == null);
      if (unanswered) throw badRequest('goods_count_answer', 'Did the stocktake already see this item gone?', { field: `lines[${unanswered.index}].countedAlready`, lastCountOn: unanswered.lastCountOn });
      const short = plans.filter((p) => p.decision === 'refuse');
      if (short.length > 0) throw conflict('goods_short', 'There is not that many; an owner can sell beyond the count.', { lines: short.map((p) => ({ index: p.index, available: p.available, asked: p.qty })) });
      const reasonless = plans.find((p) => p.decision === 'need_reason');
      if (reasonless) throw badRequest('missing_field', 'Say why more is sold than there is.', { field: `lines[${reasonless.index}].shortReason` });

      const sale = await tx.goodsSale.create({
        data: {
          soldOn: dateFromISO(soldOn)!,
          customerId: input.customerId,
          buyerName: retail ? input.buyerName?.trim() || null : null,
          buyerPhone: retail ? input.buyerPhone?.trim() || null : null,
          promisedChannel: input.promisedChannel,
          backdateReason,
          notes: input.notes?.trim() || null,
          createdById: actor.id,
        },
        select: { id: true, number: true },
      });
      const reason = sale.number;
      for (const p of plans) {
        const line = await tx.goodsSaleLine.create({
          data: {
            saleId: sale.id,
            seq: p.index + 1,
            partId: p.partId,
            countedItem: p.countedItem,
            name: p.name,
            nameKa: p.nameKa,
            spec: p.spec,
            qty: p.qty,
            unitPriceTetri: p.unitPriceTetri,
            shelfPriceTetri: p.shelfPriceTetri,
            unitCostTetri: p.unitCostTetri,
            stockFrom: p.decision === 'already_counted' ? 'count' : 'shelf',
            shortReason: p.decision === 'minus' || p.decision === 'found_then_sold' ? p.shortReason : null,
          },
          select: { id: true },
        });
        if (p.decision === 'already_counted') continue;
        if (p.partId) {
          await issueForGoodsLine(tx, { goodsSaleLineId: line.id, partId: p.partId, qty: p.qty, occurredOn: soldOn, actorId: actor.id, reason });
          continue;
        }
        const common = { item: p.countedItem!, occurredOn: dateFromISO(soldOn)!, goodsSaleLineId: line.id, createdById: actor.id };
        if (p.decision === 'found_then_sold') {
          // Found first, so the count does not clamp the sale out of sight; then sold (§1 п. 5).
          await tx.batteryMove.create({ data: { ...common, kind: 'found', qty: p.qty - p.available, reason: `${reason}: ${p.shortReason}` } });
        }
        await tx.batteryMove.create({ data: { ...common, kind: 'sold', qty: p.qty, reason } });
      }

      // The money at the counter, in the same transaction.
      let paymentId: string | null = null;
      if (input.paidNow && 'statementLineId' in input.paidNow) {
        paymentId = (await attach(tx, { actorId: actor.id, lineId: input.paidNow.statementLineId, rule: 'by_hand', goodsSaleId: sale.id })).paymentId;
      } else if (cash > 0) {
        paymentId = (await recordMoneyTx(tx, actor, { kind: 'goods', goodsSaleId: sale.id, amountTetri: cash, channel: 'cash', occurredOn: soldOn, backdateReason })).id;
      }
      const owed = await goodsOwed(tx, sale.id);
      // A promise of the bank means something only while money is open.
      if (owed.openTetri === 0 && input.promisedChannel) await tx.goodsSale.update({ where: { id: sale.id }, data: { promisedChannel: null } });

      const totals = goodsTotals(plans);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'goods_sale.create',
          entityType: 'goods_sale',
          entityId: sale.id,
          after: {
            number: sale.number,
            soldOn,
            ...(input.customerId ? { customerId: input.customerId } : { retail: true }),
            lines: plans.map((p) => ({ name: p.name, qty: p.qty, unitPriceTetri: p.unitPriceTetri, shelfPriceTetri: p.shelfPriceTetri, stockFrom: p.decision === 'already_counted' ? 'count' : 'shelf' })),
            totalTetri: totals.grossTetri,
            vatTetri: totals.vatTetri,
            paidNow: input.paidNow ? ('statementLineId' in input.paidNow ? { statementLineId: input.paidNow.statementLineId } : { channel: 'cash', amountTetri: cash }) : null,
            promisedChannel: owed.openTetri > 0 ? input.promisedChannel : null,
          },
          note: backdateReason,
        },
      });
      for (const p of plans) {
        if (priceEdited(p.shelfPriceTetri, p.unitPriceTetri)) {
          await tx.auditLog.create({
            // One key on both sides: the journal shows «было → стало» only for a field both name.
            data: { actorId: actor.id, action: 'goods_sale.price', entityType: 'goods_sale', entityId: sale.id, before: { seq: p.index + 1, unitPriceTetri: p.shelfPriceTetri }, after: { seq: p.index + 1, unitPriceTetri: p.unitPriceTetri } },
          });
        }
        if (p.decision === 'minus' || p.decision === 'found_then_sold') {
          await tx.auditLog.create({
            data: { actorId: actor.id, action: 'goods_sale.minus', entityType: 'goods_sale', entityId: sale.id, before: { seq: p.index + 1, qty: p.available }, after: { seq: p.index + 1, qty: p.qty }, note: p.shortReason },
          });
        }
      }
      return { id: sale.id, number: sale.number, paymentId, openTetri: owed.openTetri };
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
}

/** A sale's live payments of its kind, and whether each is one part of a split bank line. */
async function livePayments(tx: Tx, saleId: string) {
  const payments = await tx.payment.findMany({
    where: { goodsSaleId: saleId, kind: 'goods', voidedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, grossTetri: true, channel: true, statementLineId: true, source: true, createdBy: { select: { name: true } }, statementLine: { select: { id: true, bank: true, occurredOn: true, amountTetri: true } } },
  });
  const out = [];
  for (const p of payments) {
    const parts = p.statementLineId && p.source === 'statement' ? await tx.payment.count({ where: { statementLineId: p.statementLineId, source: 'statement', voidedAt: null } }) : 1;
    out.push({ ...p, inSplit: parts > 1 });
  }
  return out;
}

export interface CancelInput {
  id: string;
  mode: 'cancel' | 'undo';
  reason: string;
  /** A line a stocktake had already seen gone: the owner says it came back. Undo never returns it. */
  countedBack?: boolean;
}

export interface CancelOutcome {
  customerId: string | null;
  /** Payments that became the customer's credit: his weeks take it after the commit. */
  credited: number;
}

/**
 * Call a sale off (ADR-0045 §6.3): the goods come back now, each payment
 * becomes the customer's credit or is voided, the sale is cancelled and its
 * invoice archived — or nothing is, when a payment cannot be voided alone.
 */
export async function cancelGoodsSaleTx(tx: Tx, actor: Actor, input: CancelInput): Promise<CancelOutcome> {
  await tx.$queryRaw`SELECT 1 FROM goods_sales WHERE id = ${input.id}::uuid FOR UPDATE`;
  const sale = await tx.goodsSale.findUnique({ where: { id: input.id }, include: { lines: { orderBy: { seq: 'asc' } } } });
  if (!sale) throw notFound('goods_sale_not_found', 'No such goods sale.');
  if (sale.status !== 'active') throw conflict('goods_sale_closed', 'This goods sale is cancelled already.');
  if (input.mode === 'undo' && (sale.createdById !== actor.id || Date.now() - sale.createdAt.getTime() > GOODS_UNDO_MS)) {
    throw conflict('goods_undo_too_late', 'Too late to undo; an owner can cancel it with a reason.');
  }
  const owed = await goodsOwed(tx, sale.id);
  const payments = await livePayments(tx, sale.id);
  const plan = cancelPlan({ retail: sale.customerId == null, mode: input.mode, payments });
  if ('refuse' in plan) {
    const p = payments.find((x) => x.id === plan.paymentId)!;
    throw conflict('goods_payment_in_split', 'This payment is one part of a split bank line: undo the line in «Разобрать» first.', { paymentId: p.id, lineId: p.statementLineId });
  }
  const now = today();
  const why = input.mode === 'undo' ? UNDONE_AT_ONCE : input.reason;
  // One shape on every row it touches; a screen reads the code's part in its own language, the owner's as typed.
  const words = goodsCancelReason(sale.number, why);

  // The goods came back now. A line a stocktake had already seen gone took
  // nothing off, so nothing goes back by itself: an undo takes back only what
  // the sale wrote, and a cancellation returns it only when the owner says it
  // came back — cancelling is also how an entry is put right (§1 п. 10).
  const returned: { name: string; qty: number }[] = [];
  const kept: { name: string; qty: number }[] = [];
  for (const l of sale.lines) {
    if (l.stockFrom === 'count' && !(input.mode === 'cancel' && input.countedBack)) {
      kept.push({ name: l.name, qty: l.qty });
      continue;
    }
    if (l.partId) {
      await returnGoodsLine(tx, { goodsSaleLineId: l.id, partId: l.partId, qty: l.qty, unitCostTetri: l.unitCostTetri, occurredOn: now, actorId: actor.id, reason: words });
    } else {
      await tx.batteryMove.create({ data: { item: l.countedItem!, kind: 'sale_cancelled', qty: l.qty, occurredOn: dateFromISO(now)!, goodsSaleLineId: l.id, reason: words, createdById: actor.id } });
    }
    returned.push({ name: l.name, qty: l.qty });
  }

  let credited = 0;
  for (const f of plan.fates) {
    if (f.fate === 'credit') {
      await rebookToCredit(tx, { paymentId: f.id, actorId: actor.id, reason: words });
      credited++;
    } else {
      await voidPaymentTx(tx, { actorId: actor.id, paymentId: f.id, reason: words, kind: input.mode === 'undo' ? 'undo' : 'void' });
    }
  }

  await tx.goodsSale.update({ where: { id: sale.id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.id, cancelReason: why, updatedAt: new Date() } });
  // The invoice handed out is history now; the next one is printed with the cancellation on it.
  await tx.storedFile.updateMany({ where: { goodsSaleId: sale.id, docKind: 'goods_invoice', archived: false }, data: { archived: true } });
  await tx.auditLog.create({
    data: {
      actorId: actor.id,
      action: input.mode === 'undo' ? 'goods_sale.undo' : 'goods_sale.cancel',
      entityType: 'goods_sale',
      entityId: sale.id,
      before: { status: 'active', paidTetri: owed.paidTetri, openTetri: owed.openTetri },
      after: { status: 'cancelled', returned, ...(kept.length > 0 ? { kept } : {}), payments: plan.fates.map((f) => ({ id: f.id, fate: f.fate })) },
      note: why,
    },
  });
  return { customerId: sale.customerId, credited };
}

/** Cancel, then let the customer's new credit pay his open weeks — the night's own `settleCredit`, now (§1 п. 14). */
export async function cancelGoodsSale(actor: Actor, input: CancelInput): Promise<CancelOutcome> {
  const out = await prisma.$transaction((tx) => cancelGoodsSaleTx(tx, actor, input), { timeout: 20_000, maxWait: 20_000 });
  if (out.customerId && out.credited > 0) {
    const rentals = await prisma.rental.findMany({
      where: { customerId: out.customerId, status: { in: ['booked', 'active', 'overdue', 'paused', 'disputed'] } },
      orderBy: { pickedUpOn: 'asc' },
      select: { id: true },
    });
    for (const r of rentals) await settleCredit(r.id);
  }
  return out;
}

/** What a cancellation would do, before it is done (ADR-0045 §10, the cancel sheet); `countedBack` — the owner's answer for the lines a stocktake had already seen gone. */
export async function cancelPreview(id: string, countedBack = false): Promise<{
  number: string;
  refuse: { code: 'goods_payment_in_split'; paymentId: string; lineId: string | null } | null;
  goods: { name: string; countedItem: string | null; spec: string | null; partId: string | null; qty: number; stockFrom: 'shelf' | 'count'; back: boolean; beforeQty: number; afterQty: number }[];
  payments: { id: string; grossTetri: number; channel: string; fate: 'credit' | 'void'; by: string | null; line: { id: string; bank: string; occurredOn: string | null; amountTetri: number } | null }[];
  creditCloses: Closes[];
  creditLeftTetri: number;
}> {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.goodsSale.findUnique({ where: { id }, include: { lines: { orderBy: { seq: 'asc' } } } });
    if (!sale) throw notFound('goods_sale_not_found', 'No such goods sale.');
    if (sale.status !== 'active') throw conflict('goods_sale_closed', 'This goods sale is cancelled already.');
    const payments = await livePayments(tx, sale.id);
    const plan = cancelPlan({ retail: sale.customerId == null, mode: 'cancel', payments });
    const fate = new Map('fates' in plan ? plan.fates.map((f) => [f.id, f.fate]) : []);
    const counts = new Map<string, number>();
    const goods = [];
    for (const l of sale.lines) {
      const key = l.partId ? `part:${l.partId}` : String(l.countedItem);
      if (!counts.has(key)) counts.set(key, l.partId ? (await partOnHandTx(tx, l.partId)).onHand : (await batteriesNow(l.countedItem as CountedGoods, tx)).showroom);
      const before = counts.get(key)!;
      const back = l.stockFrom !== 'count' || countedBack;
      const after = back ? before + l.qty : before;
      counts.set(key, after);
      goods.push({ name: l.name, countedItem: l.countedItem, spec: l.spec, partId: l.partId, qty: l.qty, stockFrom: l.stockFrom === 'count' ? ('count' as const) : ('shelf' as const), back, beforeQty: before, afterQty: after });
    }
    const creditTetri = payments.filter((p) => fate.get(p.id) === 'credit').reduce((n, p) => n + p.grossTetri, 0);
    const credit = sale.customerId && creditTetri > 0 ? await planMoney(tx, { kind: 'on_account', customerId: sale.customerId, amountTetri: creditTetri, channel: 'cash' }) : null;
    return {
      number: sale.number,
      refuse: 'refuse' in plan ? { code: plan.refuse, paymentId: plan.paymentId, lineId: payments.find((p) => p.id === plan.paymentId)?.statementLineId ?? null } : null,
      goods,
      payments: payments.map((p) => ({
        id: p.id,
        grossTetri: p.grossTetri,
        channel: p.channel,
        fate: (fate.get(p.id) ?? 'void') as 'credit' | 'void',
        by: p.createdBy?.name ?? null,
        line: p.statementLine ? { id: p.statementLine.id, bank: p.statementLine.bank, occurredOn: isoDate(p.statementLine.occurredOn), amountTetri: p.statementLine.amountTetri } : null,
      })),
      creditCloses: credit?.closes.filter((c) => c.amountTetri > 0) ?? [],
      creditLeftTetri: credit?.leftoverTetri ?? 0,
    };
  });
}
