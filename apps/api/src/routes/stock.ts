// The warehouse: parts on the shelf, and mopeds counted by model.
//
// The spec keeps parts stock outside v1 (§2); the owner asked for it, so it
// is here. Kept small on purpose — a catalogue, a ledger, a stock-take.
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { actorOf, mayView } from '../lib/guard.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { initialStock, partRows } from '../lib/stock.js';
import { salesOfPart } from './goodsSales.js';
import { todayISO } from '@ev8/shared';
import { date, int, oneOf, str, tetri } from '../lib/validate.js';

type Body = Record<string, unknown>;

const UNITS = ['pcs', 'set', 'l', 'kg', 'm'] as const;

export function stockRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { all?: string } }>('/api/parts', { config: { scope: 'fleet.view' } }, async (req) => {
    const seeCost = mayView(req, 'cost.view');
    const rows = await partRows({ includeArchived: req.query.all === '1' });
    const parts = seeCost ? rows : rows.map(partWithoutCost);
    return {
      parts,
      totals: {
        parts: parts.length,
        valueTetri: seeCost ? rows.reduce((n, p) => n + p.valueTetri, 0) : null,
        short: parts.filter((p) => p.shortBy > 0).length,
        negative: parts.filter((p) => p.onHand < 0).length,
      },
    };
  });

  app.get<{ Params: { id: string } }>('/api/parts/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const rows = await partRows({ includeArchived: true });
    const seeCost = mayView(req, 'cost.view');
    const found = rows.find((p) => p.id === req.params.id);
    if (!found) throw notFound('part_not_found', 'No such part.');
    const part = seeCost ? found : partWithoutCost(found);
    const moves = await prisma.stockMove.findMany({
      where: { partId: part.id },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      include: {
        createdBy: { select: { name: true } },
        purchaseLine: { select: { purchase: { select: { id: true, number: true } } } },
        servicePart: { select: { job: { select: { id: true, number: true } } } },
        goodsSaleLine: { select: { sale: { select: { id: true, number: true } } } },
      },
    });
    return {
      part,
      // The goods sales that took it off the shelf (issue #11, ADR-0045), the margin to an owner.
      sales: await salesOfPart(part.id, seeCost),
      moves: moves.map((m) => ({
        id: m.id,
        kind: m.kind,
        qty: m.qty,
        unitCostTetri: seeCost ? m.unitCostTetri : null,
        occurredOn: isoDate(m.occurredOn),
        reason: m.reason,
        actor: m.createdBy?.name ?? null,
        purchase: m.purchaseLine?.purchase ?? null,
        job: m.servicePart?.job ?? null,
        // A goods sale's issue, or its return when the sale was called off.
        sale: m.goodsSaleLine?.sale ?? null,
      })),
    };
  });

  app.post<{ Body: Body }>('/api/parts', { config: { scope: 'service.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const name = str(b, 'name', { required: true, max: 200 })!;
    try {
      const part = await prisma.part.create({
        data: {
          name,
          nameKa: str(b, 'nameKa', { max: 200 }),
          sku: str(b, 'sku', { max: 100 }),
          unit: oneOf(b, 'unit', UNITS) ?? 'pcs',
          minQty: int(b, 'minQty', { min: 0 }) ?? 0,
          salePriceTetri: tetri(b, 'salePriceTetri', { min: 0 }),
          notes: str(b, 'notes', { max: 2000 }),
          isTracker: b.isTracker === true,
          createdById: actor.id,
        },
        select: { id: true, name: true },
      });
      await audit({ actorId: actor.id, action: 'part.create', entityType: 'part', entityId: part.id, after: { name } });
      return reply.code(201).send(part);
    } catch (e) {
      // One shelf per part: two rows for one thing are two counts, each wrong.
      if (isUniqueViolation(e)) throw conflict('part_exists', 'A part by that name, or with that article number, is already on the list.');
      throw e;
    }
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/parts/:id', { config: { scope: 'service.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const part = await prisma.part.findUnique({ where: { id: req.params.id } });
    if (!part) throw notFound('part_not_found', 'No such part.');

    const data: Record<string, unknown> = {};
    if ('name' in b) data.name = str(b, 'name', { required: true, max: 200 });
    if ('nameKa' in b) data.nameKa = str(b, 'nameKa', { max: 200 });
    if ('sku' in b) data.sku = str(b, 'sku', { max: 100 });
    if ('unit' in b) data.unit = oneOf(b, 'unit', UNITS, { required: true });
    if ('minQty' in b) data.minQty = int(b, 'minQty', { min: 0 }) ?? 0;
    if ('salePriceTetri' in b) data.salePriceTetri = tetri(b, 'salePriceTetri', { min: 0 });
    if ('notes' in b) data.notes = str(b, 'notes', { max: 2000 });
    if ('archived' in b) data.archived = b.archived === true;
    // Fitting a tracker asks for its IMEI and SIM (ADR-0036); the owner says which parts are trackers.
    if ('isTracker' in b) data.isTracker = b.isTracker === true;

    try {
      await prisma.part.update({ where: { id: part.id }, data: { ...data, updatedAt: new Date() } });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('part_exists', 'A part by that name, or with that article number, is already on the list.');
      throw e;
    }
    await audit({ actorId: actor.id, action: 'part.update', entityType: 'part', entityId: part.id, before: { name: part.name }, after: data as object });
    return { ok: true };
  });

  /**
   * A stock-take. The count on the shelf is what a person counted, so this
   * asks for the counted number and writes the difference — with a reason,
   * because this is the one movement no document stands behind.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/parts/:id/count', { config: { scope: 'stock.count' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const rows = await partRows({ includeArchived: true });
    const part = rows.find((p) => p.id === req.params.id);
    if (!part) throw notFound('part_not_found', 'No such part.');

    const counted = int(b, 'countedQty', { required: true, min: 0 })!;
    const reason = str(b, 'reason', { required: true, max: 1000 })!;
    const delta = counted - part.onHand;
    if (delta === 0) throw conflict('nothing_to_correct', 'The count already says that.', { onHand: part.onHand });

    const move = await prisma.stockMove.create({
      data: {
        partId: part.id,
        kind: 'adjust',
        qty: delta,
        occurredOn: dateFromISO(date(b, 'occurredOn') ?? todayISO(new Date(), env.TZ))!,
        reason,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await audit({
      actorId: actor.id,
      action: 'part.count',
      entityType: 'part',
      entityId: part.id,
      before: { onHand: part.onHand },
      after: { countedQty: counted, delta, reason, moveId: move.id },
    });
    return { ok: true, delta, onHand: counted };
  });

  /**
   * The first count of a part nobody has moved yet (B3-05, crit. 29): how
   * many are on the shelf and what one cost. Once — after that the shelf has
   * a history, and history is added to, not restarted.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/parts/:id/initial', { config: { scope: 'stock.count' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const part = await prisma.part.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!part) throw notFound('part_not_found', 'No such part.');
    const qty = int(b, 'qty', { required: true, min: 1 })!;
    const unitCostTetri = tetri(b, 'unitCostTetri', { required: true, min: 0 })!;
    const occurredOn = date(b, 'occurredOn') ?? todayISO(new Date(), env.TZ);
    await prisma.$transaction(async (tx) => {
      await initialStock(tx, { partId: part.id, qty, unitCostTetri, occurredOn, actorId: actor.id });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'part.initial', entityType: 'part', entityId: part.id, after: { qty, unitCostTetri, occurredOn } },
      });
    });
    return reply.code(201).send({ ok: true, onHand: qty, valueTetri: qty * unitCostTetri });
  });

  /**
   * Parts that arrived without an order behind them (B3-05, §3.8): bought in
   * a shop down the road, brought back from a workshop. The cost is stated
   * and so is the reason, because nothing else says where they came from.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/parts/:id/receipt', { config: { scope: 'stock.count' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const part = await prisma.part.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!part) throw notFound('part_not_found', 'No such part.');
    const qty = int(b, 'qty', { required: true, min: 1 })!;
    const unitCostTetri = tetri(b, 'unitCostTetri', { required: true, min: 0 })!;
    const reason = str(b, 'reason', { required: true, max: 1000 })!;
    const occurredOn = date(b, 'occurredOn') ?? todayISO(new Date(), env.TZ);
    const move = await prisma.stockMove.create({
      data: { partId: part.id, kind: 'receipt', qty, unitCostTetri, occurredOn: dateFromISO(occurredOn)!, reason, createdById: actor.id },
      select: { id: true },
    });
    await audit({ actorId: actor.id, action: 'part.receipt', entityType: 'part', entityId: part.id, after: { qty, unitCostTetri, reason, moveId: move.id } });
    return reply.code(201).send({ ok: true });
  });
}

/** A part as a manager reads it: what is on the shelf, not what it is worth. */
function partWithoutCost<T extends { avgCostTetri: number | null; valueTetri: number }>(p: T): Omit<T, 'avgCostTetri' | 'valueTetri'> & { avgCostTetri: null; valueTetri: null } {
  return { ...p, avgCostTetri: null, valueTetri: null };
}
