import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { actorOf, mayView } from '../lib/guard.js';
import { str, tetri } from '../lib/validate.js';
import { PURCHASE_INCLUDE, serializePurchase } from './purchases.js';

// Models: the catalogue a moped, a purchase line and a sale all point at
// (ADR-0011).
//
// A model says what a moped of its kind costs to rent and to buy. What one
// cost *us* is not typed here: a received purchase writes it, and before
// the first one the only figure is the one Odoo held, labelled as Odoo's.
// Whether a moped is rented or sold is the moped's park, not the model's,
// so the old "for rent / for sale" flags are no longer read or written.

type Body = Record<string, unknown>;

/** Where the model's unit cost came from, so a screen can say so. */
type CostSource = { kind: 'purchase'; purchaseId: string; number: string; receivedOn: string | null } | { kind: 'odoo' } | { kind: 'manual' } | null;

interface ModelRow {
  id: string;
  brand: string;
  name: string;
  salePriceTetri: number | null;
  weeklyRateTetri: number | null;
  costTetri: number | null;
  photoUrl: string | null;
  notes: string | null;
  archived: boolean;
  odooSaleProductId: number | null;
  odooRentalProductId: number | null;
  odooFleetModelId: number | null;
}

/** Everything the list and the card both say about a set of models. */
async function describe(models: ModelRow[]) {
  const ids = models.map((m) => m.id);
  const vehicles = await prisma.vehicle.findMany({
    where: { modelId: { in: ids }, archived: false },
    select: { modelId: true, state: true, pool: true },
  });
  const lines = await prisma.purchaseLine.findMany({
    where: { modelId: { in: ids }, purchase: { status: { in: ['ordered', 'received'] } } },
    select: { modelId: true, qty: true, purchase: { select: { id: true, number: true, status: true, receivedOn: true } } },
  });

  return models.map((m) => {
    const fleet = { rent: 0, sale: 0, none: 0, gone: 0 };
    for (const v of vehicles) {
      if (v.modelId !== m.id) continue;
      if (v.state === 'sold' || v.state === 'out') fleet.gone++;
      else fleet[v.pool ?? 'none']++;
    }
    const mine = lines.filter((l) => l.modelId === m.id);
    const ordered = mine.filter((l) => l.purchase.status === 'ordered');
    const received = mine
      .filter((l) => l.purchase.status === 'received' && l.purchase.receivedOn)
      .sort((a, b) => b.purchase.receivedOn!.getTime() - a.purchase.receivedOn!.getTime())[0];

    let costSource: CostSource = null;
    if (received) costSource = { kind: 'purchase', purchaseId: received.purchase.id, number: received.purchase.number, receivedOn: isoDate(received.purchase.receivedOn) };
    else if (m.costTetri != null) costSource = m.odooSaleProductId != null || m.odooRentalProductId != null || m.odooFleetModelId != null ? { kind: 'odoo' } : { kind: 'manual' };

    return {
      id: m.id,
      brand: m.brand,
      name: m.name,
      salePriceTetri: m.salePriceTetri,
      weeklyRateTetri: m.weeklyRateTetri,
      costTetri: m.costTetri,
      costSource,
      photoUrl: m.photoUrl,
      notes: m.notes,
      archived: m.archived,
      vehicles: fleet.rent + fleet.sale + fleet.none + fleet.gone,
      fleet,
      onOrder: ordered.reduce((n, l) => n + l.qty, 0),
      orders: ordered.map((l) => ({ id: l.purchase.id, number: l.purchase.number, qty: l.qty })),
    };
  });
}

/** The same model spelled another way is the same model. */
async function sameModel(brand: string, name: string, except?: string) {
  return prisma.vehicleModel.findFirst({
    where: {
      brand: { equals: brand, mode: 'insensitive' },
      name: { equals: name, mode: 'insensitive' },
      ...(except ? { id: { not: except } } : {}),
    },
    select: { id: true, brand: true, name: true },
  });
}

/** A brand already in the catalogue keeps its spelling: "flybrother" is Flybrother. */
async function brandAsKnown(brand: string) {
  const known = await prisma.vehicleModel.findFirst({ where: { brand: { equals: brand, mode: 'insensitive' } }, select: { brand: true } });
  return known?.brand ?? brand;
}

