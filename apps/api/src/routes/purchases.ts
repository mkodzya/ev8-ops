import { checkVinList, todayISO, VEHICLE_POOLS } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { recordMoney } from '../lib/money.js';
import { purchaseCosts, purchaseMoney, recostPurchase } from '../lib/purchases.js';
import { partRows, receivePartLine } from '../lib/stock.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { date, int, oneOf, str, tetri } from '../lib/validate.js';

// Buying mopeds and parts (PUR-01…03).
//
// The order is what the seller invoiced, in the seller's currency. What a
// unit cost is not stored on the order: it follows from the payments, so it
// is right the moment a payment is corrected and never has to be
// recalculated by hand. On arrival that cost is written onto each VIN,
// because from then on it is a fact about the moped rather than about the
// shipment.

type Body = Record<string, unknown>;

export const PURCHASE_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  lines: { orderBy: { createdAt: 'asc' as const }, include: { model: { select: { id: true, brand: true, name: true } } } },
  payments: { where: { voidedAt: null }, orderBy: { occurredOn: 'asc' } },
} as const;

type Row = {
  id: string;
  number: string;
  invoiceNo: string | null;
  invoiceDate: Date | null;
  currency: string;
  orderedOn: Date;
  receivedOn: Date | null;
  status: string;
  extrasTetri: number;
  extrasNote: string | null;
  notes: string | null;
  paidBeforeTetri: number;
  paidBeforeMinor: bigint | number;
  paidBeforeOn: Date | null;
  supplier: { id: string; name: string };
  lines: {
    id: string;
    qty: number;
    unitPriceMinor: number;
    partName: string | null;
    partId: string | null;
    modelId: string | null;
    model: { id: string; brand: string; name: string } | null;
  }[];
  payments: { id: string; occurredOn: Date; grossTetri: number; netTetri: number; feeTetri: number; channel: string; direction: string; foreignMinor: bigint | number | null; foreignCurrency: string | null }[];
};

export function serializePurchase(p: Row) {
  const { money, costs } = purchaseCosts(p);
  const byLine = new Map(costs.map((c) => [c.lineId, c]));
  const units = p.lines.filter((l) => l.model).reduce((n, l) => n + l.qty, 0);
  return {
    id: p.id,
    number: p.number,
    invoiceNo: p.invoiceNo,
    invoiceDate: isoDate(p.invoiceDate),
    currency: p.currency,
    orderedOn: isoDate(p.orderedOn),
    receivedOn: isoDate(p.receivedOn),
    status: p.status,
    supplier: p.supplier,
    invoiceMinor: money.invoiceMinor,
    paidTetri: money.paidTetri,
    paidMinor: money.paidMinor,
    /** 0…100 of the invoice, the figure the "preliminary" note quotes (§7). */
    paidPercent: money.percent,
    debtMinor: money.debtMinor,
    /** Costs stop moving once the factory is paid in full. */
    preliminary: !money.settled,
    extrasTetri: p.extrasTetri,
    extrasNote: p.extrasNote,
    paidBeforeTetri: p.paidBeforeTetri,
    paidBeforeMinor: Number(p.paidBeforeMinor),
    paidBeforeOn: isoDate(p.paidBeforeOn),
    // Only meaningful once something has been paid; null says so out loud.
    rate: money.rate,
    units,
    notes: p.notes,
    lines: p.lines.map((l) => {
      const c = byLine.get(l.id)!;
      return {
        id: l.id,
        model: l.model ? { id: l.model.id, name: `${l.model.brand} ${l.model.name}` } : null,
        partName: l.partName,
        partId: l.partId,
        // A line that names no catalogue part will not reach the shelf, and
        // the screen says so before the shipment arrives (B8-03).
        onShelf: l.partId != null,
        qty: l.qty,
        unitPriceMinor: l.unitPriceMinor,
        lineMinor: l.qty * l.unitPriceMinor,
        fobTetri: c.fobTetri,
        extrasTetri: c.extrasTetri,
        totalTetri: c.totalTetri,
        unitCostTetri: c.unitCostTetri,
      };
    }),
    payments: p.payments.map((x) => ({
      id: x.id,
      occurredOn: isoDate(x.occurredOn),
      grossTetri: x.grossTetri,
      netTetri: x.netTetri,
      feeTetri: x.feeTetri,
      foreignMinor: Number(x.foreignMinor ?? 0),
      foreignCurrency: x.foreignCurrency,
      channel: x.channel,
      direction: x.direction,
    })),
  };
}

