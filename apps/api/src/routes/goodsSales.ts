import {
  GOODS_UNDO_MS,
  SELLABLE_COUNTED,
  goodsLineNets,
  goodsSaleState,
  goodsTotals,
  priceEdited,
  type PromisedChannel,
} from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { hasPerm } from '../lib/auth.js';
import { dateFromISO, dayOf, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { ApiError, badRequest, conflict, notFound } from '../lib/errors.js';
import { UNDONE_AT_ONCE, cancelGoodsSale, cancelPreview, createGoodsSale, previewGoodsSale, type GoodsLineInput, type GoodsSaleInput, type PaidNow } from '../lib/goods.js';
import { actorOf } from '../lib/guard.js';
import { inBankAlready } from '../lib/statements/inBank.js';
import { partRows } from '../lib/stock.js';
import { date, oneOf, str, tetri } from '../lib/validate.js';
import { batteriesNow, countedItemLastCountOn } from './batteries.js';

// Goods sold over the counter (issue #11, ADR-0045; Mika 23.10.2026 «А»):
// a part off the shelf or a charger from the count, to an own customer or to
// a retail buyer with no card. The logic is in lib/goods.ts; this file reads
// the requests and says what a sale looks like on a screen.

type Body = Record<string, unknown>;
type Query = Record<string, string | undefined>;

/** A refusal about a line's field names the line: `lines[1].unitPriceTetri`, not `unitPriceTetri`. */
function inLine<T>(i: number, read: () => T): T {
  try {
    return read();
  } catch (e) {
    if (e instanceof ApiError && typeof e.extra?.field === 'string') e.extra.field = `lines[${i}].${e.extra.field}`;
    throw e;
  }
}

function readLine(x: unknown, i: number): GoodsLineInput {
  const l = (x && typeof x === 'object' ? x : {}) as Body;
  return inLine(i, () => ({
    partId: str(l, 'partId'),
    countedItem: str(l, 'countedItem', { max: 20 }),
    spec: str(l, 'spec', { max: 60 }),
    // Checked with the rest of the shape (goods_bad_qty), not as a bare number.
    qty: typeof l.qty === 'number' ? l.qty : l.qty == null || l.qty === '' ? 1 : Number(l.qty),
    unitPriceTetri: tetri(l, 'unitPriceTetri', { min: 0 }),
    unitCostTetri: tetri(l, 'unitCostTetri', { min: 0 }),
    shortReason: str(l, 'shortReason', { max: 500 }),
    countedAlready: typeof l.countedAlready === 'boolean' ? l.countedAlready : null,
  }));
}

function readPaidNow(x: unknown): PaidNow {
  if (!x || typeof x !== 'object') return null;
  const b = x as Body;
  const line = str(b, 'statementLineId');
  if (line) return { statementLineId: line };
  const channel = str(b, 'channel');
  if (channel == null) return null;
  // Card and transfer are the bank's to bring (§1 п. 6): the counter takes cash, or a line that came.
  if (channel !== 'cash') throw badRequest('bad_field', 'At the counter money is cash, or a bank line that came.', { field: 'paidNow.channel' });
  const amountTetri = tetri(b, 'amountTetri', { min: 0 }) ?? 0;
  return amountTetri > 0 ? { channel: 'cash', amountTetri } : null;
}

function readSale(b: Body): GoodsSaleInput {
  const customerId = str(b, 'customerId');
  return {
    soldOn: date(b, 'soldOn'),
    backdateReason: str(b, 'backdateReason', { max: 500 }),
    customerId,
    buyerName: customerId ? null : str(b, 'buyerName', { max: 200 }),
    buyerPhone: customerId ? null : str(b, 'buyerPhone', { max: 40 }),
    lines: (Array.isArray(b.lines) ? b.lines : []).map(readLine),
    paidNow: readPaidNow(b.paidNow),
    promisedChannel: oneOf(b, 'promisedChannel', ['acquiring', 'transfer'] as const),
    notes: str(b, 'notes', { max: 2000 }),
  };
}

const LIST_INCLUDE = {
  customer: { select: { id: true, name: true } },
  lines: { orderBy: { seq: 'asc' }, select: { name: true, nameKa: true, countedItem: true, spec: true, partId: true, qty: true, unitPriceTetri: true } },
  payments: { where: { voidedAt: null, kind: 'goods' }, select: { grossTetri: true } },
} as const satisfies Prisma.GoodsSaleInclude;

type ListRow = Prisma.GoodsSaleGetPayload<{ include: typeof LIST_INCLUDE }>;

/** One sale as a list shows it: who, what, how much, where its money stands. */
function rowOf(s: ListRow) {
  const total = goodsTotals(s.lines).grossTetri;
  const paid = s.payments.reduce((n, p) => n + p.grossTetri, 0);
  const st = goodsSaleState({ status: s.status as 'active' | 'cancelled', totalTetri: total, paidTetri: paid, promisedChannel: (s.promisedChannel as PromisedChannel | null) ?? null, retail: s.customerId == null });
  return {
    id: s.id,
    number: s.number,
    soldOn: isoDate(s.soldOn),
    status: s.status,
    customer: s.customer,
    buyer: s.customerId ? null : { name: s.buyerName, phone: s.buyerPhone },
    items: s.lines.map((l) => ({ name: l.name, nameKa: l.nameKa, countedItem: l.countedItem, spec: l.spec, partId: l.partId, qty: l.qty })),
    totalTetri: total,
    paidTetri: paid,
    openTetri: st.openTetri,
    state: st.state,
    promisedChannel: s.promisedChannel,
  };
}

export function goodsSaleRoutes(app: FastifyInstance): void {
  /** What the counter can sell: the shelf's parts, and the counted items on sale (§6.1). */
  app.get<{ Querystring: Query }>('/api/goods-sales/items', { config: { scope: 'goods.sell' } }, async (req) => {
    const actor = actorOf(req);
    const costs = hasPerm(actor, 'cost.view');
    const q = (req.query.q ?? '').trim().toLowerCase();
    const rows = (await partRows()).filter((p) => !q || [p.name, p.nameKa, p.sku].some((x) => x?.toLowerCase().includes(q)));
    const counts = await prisma.stockMove.groupBy({
      by: ['partId'],
      where: { partId: { in: rows.map((r) => r.id) }, OR: [{ kind: 'adjust' }, { kind: 'receipt', reason: 'initial' }] },
      _max: { occurredOn: true },
    });
    const counted = new Map(counts.map((c) => [c.partId, isoDate(c._max.occurredOn)]));
    return {
      parts: rows.slice(0, 200).map((p) => ({
        partId: p.id,
        name: p.name,
        nameKa: p.nameKa,
        sku: p.sku,
        unit: p.unit,
        onHand: p.onHand,
        salePriceTetri: p.salePriceTetri,
        lastCountOn: counted.get(p.id) ?? null,
        avgCostTetri: costs ? p.avgCostTetri : null,
      })),
      counted: await Promise.all(
        SELLABLE_COUNTED.map(async (item) => ({ item, showroom: (await batteriesNow(item)).showroom, lastCountOn: await countedItemLastCountOn(item) })),
      ),
    };
  });

  /** The same body as a sale, written nowhere: what there is, what it comes to, what the bank may have sent (§6.1). */
  app.post<{ Body: Body }>('/api/goods-sales/preview', { config: { scope: 'goods.sell' } }, async (req) => previewGoodsSale(actorOf(req), readSale(req.body ?? {})));

  /** Sell (§6.2). */
  app.post<{ Body: Body }>('/api/goods-sales', { config: { scope: 'goods.sell' } }, async (req, reply) => {
    const out = await createGoodsSale(actorOf(req), readSale(req.body ?? {}));
    return reply.code(201).send(out);
  });

  /** «Продажи → Товары»: newest first, with what is still open (§10). */
  app.get<{ Querystring: Query }>('/api/goods-sales', { config: { scope: 'fleet.view' } }, async (req) => {
    const q = req.query;
    const from = q.from ? date(q, 'from') : null;
    const to = q.to ? date(q, 'to') : null;
    const text = (q.q ?? '').trim();
    const where: Prisma.GoodsSaleWhereInput = {
      ...(q.status === 'active' || q.status === 'cancelled' ? { status: q.status } : {}),
      ...(q.open === '1' ? { status: 'active' } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.retail === '1' ? { customerId: null } : {}),
      ...(q.partId ? { lines: { some: { partId: q.partId } } } : {}),
      ...(q.item ? { lines: { some: { countedItem: q.item } } } : {}),
      ...(from || to ? { soldOn: { ...(from ? { gte: dateFromISO(from)! } : {}), ...(to ? { lte: dateFromISO(to)! } : {}) } } : {}),
      ...(text
        ? {
            OR: [
              { number: { contains: text, mode: 'insensitive' } },
              { buyerName: { contains: text, mode: 'insensitive' } },
              { buyerPhone: { contains: text.replace(/\s/g, '') } },
              { customer: { name: { contains: text, mode: 'insensitive' } } },
              { lines: { some: { name: { contains: text, mode: 'insensitive' } } } },
              { lines: { some: { nameKa: { contains: text, mode: 'insensitive' } } } },
              { lines: { some: { spec: { contains: text, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const sales = await prisma.goodsSale.findMany({ where, orderBy: [{ soldOn: 'desc' }, { createdAt: 'desc' }], take: 300, include: LIST_INCLUDE });
    const rows = sales.map(rowOf).filter((r) => (q.open === '1' ? r.openTetri > 0 : true));
    const open = rows.filter((r) => r.openTetri > 0);
    return { count: rows.length, openCount: open.length, openTetri: open.reduce((n, r) => n + r.openTetri, 0), sales: rows };
  });

  /** A sale's card (§10): what was sold, the money and where it stands, the invoice, the feed. */
  app.get<{ Params: { id: string } }>('/api/goods-sales/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const actor = actorOf(req);
    const costs = hasPerm(actor, 'cost.view');
    const s = await prisma.goodsSale.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, name: true, phone: true, kind: true } },
        createdBy: { select: { id: true, name: true } },
        cancelledBy: { select: { name: true } },
        lines: { orderBy: { seq: 'asc' }, include: { part: { select: { id: true, sku: true, unit: true } } } },
        payments: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            kind: true,
            occurredOn: true,
            channel: true,
            grossTetri: true,
            feeTetri: true,
            voidedAt: true,
            voidKind: true,
            voidReason: true,
            source: true,
            createdBy: { select: { name: true } },
            statementLine: { select: { id: true, bank: true, occurredOn: true, amountTetri: true } },
          },
        },
        documents: { where: { kind: 'pdf', archived: false }, select: { id: true, docKind: true, createdAt: true } },
      },
    });
    if (!s) throw notFound('goods_sale_not_found', 'No such goods sale.');
    const totals = goodsTotals(s.lines);
    const nets = goodsLineNets(s.lines);
    const live = s.payments.filter((p) => !p.voidedAt && p.kind === 'goods');
    const paid = live.reduce((n, p) => n + p.grossTetri, 0);
    const st = goodsSaleState({ status: s.status as 'active' | 'cancelled', totalTetri: totals.grossTetri, paidTetri: paid, promisedChannel: (s.promisedChannel as PromisedChannel | null) ?? null, retail: s.customerId == null });
    // The lines a card or a transfer for it may be: an owner attaches one here (§10 «Строки банка»).
    const bankLines =
      st.openTetri > 0 && hasPerm(actor, 'payments.reconcile')
        ? (await prisma.$transaction((tx) => inBankAlready(tx, { customerId: s.customerId, grossTetri: st.openTetri, channel: 'acquiring', occurredOn: isoDate(s.soldOn)! }))).filter((l) => l.payment == null)
        : [];
    const paymentIds = s.payments.map((p) => p.id);
    const log = await prisma.auditLog.findMany({
      where: { OR: [{ entityType: 'goods_sale', entityId: s.id }, ...(paymentIds.length ? [{ entityType: 'payment', entityId: { in: paymentIds } }] : [])] },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { actor: { select: { name: true } } },
    });
    const undoable = s.status === 'active' && s.createdById === actor.id && Date.now() - s.createdAt.getTime() <= GOODS_UNDO_MS;
    return {
      sale: {
        id: s.id,
        number: s.number,
        soldOn: isoDate(s.soldOn),
        status: s.status,
        customer: s.customer,
        buyer: s.customerId ? null : { name: s.buyerName, phone: s.buyerPhone },
        promisedChannel: s.promisedChannel,
        backdateReason: s.backdateReason,
        notes: s.notes,
        createdBy: s.createdBy?.name ?? null,
        createdAt: s.createdAt.toISOString(),
        cancelledAt: s.cancelledAt?.toISOString() ?? null,
        cancelledBy: s.cancelledBy?.name ?? null,
        // The seller's own undo carries no words of a person's: the screen says «отменено сразу».
        cancelReason: s.cancelReason === UNDONE_AT_ONCE ? null : s.cancelReason,
        undone: s.cancelReason === UNDONE_AT_ONCE,
        totals,
        paidTetri: paid,
        openTetri: st.openTetri,
        state: st.state,
        lines: s.lines.map((l, i) => ({
          id: l.id,
          seq: l.seq,
          partId: l.partId,
          sku: l.part?.sku ?? null,
          unit: l.part?.unit ?? null,
          countedItem: l.countedItem,
          spec: l.spec,
          name: l.name,
          nameKa: l.nameKa,
          qty: l.qty,
          unitPriceTetri: l.unitPriceTetri,
          lineTetri: l.qty * l.unitPriceTetri,
          netTetri: nets[i],
          shelfPriceTetri: l.shelfPriceTetri,
          priceEdited: priceEdited(l.shelfPriceTetri, l.unitPriceTetri),
          stockFrom: l.stockFrom,
          shortReason: l.shortReason,
          unitCostTetri: costs ? l.unitCostTetri : null,
          marginTetri: costs && l.unitCostTetri != null ? nets[i]! - l.qty * l.unitCostTetri : null,
        })),
      },
      payments: s.payments.map((p) => ({
        id: p.id,
        occurredOn: isoDate(p.occurredOn),
        channel: p.channel,
        grossTetri: p.grossTetri,
        feeTetri: p.feeTetri,
        // What became of it: paid this sale, the customer's credit after a cancellation, or voided.
        fate: p.voidedAt ? 'voided' : p.kind === 'on_account' ? 'credit' : 'paid',
        voidKind: p.voidKind,
        voidReason: p.voidReason,
        by: p.createdBy?.name ?? null,
        line: p.statementLine ? { ...p.statementLine, occurredOn: isoDate(p.statementLine.occurredOn) } : null,
      })),
      documents: s.documents.map((d) => ({ id: d.id, docKind: d.docKind, createdAt: d.createdAt.toISOString() })),
      bankLines,
      feed: log.map((l) => ({ at: l.createdAt.toISOString(), day: dayOf(l.createdAt), action: l.action, by: l.actor?.name ?? null, note: l.note === UNDONE_AT_ONCE ? null : l.note, before: l.before, after: l.after })),
      can: {
        pay: st.openTetri > 0 && hasPerm(actor, 'cash.record'),
        attach: st.openTetri > 0 && hasPerm(actor, 'payments.reconcile'),
        cancel: s.status === 'active' && hasPerm(actor, 'sales.manage'),
        undo: undoable,
        edit: s.status === 'active' && hasPerm(actor, 'sales.manage'),
        invoice: hasPerm(actor, 'goods.sell'),
      },
      /** Seconds left for «Отменить» on the toast: nought once it is gone. */
      undoLeftMs: undoable ? GOODS_UNDO_MS - (Date.now() - s.createdAt.getTime()) : 0,
    };
  });

  /** The buyer's name and phone of a retail sale, and the note: the lines are the invoice's and stay (§1 п. 10). */
  app.patch<{ Params: { id: string }; Body: Body }>('/api/goods-sales/:id', { config: { scope: 'sales.manage' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const s = await prisma.goodsSale.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, customerId: true, buyerName: true, buyerPhone: true, notes: true } });
    if (!s) throw notFound('goods_sale_not_found', 'No such goods sale.');
    if (s.status !== 'active') throw conflict('goods_sale_closed', 'This goods sale is cancelled.');
    const data: { buyerName?: string | null; buyerPhone?: string | null; notes?: string | null } = {};
    if (!s.customerId && 'buyerName' in b) data.buyerName = str(b, 'buyerName', { max: 200 });
    if (!s.customerId && 'buyerPhone' in b) data.buyerPhone = str(b, 'buyerPhone', { max: 40 });
    if ('notes' in b) data.notes = str(b, 'notes', { max: 2000 });
    const before = { buyerName: s.buyerName, buyerPhone: s.buyerPhone, notes: s.notes };
    const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => (data[k] ?? null) !== (before[k] ?? null));
    if (changed.length === 0) return { ok: true, changed: [] };
    await prisma.$transaction(async (tx) => {
      await tx.goodsSale.update({ where: { id: s.id }, data: { ...data, updatedAt: new Date() } });
      // The invoice names the buyer: the one handed out goes to the archive, the next is printed anew.
      if (changed.some((k) => k === 'buyerName' || k === 'buyerPhone')) {
        await tx.storedFile.updateMany({ where: { goodsSaleId: s.id, docKind: 'goods_invoice', archived: false }, data: { archived: true } });
      }
    });
    await audit({
      actorId: actor.id,
      action: 'goods_sale.update',
      entityType: 'goods_sale',
      entityId: s.id,
      before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
      after: Object.fromEntries(changed.map((k) => [k, data[k] ?? null])),
    });
    return { ok: true, changed };
  });

  /** What a cancellation would do, before the owner says so (§10, the cancel sheet). */
  app.get<{ Params: { id: string }; Querystring: Query }>('/api/goods-sales/:id/cancel-plan', { config: { scope: 'sales.manage' } }, async (req) =>
    cancelPreview(req.params.id, req.query.countedBack === '1' || req.query.countedBack === 'true'),
  );

  /** Call the sale off, with the reason (§6.3). */
  app.post<{ Params: { id: string }; Body: Body }>('/api/goods-sales/:id/cancel', { config: { scope: 'sales.manage' } }, async (req) => {
    const reason = str(req.body ?? {}, 'reason', { required: true, max: 500 })!;
    // A line a stocktake had already seen gone comes back only on the owner's word (§6.3 п. 3).
    const countedBack = (req.body ?? {}).countedBack === true;
    const out = await cancelGoodsSale(actorOf(req), { id: req.params.id, mode: 'cancel', reason, countedBack });
    return { ok: true, ...out };
  });

  /** «Отменить» on the toast: the seller, within a minute, no reason asked (§1 п. 11). */
  app.post<{ Params: { id: string } }>('/api/goods-sales/:id/undo', { config: { scope: 'goods.sell' } }, async (req) => {
    const out = await cancelGoodsSale(actorOf(req), { id: req.params.id, mode: 'undo', reason: '' });
    return { ok: true, ...out };
  });
}

/** For the customer's card: his purchases, newest first (§9). */
export async function purchasesOf(customerId: string) {
  const sales = await prisma.goodsSale.findMany({ where: { customerId }, orderBy: [{ soldOn: 'desc' }, { createdAt: 'desc' }], take: 50, include: LIST_INCLUDE });
  return sales.map(rowOf);
}

/** For a part's card: the lines that sold it, newest first, with the margin to an owner (§9). */
export async function salesOfPart(partId: string, costs: boolean) {
  const lines = await prisma.goodsSaleLine.findMany({
    where: { partId },
    orderBy: { sale: { soldOn: 'desc' } },
    take: 50,
    include: { sale: { select: { id: true, number: true, soldOn: true, status: true, customerId: true, buyerName: true, customer: { select: { name: true } } } } },
  });
  return lines.map((l) => ({
    saleId: l.sale.id,
    number: l.sale.number,
    soldOn: isoDate(l.sale.soldOn),
    status: l.sale.status,
    buyer: l.sale.customer?.name ?? l.sale.buyerName ?? null,
    retail: l.sale.customerId == null,
    qty: l.qty,
    unitPriceTetri: l.unitPriceTetri,
    unitCostTetri: costs ? l.unitCostTetri : null,
  }));
}
