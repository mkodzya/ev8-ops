// The warehouse: parts on the shelf, and mopeds counted by model.
//
// The spec keeps parts stock outside v1 (§2); the owner asked for it, so it
// is here. Kept small on purpose — a catalogue, a ledger, a stock-take.
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { actorOf } from '../lib/guard.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { partRows } from '../lib/stock.js';
import { todayISO } from '@ev8/shared';
import { date, int, oneOf, str, tetri } from '../lib/validate.js';

type Body = Record<string, unknown>;

const UNITS = ['pcs', 'set', 'l', 'kg', 'm'] as const;

export function stockRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { all?: string } }>('/api/parts', { config: { scope: 'fleet.view' } }, async (req) => {
    const parts = await partRows({ includeArchived: req.query.all === '1' });
    return {
      parts,
      totals: {
        parts: parts.length,
        valueTetri: parts.reduce((n, p) => n + p.valueTetri, 0),
        short: parts.filter((p) => p.shortBy > 0).length,
        negative: parts.filter((p) => p.onHand < 0).length,
      },
    };
  });

  app.get<{ Params: { id: string } }>('/api/parts/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const rows = await partRows({ includeArchived: true });
    const part = rows.find((p) => p.id === req.params.id);
    if (!part) throw notFound('part_not_found', 'No such part.');
    const moves = await prisma.stockMove.findMany({
      where: { partId: part.id },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      include: {
        createdBy: { select: { name: true } },
        purchaseLine: { select: { purchase: { select: { id: true, number: true } } } },
        servicePart: { select: { job: { select: { id: true, number: true } } } },
      },
    });
    return {
      part,
      moves: moves.map((m) => ({
        id: m.id,
        kind: m.kind,
        qty: m.qty,
        unitCostTetri: m.unitCostTetri,
        occurredOn: isoDate(m.occurredOn),
        reason: m.reason,
        actor: m.createdBy?.name ?? null,
        purchase: m.purchaseLine?.purchase ?? null,
        job: m.servicePart?.job ?? null,
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
   * Mopeds by model: what stands here, what is out, and what has been paid
   * for but has not arrived. No table of its own — a moped is a VIN with a
   * state, and an order that has not landed is a line on that order.
   */
  app.get('/api/stock/vehicles', { config: { scope: 'fleet.view' } }, async () => {
    const models = await prisma.vehicleModel.findMany({
      where: { archived: false },
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        brand: true,
        name: true,
        costTetri: true,
        salePriceTetri: true,
        vehicles: { where: { archived: false }, select: { state: true, costTetri: true } },
      },
    });
    const onOrder = await prisma.purchaseLine.groupBy({
      by: ['modelId'],
      where: { modelId: { not: null }, purchase: { status: 'ordered' } },
      _sum: { qty: true },
    });
    const ordered = new Map(onOrder.map((o) => [o.modelId as string, o._sum.qty ?? 0]));

    const rows = models.map((m) => {
      const byState = { available: 0, rented: 0, service: 0, out: 0, sold: 0 } as Record<string, number>;
      let valueTetri = 0;
      let unpriced = 0;
      for (const v of m.vehicles) {
        byState[v.state]++;
        // Sold and written off are gone; only what is still ours is worth
        // anything on a shelf.
        if (v.state === 'sold' || v.state === 'out') continue;
        if (v.costTetri == null) unpriced++;
        else valueTetri += v.costTetri;
      }
      return {
        id: m.id,
        name: `${m.brand} ${m.name}`,
        costTetri: m.costTetri,
        salePriceTetri: m.salePriceTetri,
        byState,
        inStock: byState.available,
        ours: byState.available + byState.rented + byState.service,
        onOrder: ordered.get(m.id) ?? 0,
        valueTetri,
        unpriced,
      };
    });
    return {
      rows,
      totals: {
        inStock: rows.reduce((n, r) => n + r.inStock, 0),
        ours: rows.reduce((n, r) => n + r.ours, 0),
        onOrder: rows.reduce((n, r) => n + r.onOrder, 0),
        valueTetri: rows.reduce((n, r) => n + r.valueTetri, 0),
        unpriced: rows.reduce((n, r) => n + r.unpriced, 0),
      },
    };
  });
}