/**
 * One line of an invoice: a model, or a part — from the catalogue, so it
 * lands on the shelf, or free text, so at least the invoice adds up (B8-03).
 */
async function lineData(tx: { part: { findUnique: (a: { where: { id: string }; select: { id: true; name: true } }) => Promise<{ id: string; name: string } | null> } }, raw: Record<string, unknown>) {
  const modelId = str(raw, 'modelId');
  const partId = str(raw, 'partId');
  const catalogue = partId ? await tx.part.findUnique({ where: { id: partId }, select: { id: true, name: true } }) : null;
  if (partId && !catalogue) throw notFound('part_not_found', 'No such part.');
  const partName = catalogue?.name ?? str(raw, 'partName', { max: 200 });
  if (!modelId === !partName) throw conflict('line_shape', 'A line is either a model or a part, not both and not neither.');
  if (modelId && partId) throw conflict('line_shape', 'A line is either a model or a part, not both and not neither.');
  return {
    modelId,
    partName,
    partId: catalogue?.id ?? null,
    qty: int(raw, 'qty', { required: true, min: 1 })!,
    // The seller's own price, in their currency's minor unit.
    unitPriceMinor: tetri(raw, 'unitPrice', { required: true, min: 0 })!,
  };
}

export function purchaseRoutes(app: FastifyInstance): void {
  app.get('/api/purchases', { config: { scope: 'purchases.view' } }, async () => {
    const purchases = await prisma.purchase.findMany({ orderBy: { orderedOn: 'desc' }, take: 200, include: PURCHASE_INCLUDE });
    return { purchases: purchases.map(serializePurchase) };
  });

  app.get<{ Params: { id: string } }>('/api/purchases/:id', { config: { scope: 'purchases.view' } }, async (req) => {
    const p = await prisma.purchase.findUnique({ where: { id: req.params.id }, include: PURCHASE_INCLUDE });
    if (!p) throw notFound('purchase_not_found', 'No such order.');
    const vehicles = await prisma.vehicle.findMany({
      where: { purchaseId: p.id },
      orderBy: { vin: 'asc' },
      select: { id: true, vin: true, costTetri: true, state: true, model: { select: { brand: true, name: true } } },
    });
    // Logistics corrected, a cost worked out again, money stated as paid
    // before the move: all of it lives in the journal, and the order's feed
    // was built from payments and the receipt alone (crit. 13, 19 — QA-W5-01).
    const journal = await prisma.auditLog.findMany({
      where: { entityType: 'purchase', entityId: p.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { actor: { select: { name: true } } },
    });
    return {
      purchase: serializePurchase(p),
      vehicles: vehicles.map((v) => ({
        id: v.id,
        vin: v.vin,
        state: v.state,
        costTetri: v.costTetri,
        model: `${v.model.brand} ${v.model.name}`,
      })),
      journal: journal.map((l) => ({
        id: l.id,
        at: l.createdAt.toISOString(),
        occurredOn: isoDate(l.createdAt),
        action: l.action,
        by: l.actor?.name ?? null,
        note: l.note,
        after: l.after,
      })),
    };
  });

  app.post<{ Body: Body }>('/api/purchases', { config: { scope: 'purchases.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const supplierId = str(b, 'supplierId', { required: true })!;
    const supplier = await prisma.customer.findUnique({ where: { id: supplierId }, select: { id: true, isSupplier: true } });
    if (!supplier) throw notFound('supplier_not_found', 'No such supplier.');
    const currency = (str(b, 'currency', { max: 3 }) ?? 'CNY').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw badRequest('bad_field', 'currency must be three letters', { field: 'currency' });

    // The order is written with its lines, the way it is read off an invoice
    // (§3.4): a line that names no catalogue part is kept all the same and
    // marked — it is on the invoice, it just will not reach the shelf (B8-03).
    const lines = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : [];
    const purchase = await prisma.$transaction(async (tx) => {
      if (!supplier.isSupplier) await tx.customer.update({ where: { id: supplierId }, data: { isSupplier: true, recordKind: 'supplier' } });
      const created = await tx.purchase.create({
        data: {
          supplierId,
          invoiceNo: str(b, 'invoiceNo', { max: 100 }),
          invoiceDate: dateFromISO(date(b, 'invoiceDate')),
          currency,
          orderedOn: dateFromISO(date(b, 'orderedOn') ?? todayISO(new Date(), env.TZ))!,
          extrasTetri: tetri(b, 'extrasTetri', { min: 0 }) ?? 0,
          extrasNote: str(b, 'extrasNote', { max: 1000 }),
          notes: str(b, 'notes', { max: 4000 }),
          createdById: actor.id,
        },
        select: { id: true, number: true },
      });
      for (const raw of lines) {
        const line = await lineData(tx, raw);
        await tx.purchaseLine.create({ data: { purchaseId: created.id, ...line } });
      }
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'purchase.create', entityType: 'purchase', entityId: created.id, after: { number: created.number, supplierId, currency, lines: lines.length } },
      });
      return created;
    });
    return reply.code(201).send(purchase);
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/purchases/:id', { config: { scope: 'purchases.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const p = await prisma.purchase.findUnique({ where: { id: req.params.id } });
    if (!p) throw notFound('purchase_not_found', 'No such order.');
    if (p.status === 'cancelled') throw conflict('purchase_closed', 'This order is cancelled.');
    const data: Record<string, unknown> = {};
    if ('invoiceNo' in b) data.invoiceNo = str(b, 'invoiceNo', { max: 100 });
    if ('invoiceDate' in b) data.invoiceDate = dateFromISO(date(b, 'invoiceDate'));
    if ('extrasTetri' in b) data.extrasTetri = tetri(b, 'extrasTetri', { min: 0 }) ?? 0;
    if ('extrasNote' in b) data.extrasNote = str(b, 'extrasNote', { max: 1000 });
    if ('notes' in b) data.notes = str(b, 'notes', { max: 4000 });
    await prisma.$transaction(async (tx) => {
      await tx.purchase.update({ where: { id: p.id }, data: { ...data, updatedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'purchase.update', entityType: 'purchase', entityId: p.id, before: { extrasTetri: p.extrasTetri }, after: data as object } });
      // Logistics are split over the mopeds, so correcting them moves what
      // each one cost — even long after the shipment arrived (§7).
      if ('extrasTetri' in data) await recostPurchase(tx, p.id, actor.id, 'logistics corrected');
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/purchases/:id/lines', { config: { scope: 'purchases.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const p = await prisma.purchase.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
    if (!p) throw notFound('purchase_not_found', 'No such order.');
    if (p.status !== 'ordered') throw conflict('purchase_closed', 'An order that has arrived is a record; it is not edited.');
    const line = await prisma.purchaseLine.create({ data: { purchaseId: p.id, ...(await lineData(prisma, b)) }, select: { id: true } });
    await audit({ actorId: actor.id, action: 'purchase.line.add', entityType: 'purchase', entityId: p.id, after: { lineId: line.id, qty: b.qty } });
    return reply.code(201).send(line);
  });

  app.delete<{ Params: { id: string; lineId: string } }>(
    '/api/purchases/:id/lines/:lineId',
    { config: { scope: 'purchases.manage' } },
    async (req) => {
      const actor = actorOf(req);
      const line = await prisma.purchaseLine.findUnique({ where: { id: req.params.lineId }, include: { purchase: { select: { id: true, status: true } } } });
      if (!line || line.purchase.id !== req.params.id) throw notFound('line_not_found', 'No such line on this order.');
      if (line.purchase.status !== 'ordered') throw conflict('purchase_closed', 'An order that has arrived is a record; it is not edited.');
      await prisma.purchaseLine.delete({ where: { id: line.id } });
      await audit({ actorId: actor.id, action: 'purchase.line.remove', entityType: 'purchase', entityId: line.purchase.id, before: { qty: line.qty } });
      return { ok: true };
    },
  );

  /** Money to the supplier (PUR-03): a deposit, then the balance. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/purchases/:id/payments', { config: { scope: 'purchases.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const p = await prisma.purchase.findUnique({ where: { id: req.params.id }, select: { id: true, supplierId: true, status: true, currency: true } });
    if (!p) throw notFound('purchase_not_found', 'No such order.');
    if (p.status === 'cancelled') throw conflict('purchase_closed', 'This order is cancelled.');
    const grossTetri = tetri(b, 'grossTetri', { required: true, min: 1 })!;
    // What those GEL bought, in the factory's own currency: without it the
    // order cannot say what is still owed or at what rate it went (B3-04).
    const foreign = tetri(b, 'foreignAmount', { min: 0 });
    const { id } = await recordMoney(actor, {
      kind: 'supplier',
      purchaseId: p.id,
      amountTetri: grossTetri,
      channel: oneOf(b, 'channel', ['transfer', 'acquiring', 'cash'] as const) ?? 'transfer',
      occurredOn: date(b, 'occurredOn'),
      backdateReason: str(b, 'backdateReason', { max: 500 }) ?? (date(b, 'occurredOn') ? 'dated on entry' : null),
      note: str(b, 'note', { max: 1000 }),
      foreignMinor: foreign ?? undefined,
      foreignCurrency: foreign ? p.currency : undefined,
      bankFeeTetri: tetri(b, 'bankFee', { min: 0 }) ?? undefined,
    });
    // The cost of the mopeds follows inside recordMoney, on whichever door
    // the money came through (§7).
    return reply.code(201).send({ id });
  });

  /**
   * Money that went out before this system did (B3-04, §3.5): what left the
   * account, what it bought in the factory's currency, and when. It is not a
   * payment — it happened elsewhere — so it is stated on the order once.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/purchases/:id/paid-before', { config: { scope: 'purchases.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const p = await prisma.purchase.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, paidBeforeTetri: true } });
    if (!p) throw notFound('purchase_not_found', 'No such order.');
    if (p.status === 'cancelled') throw conflict('purchase_closed', 'This order is cancelled.');
    const paidBeforeTetri = tetri(b, 'amountTetri', { required: true, min: 0 })!;
    const paidBeforeMinor = tetri(b, 'foreignAmount', { required: true, min: 0 })!;
    await prisma.$transaction(async (tx) => {
      await tx.purchase.update({
        where: { id: p.id },
        data: { paidBeforeTetri, paidBeforeMinor: BigInt(paidBeforeMinor), paidBeforeOn: dateFromISO(date(b, 'occurredOn')), updatedAt: new Date() },
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'purchase.paid_before', entityType: 'purchase', entityId: p.id, before: { paidBeforeTetri: p.paidBeforeTetri }, after: { paidBeforeTetri, paidBeforeMinor } },
      });
      await recostPurchase(tx, p.id, actor.id, 'money paid before the move');
    });
    return { ok: true };
  });

  /**
   * The shipment arrives (PUR-02, §3.6). The VINs come off the CMR, one to a
   * line, and every one of them is checked before anything is written: a
   * shipment half entered is worse than one not entered at all, and a VIN
   * already in the fleet stops the whole receipt with the line named.
   *
   * It may arrive before it is paid for (Mika, Q23). What each moped cost is
   * then preliminary — worked out at the rate of the payments made so far —
   * and every later payment writes it again.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/purchases/:id/receive', { config: { scope: 'purchases.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const p = await prisma.purchase.findUnique({ where: { id: req.params.id }, include: PURCHASE_INCLUDE });
    if (!p) throw notFound('purchase_not_found', 'No such order.');
    if (p.status !== 'ordered') throw conflict('purchase_closed', 'This order has already arrived, or was cancelled.');
    if (p.lines.length === 0) throw conflict('no_lines', 'An order with no lines has nothing to receive.');

    const receivedOn = date(b, 'receivedOn') ?? todayISO(new Date(), env.TZ);
    const raw = b.vins;
    const modelLines = p.lines.filter((l) => l.model);
    if (modelLines.length > 0 && (!raw || typeof raw !== 'object')) throw badRequest('missing_field', 'vins is required', { field: 'vins' });
    const vinsByLine = (raw ?? {}) as Record<string, unknown>;

    // One value for the whole batch, corrected row by row where a moped
    // differs (B8-02).
    const batch = {
      color: str(b, 'color', { max: 60 }),
      year: int(b, 'year', { min: 2000 }),
      pool: oneOf(b, 'pool', VEHICLE_POOLS),
      locationId: str(b, 'locationId'),
    };
    const rowOf = (v: unknown): { vin: string; color?: string | null; year?: number | null; pool?: string | null; locationId?: string | null } =>
      typeof v === 'string' ? { vin: v } : (v as Record<string, unknown>) && typeof (v as Record<string, unknown>).vin === 'string' ? (v as never) : { vin: '' };

    const known = await prisma.vehicle.findMany({ select: { vin: true } });
    const planned: { line: (typeof p.lines)[number]; rows: { vin: string; color: string | null; year: number | null; pool: string | null; locationId: string | null }[] }[] = [];
    for (const line of modelLines) {
      const list = Array.isArray(vinsByLine[line.id]) ? (vinsByLine[line.id] as unknown[]) : null;
      const rows = (list ?? []).map(rowOf).filter((r) => r.vin.trim() !== '');
      const name = `${line.model!.brand} ${line.model!.name}`;
      if (rows.length === 0) throw conflict('vins_missing', `Line ${name} has no VINs.`, { lineId: line.id, qty: line.qty, line: name });
      if (rows.length !== line.qty) {
        throw conflict('vins_count', `Line ${name} ordered ${line.qty} and was given ${rows.length} VINs.`, { lineId: line.id, qty: line.qty, given: rows.length, line: name });
      }
      // 17 characters without I, O or Q; no VIN twice in the paste; none of
      // them already in the fleet (crit. 14, 15).
      const checked = checkVinList(rows.map((r) => r.vin).join('\n'), known.map((v) => v.vin));
      const bad = checked.find((c) => c.fault);
      if (bad?.fault === 'known') {
        throw conflict('duplicate_vin', `Line ${bad.line}: ${bad.vin} is already in the fleet.`, { line: bad.line, vin: bad.vin, lineId: line.id, field: 'vins' });
      }
      if (bad) {
        throw conflict('bad_vin_line', `Line ${bad.line}: ${bad.vin} is not a VIN this shipment can take.`, { line: bad.line, vin: bad.vin, fault: bad.fault, lineId: line.id, field: 'vins' });
      }
      planned.push({
        line,
        rows: rows.map((r, i) => ({
          vin: checked[i].vin,
          color: r.color ?? batch.color ?? null,
          year: r.year ?? batch.year ?? null,
          pool: r.pool ?? batch.pool ?? null,
          locationId: r.locationId ?? batch.locationId ?? null,
        })),
      });
    }

    const { money, costs } = purchaseCosts(p);
    const byLine = new Map(costs.map((c) => [c.lineId, c]));

    let created = 0;
    let receivedParts = 0;
    try {
      await prisma.$transaction(async (tx) => {
        for (const { line, rows } of planned) {
          const cost = byLine.get(line.id)!;
          for (const row of rows) {
            const v = await tx.vehicle.create({
              data: {
                vin: row.vin,
                modelId: line.model!.id,
                color: row.color,
                year: row.year,
                pool: (row.pool as 'rent' | 'sale' | null) ?? null,
                locationId: row.locationId,
                arrivedOn: dateFromISO(receivedOn),
                costTetri: cost.unitCostTetri,
                purchaseId: p.id,
              },
              select: { id: true },
            });
            await tx.vehicleEvent.create({
              data: { vehicleId: v.id, kind: 'arrived', occurredOn: dateFromISO(receivedOn)!, toState: 'available', actorId: actor.id, reason: p.number },
            });
            created++;
          }
          // The model's own cost is kept as the reference for the next batch.
          await tx.vehicleModel.update({ where: { id: line.model!.id }, data: { costTetri: cost.unitCostTetri, updatedAt: new Date() } });
        }
        // Parts from the catalogue land on the shelf at what they cost to
        // land; a line that names no part lands nowhere and said so (B8-03).
        for (const line of p.lines) {
          if (!line.partId) continue;
          const cost = byLine.get(line.id)!;
          await receivePartLine(tx, {
            purchaseLineId: line.id,
            partId: line.partId,
            qty: line.qty,
            unitCostTetri: cost.unitCostTetri,
            occurredOn: receivedOn,
            actorId: actor.id,
            reason: p.number,
          });
          receivedParts += line.qty;
        }
        await tx.purchase.update({ where: { id: p.id }, data: { status: 'received', receivedOn: dateFromISO(receivedOn)!, costedAt: new Date(), updatedAt: new Date() } });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'purchase.receive',
            entityType: 'purchase',
            entityId: p.id,
            after: { receivedOn, vehicles: created, parts: receivedParts, paidPercent: money.percent, rate: money.rate, extrasTetri: p.extrasTetri },
          },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_vin', 'One of those VINs is already in the fleet.');
      throw e;
    }
    return { ok: true, vehicles: created, parts: receivedParts, preliminary: !money.settled, paidPercent: money.percent };
  });

  /**
   * "В заказ" from a part that has run low (B8-05, crit. 28): a draft order
   * to whoever supplied it last, with one line for what is missing. It is a
   * draft in the sense that nothing has been sent — the order is real, and
   * an owner edits it before anybody writes to the factory.
   */
  app.post<{ Body: Body }>('/api/purchases/from-part', { config: { scope: 'purchases.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const partId = str(b, 'partId', { required: true })!;
    const part = (await partRows({ includeArchived: true })).find((r) => r.id === partId);
    if (!part) throw notFound('part_not_found', 'No such part.');
    const qty = int(b, 'qty', { min: 1 }) ?? Math.max(1, part.minQty - part.onHand);
    // Whoever sold it last sells it again, unless somebody says otherwise.
    const last = await prisma.purchaseLine.findFirst({
      where: { partId, purchase: { status: { not: 'cancelled' } } },
      orderBy: { createdAt: 'desc' },
      select: { unitPriceMinor: true, purchase: { select: { supplierId: true, currency: true } } },
    });
    const supplierId = str(b, 'supplierId') ?? last?.purchase.supplierId ?? null;
    if (!supplierId) throw conflict('no_supplier', 'Nobody has supplied this part yet; pick a supplier.', { field: 'supplierId' });
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          supplierId,
          currency: last?.purchase.currency ?? 'CNY',
          orderedOn: dateFromISO(todayISO(new Date(), env.TZ))!,
          notes: null,
          createdById: actor.id,
        },
        select: { id: true, number: true },
      });
      await tx.purchaseLine.create({
        data: { purchaseId: created.id, partId, partName: part.name, qty, unitPriceMinor: last?.unitPriceMinor ?? 0 },
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'purchase.create', entityType: 'purchase', entityId: created.id, after: { number: created.number, fromPart: part.name, qty } },
      });
      return created;
    });
    return reply.code(201).send(order);
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/purchases/:id/cancel', { config: { scope: 'purchases.manage' } }, async (req) => {
    const actor = actorOf(req);
    const reason = str(req.body ?? {}, 'reason', { required: true, max: 1000 })!;
    const p = await prisma.purchase.findUnique({ where: { id: req.params.id }, include: { payments: { where: { voidedAt: null } } } });
    if (!p) throw notFound('purchase_not_found', 'No such order.');
    if (p.status !== 'ordered') throw conflict('purchase_closed', 'This order has arrived, or is already cancelled.');
    if (p.payments.length > 0) throw conflict('purchase_has_payments', 'Void the payments on this order first.', { payments: p.payments.length });
    await prisma.purchase.update({ where: { id: p.id }, data: { status: 'cancelled', updatedAt: new Date() } });
    await audit({ actorId: actor.id, action: 'purchase.cancel', entityType: 'purchase', entityId: p.id, note: reason });
    return { ok: true };
  });
}
