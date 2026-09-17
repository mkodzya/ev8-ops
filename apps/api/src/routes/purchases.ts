import { effectiveRate, landedCosts, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { receivePartLine } from '../lib/stock.js';
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
  lines: { orderBy: { createdAt: 'asc' }, include: { model: { select: { id: true, brand: true, name: true } } } },
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
  supplier: { id: string; name: string };
  lines: {
    id: string;
    qty: number;
    unitPriceMinor: number;
    partName: string | null;
    partId: string | null;
    model: { id: string; brand: string; name: string } | null;
  }[];
  payments: { id: string; occurredOn: Date; grossTetri: number; channel: string; direction: string }[];
};

export function serializePurchase(p: Row) {
  const paidTetri = p.payments.filter((x) => x.direction === 'out').reduce((n, x) => n + x.grossTetri, 0);
  const invoiceMinor = p.lines.reduce((n, l) => n + l.qty * l.unitPriceMinor, 0);
  const units = p.lines.filter((l) => l.model).reduce((n, l) => n + l.qty, 0);
  const costs = landedCosts({
    lines: p.lines.map((l) => ({ id: l.id, qty: l.qty, unitPriceMinor: l.unitPriceMinor })),
    paidTetri,
    extrasTetri: p.extrasTetri,
  });
  const byLine = new Map(costs.map((c) => [c.lineId, c]));
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
    invoiceMinor,
    paidTetri,
    extrasTetri: p.extrasTetri,
    extrasNote: p.extrasNote,
    // Only meaningful once something has been paid; null says so out loud.
    rate: effectiveRate(paidTetri, invoiceMinor),
    units,
    notes: p.notes,
    lines: p.lines.map((l) => {
      const c = byLine.get(l.id)!;
      return {
        id: l.id,
        model: l.model ? { id: l.model.id, name: `${l.model.brand} ${l.model.name}` } : null,
        partName: l.partName,
        partId: l.partId,
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
      channel: x.channel,
      direction: x.direction,
    })),
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
    return {
      purchase: serializePurchase(p),
      vehicles: vehicles.map((v) => ({
        id: v.id,
        vin: v.vin,
        state: v.state,
        costTetri: v.costTetri,
        model: `${v.model.brand} ${v.model.name}`,
      })),
    };
  });

  /** Suppliers are parties like any other; this is the short list for pickers. */
  app.get('/api/suppliers', { config: { scope: 'purchases.view' } }, async () => {
    const suppliers = await prisma.customer.findMany({
      where: { isSupplier: true, archived: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return { suppliers };
  });

  app.post<{ Body: Body }>('/api/purchases', { config: { scope: 'settings.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const supplierId = str(b, 'supplierId', { required: true })!;
    const supplier = await prisma.customer.findUnique({ where: { id: supplierId }, select: { id: true, isSupplier: true } });
    if (!supplier) throw notFound('supplier_not_found', 'No such supplier.');
    const currency = (str(b, 'currency', { max: 3 }) ?? 'CNY').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw badRequest('bad_field', 'currency must be three letters', { field: 'currency' });

    const purchase = await prisma.$transaction(async (tx) => {
      if (!supplier.isSupplier) await tx.customer.update({ where: { id: supplierId }, data: { isSupplier: true } });
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
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'purchase.create', entityType: 'purchase', entityId: created.id, after: { number: created.number, supplierId, currency } },
      });
      return created;
    });
    return reply.code(201).send(purchase);
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/purchases/:id', { config: { scope: 'settings.manage' } }, async (req) => {
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
    await prisma.purchase.update({ where: { id: p.id }, data: { ...data, updatedAt: new Date() } });
    await audit({ actorId: actor.id, action: 'purchase.update', entityType: 'purchase', entityId: p.id, after: data as object });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/purchases/:id/lines', { config: { scope: 'settings.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const p = await prisma.purchase.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
    if (!p) throw notFound('purchase_not_found', 'No such order.');
    if (p.status !== 'ordered') throw conflict('purchase_closed', 'An order that has arrived is a record; it is not edited.');
    const modelId = str(b, 'modelId');
    const partId = str(b, 'partId');
    // A part line may point at the catalogue, and then it lands on the shelf
    // when the shipment arrives. Its name is copied down all the same, so the
    // order still reads as the order even if the catalogue is edited later.
    const catalogue = partId ? await prisma.part.findUnique({ where: { id: partId }, select: { id: true, name: true } }) : null;
    if (partId && !catalogue) throw notFound('part_not_found', 'No such part.');
    const partName = catalogue?.name ?? str(b, 'partName', { max: 200 });
    if (!modelId === !partName) throw conflict('line_shape', 'A line is either a model or a part, not both and not neither.');
    if (modelId && partId) throw conflict('line_shape', 'A line is either a model or a part, not both and not neither.');
    const line = await prisma.purchaseLine.create({
      data: {
        purchaseId: p.id,
        modelId,
        partName,
        partId: catalogue?.id ?? null,
        qty: int(b, 'qty', { required: true, min: 1 })!,
        // The seller's own price, in their currency's minor unit.
        unitPriceMinor: tetri(b, 'unitPrice', { required: true, min: 0 })!,
      },
      select: { id: true },
    });
    await audit({ actorId: actor.id, action: 'purchase.line.add', entityType: 'purchase', entityId: p.id, after: { lineId: line.id, modelId, partName, qty: b.qty } });
    return reply.code(201).send(line);
  });

  app.delete<{ Params: { id: string; lineId: string } }>(
    '/api/purchases/:id/lines/:lineId',
    { config: { scope: 'settings.manage' } },
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
  app.post<{ Params: { id: string }; Body: Body }>('/api/purchases/:id/payments', { config: { scope: 'payments.reconcile' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const p = await prisma.purchase.findUnique({ where: { id: req.params.id }, select: { id: true, supplierId: true, status: true } });
    if (!p) throw notFound('purchase_not_found', 'No such order.');
    if (p.status === 'cancelled') throw conflict('purchase_closed', 'This order is cancelled.');
    const grossTetri = tetri(b, 'grossTetri', { required: true, min: 1 })!;
    const payment = await prisma.payment.create({
      data: {
        occurredOn: dateFromISO(date(b, 'occurredOn') ?? todayISO(new Date(), env.TZ))!,
        direction: 'out',
        channel: oneOf(b, 'channel', ['transfer', 'acquiring', 'cash'] as const) ?? 'transfer',
        grossTetri,
        feeTetri: 0,
        netTetri: grossTetri,
        customerId: p.supplierId,
        purchaseId: p.id,
        bankText: str(b, 'bankText', { max: 500 }),
        note: str(b, 'note', { max: 1000 }),
        source: 'manual',
        createdById: actor.id,
      },
      select: { id: true },
    });
    await audit({ actorId: actor.id, action: 'purchase.payment', entityType: 'purchase', entityId: p.id, after: { paymentId: payment.id, grossTetri } });
    return reply.code(201).send(payment);
  });

  /**
   * The shipment arrives (PUR-02). Each model line is given its VINs, and
   * every VIN is written with what it cost to land: its share of what was
   * actually paid, plus an equal share of the shipment's logistics and
   * customs.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/purchases/:id/receive', { config: { scope: 'settings.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const p = await prisma.purchase.findUnique({ where: { id: req.params.id }, include: PURCHASE_INCLUDE });
    if (!p) throw notFound('purchase_not_found', 'No such order.');
    if (p.status !== 'ordered') throw conflict('purchase_closed', 'This order has already arrived, or was cancelled.');
    if (p.lines.length === 0) throw conflict('no_lines', 'An order with no lines has nothing to receive.');

    const paidTetri = p.payments.filter((x) => x.direction === 'out').reduce((n, x) => n + x.grossTetri, 0);
    if (paidTetri <= 0) throw conflict('not_paid', 'What a unit cost comes from what was paid, and nothing has been paid yet.');

    const receivedOn = date(b, 'receivedOn') ?? todayISO(new Date(), env.TZ);
    const raw = b.vins;
    if (!raw || typeof raw !== 'object') throw badRequest('missing_field', 'vins is required', { field: 'vins' });
    const vinsByLine = raw as Record<string, unknown>;

    // Every model line must get exactly as many VINs as it ordered: a
    // shipment half entered is worse than one not entered at all.
    const modelLines = p.lines.filter((l) => l.model);
    for (const line of modelLines) {
      const list = vinsByLine[line.id];
      if (!Array.isArray(list) || list.some((v) => typeof v !== 'string' || v.trim() === '')) {
        throw conflict('vins_missing', `Line ${line.model!.brand} ${line.model!.name} has no VINs.`, { lineId: line.id, qty: line.qty });
      }
      if (list.length !== line.qty) {
        throw conflict('vins_count', `Line ${line.model!.brand} ${line.model!.name} ordered ${line.qty} and was given ${list.length} VINs.`, {
          lineId: line.id,
          qty: line.qty,
          given: list.length,
        });
      }
    }

    const costs = new Map(
      landedCosts({
        lines: p.lines.map((l) => ({ id: l.id, qty: l.qty, unitPriceMinor: l.unitPriceMinor })),
        paidTetri,
        extrasTetri: p.extrasTetri,
      }).map((c) => [c.lineId, c]),
    );

    let created = 0;
    let receivedParts = 0;
    try {
      await prisma.$transaction(async (tx) => {
        for (const line of modelLines) {
          const cost = costs.get(line.id)!;
          for (const vin of vinsByLine[line.id] as string[]) {
            const v = await tx.vehicle.create({
              data: {
                vin: vin.trim().toUpperCase(),
                modelId: line.model!.id,
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
        // land, the same share of the shipment a moped gets.
        for (const line of p.lines) {
          if (!line.partId) continue;
          const cost = costs.get(line.id)!;
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
        await tx.purchase.update({ where: { id: p.id }, data: { status: 'received', receivedOn: dateFromISO(receivedOn)!, updatedAt: new Date() } });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'purchase.receive',
            entityType: 'purchase',
            entityId: p.id,
            after: { receivedOn, vehicles: created, parts: receivedParts, paidTetri, extrasTetri: p.extrasTetri },
          },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_vin', 'One of those VINs is already in the fleet.');
      throw e;
    }
    return { ok: true, vehicles: created, parts: receivedParts };
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/purchases/:id/cancel', { config: { scope: 'settings.manage' } }, async (req) => {
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
