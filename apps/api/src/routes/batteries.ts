import { batteryCount, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { date, int, oneOf, str } from '../lib/validate.js';

// Batteries are counted, not numbered (wave 4 §3.8, D16): an owner's stocktake
// plus what happened after it. What the couriers hold is never typed in — it
// is what the live rentals' acts handed over. Chargers are counted the same
// way since migration 0044 (meeting of 14.10.2026): every row says which.

type Body = Record<string, unknown>;
type Db = Prisma.TransactionClient | typeof prisma;

export const COUNTED_ITEMS = ['battery', 'charger'] as const;
export type CountedItem = (typeof COUNTED_ITEMS)[number];

/** How many went out with the rentals that are still open. */
async function couriersNow(item: CountedItem, db: Db = prisma): Promise<number> {
  const rows = await db.rental.findMany({ where: { status: { not: 'returned' } }, select: { batteries: true, chargers: true } });
  return rows.reduce((n, r) => n + ((item === 'charger' ? r.chargers : r.batteries) ?? 0), 0);
}

/**
 * The count now. Read through a transaction's client when a goods sale asks:
 * it counts what is in the showroom after its own lock (issue #11).
 */
export async function batteriesNow(item: CountedItem = 'battery', db: Db = prisma): Promise<{ total: number; couriers: number; repair: number; showroom: number }> {
  const inventory = await db.batteryInventory.findFirst({ where: { item }, orderBy: [{ countedOn: 'desc' }, { createdAt: 'desc' }] });
  const movesSince = await db.batteryMove.findMany({
    where: inventory ? { item, createdAt: { gt: inventory.createdAt } } : { item },
    select: { kind: true, qty: true },
  });
  return batteryCount({
    inventory: inventory
      ? { countedOn: isoDate(inventory.countedOn)!, showroomQty: inventory.showroomQty, repairQty: inventory.repairQty, couriersQty: inventory.couriersQty, totalQty: inventory.totalQty }
      : null,
    movesSince: movesSince.map((m) => ({ kind: m.kind as 'to_repair', qty: m.qty })),
    couriersNow: await couriersNow(item, db),
  });
}

/** The day the item was last counted: a sale dated on or before it asks whether the count saw it gone (ADR-0045 §9). */
export async function countedItemLastCountOn(item: CountedItem, db: Db = prisma): Promise<string | null> {
  const last = await db.batteryInventory.findFirst({ where: { item }, orderBy: [{ countedOn: 'desc' }, { createdAt: 'desc' }], select: { countedOn: true } });
  return last ? isoDate(last.countedOn) : null;
}

function itemOf(value: unknown): CountedItem {
  if (value == null || value === '') return 'battery';
  if (value === 'battery' || value === 'charger') return value;
  throw badRequest('bad_field', 'item is battery or charger', { field: 'item' });
}

export function batteryRoutes(app: FastifyInstance): void {
  /** The count and how it moved (§3.8): everyone who sees the fleet sees it. */
  app.get<{ Querystring: { item?: string } }>('/api/batteries', { config: { scope: 'fleet.view' } }, async (req) => {
    const item = itemOf(req.query.item);
    const field = item === 'charger' ? 'chargers' : 'batteries';
    const [count, inventory, moves, inventories, rentals] = await Promise.all([
      batteriesNow(item),
      prisma.batteryInventory.findFirst({ where: { item }, orderBy: [{ countedOn: 'desc' }, { createdAt: 'desc' }], include: { createdBy: { select: { name: true } } } }),
      prisma.batteryMove.findMany({
        where: { item },
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        take: 60,
        include: { rental: { select: { number: true } }, createdBy: { select: { name: true } }, goodsSaleLine: { select: { sale: { select: { id: true, number: true } } } } },
      }),
      prisma.batteryInventory.findMany({ where: { item }, orderBy: [{ countedOn: 'desc' }, { createdAt: 'desc' }], take: 10, include: { createdBy: { select: { name: true } } } }),
      // Batteries leave and come back with the mopeds: those movements are the
      // acts themselves, not rows anybody writes (QA-W4-07).
      prisma.rental.findMany({
        where: { [field]: { gt: 0 } },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: { number: true, batteries: true, chargers: true, pickedUpOn: true, returnedOn: true },
      }),
    ]);
    const handed = (r: { batteries: number | null; chargers: number | null }) => (item === 'charger' ? r.chargers : r.batteries) ?? 0;
    return {
      item,
      ...count,
      // What the acts say the couriers hold, before any total clamps it: the
      // stocktake sheet adds this to what is counted by hand (QA-W4-04).
      couriersByActs: await couriersNow(item),
      lastInventory: inventory
        ? { countedOn: isoDate(inventory.countedOn), showroomQty: inventory.showroomQty, repairQty: inventory.repairQty, couriersQty: inventory.couriersQty, totalQty: inventory.totalQty, by: inventory.createdBy?.name ?? null, reason: inventory.reason }
        : null,
      moves: [
        // A goods sale's movement names its sale and links to it (issue #11): sold, back after a cancellation, found when sold beyond the count.
        ...moves.map((m) => ({
          id: m.id,
          kind: m.kind,
          qty: m.qty,
          reason: m.reason,
          number: m.rental?.number ?? m.goodsSaleLine?.sale.number ?? null,
          goodsSaleId: m.goodsSaleLine?.sale.id ?? null,
          occurredOn: isoDate(m.occurredOn),
          by: m.createdBy?.name ?? null,
        })),
        ...rentals.flatMap((r) => [
          ...(r.pickedUpOn ? [{ id: `out:${r.number}`, kind: 'handed_out', qty: handed(r), reason: null, number: r.number, occurredOn: isoDate(r.pickedUpOn), by: null }] : []),
          ...(r.returnedOn ? [{ id: `back:${r.number}`, kind: 'came_back', qty: handed(r), reason: null, number: r.number, occurredOn: isoDate(r.returnedOn), by: null }] : []),
        ]),
      ].sort((a, b) => (a.occurredOn ?? '') < (b.occurredOn ?? '') ? 1 : (a.occurredOn ?? '') > (b.occurredOn ?? '') ? -1 : 0),
      inventories: inventories.map((i) => ({ id: i.id, countedOn: isoDate(i.countedOn), showroomQty: i.showroomQty, repairQty: i.repairQty, couriersQty: i.couriersQty, totalQty: i.totalQty, reason: i.reason, by: i.createdBy?.name ?? null })),
    };
  });

  /** A stocktake: an owner counted the shelf and the repairs (§3.8). */
  app.post<{ Body: Body }>('/api/batteries/inventory', { config: { scope: 'fleet.pool.set' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const item = itemOf(b.item);
    const showroomQty = int(b, 'showroomQty', { required: true, min: 0 })!;
    const repairQty = int(b, 'repairQty', { min: 0 }) ?? 0;
    const reason = str(b, 'reason', { max: 1000 });
    const countedOn = date(b, 'countedOn') ?? todayISO(new Date(), env.TZ);
    const couriers = await couriersNow(item);
    const before = await batteriesNow(item);
    const total = showroomQty + repairQty + couriers;
    // A count that does not agree with what was expected is a fact, but it
    // needs words: where the difference came from (crit. 33).
    if (total !== before.total && !reason?.trim()) {
      throw badRequest('missing_field', 'A count that differs from the expected one needs a reason.', { field: 'reason', expected: before.total, counted: total });
    }
    const row = await prisma.batteryInventory.create({
      data: { item, countedOn: dateFromISO(countedOn)!, showroomQty, repairQty, couriersQty: couriers, totalQty: total, reason: reason ?? null, createdById: actor.id },
    });
    await audit({
      actorId: actor.id,
      action: item === 'charger' ? 'charger.inventory' : 'battery.inventory',
      entityType: item,
      entityId: row.id,
      before: { total: before.total },
      after: { total, showroomQty, repairQty, couriersQty: couriers },
      note: reason,
    });
    return reply.code(201).send({ id: row.id, ...(await batteriesNow(item)) });
  });

  /** To repair and back, or a battery that turned up (§3.8). */
  app.post<{ Body: Body }>('/api/batteries/moves', { config: { scope: 'fleet.pool.set' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const item = itemOf(b.item);
    const kind = oneOf(b, 'kind', ['to_repair', 'from_repair', 'lost', 'found'] as const, { required: true })!;
    const qty = int(b, 'qty', { required: true, min: 1 })!;
    const reason = str(b, 'reason', { max: 1000 });
    if (!reason?.trim()) throw badRequest('missing_field', 'Say what happened.', { field: 'reason' });
    const row = await prisma.batteryMove.create({
      data: { item, kind, qty, reason, occurredOn: dateFromISO(date(b, 'occurredOn') ?? todayISO(new Date(), env.TZ))!, createdById: actor.id },
    });
    await audit({ actorId: actor.id, action: item === 'charger' ? 'charger.move' : 'battery.move', entityType: item, entityId: row.id, after: { kind, qty }, note: reason });
    return reply.code(201).send({ id: row.id, ...(await batteriesNow(item)) });
  });
}