export function modelRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { archived?: string } }>('/api/models', { config: { scope: 'fleet.view' } }, async (req) => {
    const withArchived = req.query.archived === '1';
    const models = await prisma.vehicleModel.findMany({
      where: withArchived ? {} : { archived: false },
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
    });
    const rows = await describe(models);
    return { models: mayView(req, 'cost.view') ? rows : rows.map(withoutCost) };
  });

  app.get<{ Params: { id: string } }>('/api/models/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const m = await prisma.vehicleModel.findUnique({ where: { id: req.params.id } });
    if (!m) throw notFound('model_not_found', 'No such model.');
    const seeCost = mayView(req, 'cost.view');
    const [described] = await describe([m]);
    const model = seeCost ? described : withoutCost(described);

    const vehicles = await prisma.vehicle.findMany({
      where: { modelId: m.id, archived: false },
      orderBy: { vin: 'asc' },
      select: { id: true, vin: true, state: true, pool: true, color: true, location: { select: { id: true, name: true } } },
    });

    // Each order is read whole, because what one unit cost follows from
    // every line and every payment on it — the same figure the order shows.
    const purchases = await prisma.purchase.findMany({
      where: { lines: { some: { modelId: m.id } } },
      orderBy: { orderedOn: 'desc' },
      include: PURCHASE_INCLUDE,
    });
    const orders = purchases.flatMap((p) => {
      const s = serializePurchase(p);
      return s.lines
        .filter((l) => l.model?.id === m.id)
        .map((l) => ({
          lineId: l.id,
          purchaseId: s.id,
          number: s.number,
          status: s.status,
          orderedOn: s.orderedOn,
          receivedOn: s.receivedOn,
          currency: s.currency,
          qty: l.qty,
          unitPriceMinor: l.unitPriceMinor,
          unitCostTetri: s.paidTetri > 0 ? l.unitCostTetri : null,
        }));
    });

    // Orders are purchases, and purchases are the owners' (redesign §2.1).
    return { model, vehicles, orders: mayView(req, 'purchases.view') ? orders : [] };
  });

  app.post<{ Body: Body }>('/api/models', { config: { scope: 'settings.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const brand = await brandAsKnown(str(b, 'brand', { required: true, max: 100 })!);
    const name = str(b, 'name', { required: true, max: 100 })!;
    const twin = await sameModel(brand, name);
    if (twin) throw conflict('duplicate_model', 'That brand and name are already a model.', { id: twin.id, name: `${twin.brand} ${twin.name}` });
    let id: string;
    try {
      const m = await prisma.vehicleModel.create({
        data: {
          brand,
          name,
          salePriceTetri: tetri(b, 'salePriceTetri', { min: 0 }),
          weeklyRateTetri: tetri(b, 'weeklyRateTetri', { min: 0 }),
          notes: str(b, 'notes', { max: 4000 }),
        },
      });
      id = m.id;
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_model', 'That brand and name are already a model.');
      throw e;
    }
    await audit({ actorId: actor.id, action: 'model.create', entityType: 'vehicle_model', entityId: id, after: { brand, name } });
    return reply.code(201).send({ id, brand, name });
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/models/:id', { config: { scope: 'settings.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const before = await prisma.vehicleModel.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('model_not_found', 'No such model.');
    const data: Record<string, unknown> = {};
    if ('brand' in b) data.brand = await brandAsKnown(str(b, 'brand', { required: true, max: 100 })!);
    if ('name' in b) data.name = str(b, 'name', { required: true, max: 100 });
    for (const k of ['salePriceTetri', 'weeklyRateTetri'] as const) {
      if (k in b) data[k] = tetri(b, k, { min: 0 });
    }
    if ('notes' in b) data.notes = str(b, 'notes', { max: 4000 });
    if ('archived' in b) data.archived = Boolean(b.archived);
    if ('brand' in data || 'name' in data) {
      const twin = await sameModel((data.brand as string) ?? before.brand, (data.name as string) ?? before.name, before.id);
      if (twin) throw conflict('duplicate_model', 'That brand and name are already a model.', { id: twin.id, name: `${twin.brand} ${twin.name}` });
    }
    try {
      await prisma.vehicleModel.update({ where: { id: before.id }, data: { ...data, updatedAt: new Date() } });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_model', 'That brand and name are already a model.');
      throw e;
    }
    const was = Object.fromEntries(Object.keys(data).map((k) => [k, (before as Record<string, unknown>)[k]]));
    await audit({ actorId: actor.id, action: 'model.update', entityType: 'vehicle_model', entityId: before.id, before: was, after: data });
    return { ok: true };
  });
}

/** A model as a manager reads it: prices yes, what it cost us no — the fields are not in the answer at all (QA-W1-07). */
function withoutCost<T extends { costTetri: number | null; costSource: unknown }>(m: T): Omit<T, 'costTetri' | 'costSource'> {
  const { costTetri: _cost, costSource: _source, ...rest } = m;
  return rest;
}
