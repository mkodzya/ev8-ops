import { batteryCount, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { date, int, oneOf, str } from '../lib/validate.js';

// Batteries are counted, not numbered (wave 4 §3.8, D16): an owner's stocktake
// plus what happened after it. What the couriers hold is never typed in — it
// is what the live rentals' acts handed over.

type Body = Record<string, unknown>;

/** How many batteries went out with the rentals that are still open. */
async function couriersNow(): Promise<number> {
  const rows = await prisma.rental.findMany({ where: { status: { not: 'returned' } }, select: { batteries: true } });
  return rows.reduce((n, r) => n + (r.batteries ?? 0), 0);
}

export async function batteriesNow(): Promise<{ total: number; couriers: number; repair: number; showroom: number }> {
  const inventory = await prisma.batteryInventory.findFirst({ orderBy: [{ countedOn: 'desc' }, { createdAt: 'desc' }] });
  const movesSince = await prisma.batteryMove.findMany({
    where: inventory ? { createdAt: { gt: inventory.createdAt } } : {},
    select: { kind: true, qty: true },
  });
  return batteryCount({
    inventory: inventory
      ? { countedOn: isoDate(inventory.countedOn)!, showroomQty: inventory.showroomQty, repairQty: inventory.repairQty, couriersQty: inventory.couriersQty, totalQty: inventory.totalQty }
      : null,
    movesSince: movesSince.map((m) => ({ kind: m.kind as 'to_repair', qty: m.qty })),
    couriersNow: await couriersNow(),
  });
}

export function batteryRoutes(app: FastifyInstance): void {
  /** The count and how it moved (§3.8): everyone who sees the fleet sees it. */
  app.get('/api/batteries', { config: { scope: 'fleet.view' } }, async () => {
    const [count, inventory, moves, inventories, rentals] = await Promise.all([
      batteriesNow(),
      prisma.batteryInventory.findFirst({ orderBy: [{ countedOn: 'desc' }, { createdAt: 'desc' }], include: { createdBy: { select: { name: true } } } }),
      prisma.batteryMove.findMany({
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        take: 60,
        include: { rental: { select: { number: true } }, createdBy: { select: { name: true } } },
      }),
      prisma.batteryInventory.findMany({ orderBy: [{ countedOn: 'desc' }, { createdAt: 'desc' }], take: 10, include: { createdBy: { select: { name: true } } } }),
      // Batteries leave and come back with the mopeds: those movements are the
      // acts themselves, not rows anybody writes (QA-W4-07).
      prisma.rental.findMany({
        where: { batteries: { gt: 0 } },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: { number: true, batteries: true, pickedUpOn: true, returnedOn: true },
      }),
    ]);
    return {
      ...count,
      // What the acts say the couriers hold, before any total clamps it: the
      // stocktake sheet adds this to what is counted by hand (QA-W4-04).
      couriersByActs: await couriersNow(),
      lastInventory: inventory
        ? { countedOn: isoDate(inventory.countedOn), showroomQty: inventory.showroomQty, repairQty: inventory.repairQty, couriersQty: inventory.couriersQty, totalQty: inventory.totalQty, by: inventory.createdBy?.name ?? null, reason: inventory.reason }
        : null,
      moves: [
        ...moves.map((m) => ({ id: m.id, kind: m.kind, qty: m.qty, reason: m.reason, number: m.rental?.number ?? null, occurredOn: isoDate(m.occurredOn), by: m.createdBy?.name ?? null })),
        ...rentals.flatMap((r) => [
          ...(r.pickedUpOn ? [{ id: `out:${r.number}`, kind: 'handed_out', qty: r.batteries ?? 0, reason: null, number: r.number, occurredOn: isoDate(r.pickedUpOn), by: null }] : []),
          ...(r.returnedOn ? [{ id: `back:${r.number}`, kind: 'came_back', qty: r.batteries ?? 0, reason: null, number: r.number, occurredOn: isoDate(r.returnedOn), by: null }] : []),
        ]),
      ].sort((a, b) => (a.occurredOn ?? '') < (b.occurredOn ?? '') ? 1 : (a.occurredOn ?? '') > (b.occurredOn ?? '') ? -1 : 0),
      inventories: inventories.map((i) => ({ id: i.id, countedOn: isoDate(i.countedOn), showroomQty: i.showroomQty, repairQty: i.repairQty, couriersQty: i.couriersQty, totalQty: i.totalQty, reason: i.reason, by: i.createdBy?.name ?? null })),
    };
  });

  /** A stocktake: an owner counted the shelf and the repairs (§3.8). */
  app.post<{ Body: Body }>('/api/batteries/inventory', { config: { scope: 'fleet.pool.set' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const showroomQty = int(b, 'showroomQty', { required: true, min: 0 })!;
    const repairQty = int(b, 'repairQty', { min: 0 }) ?? 0;
    const reason = str(b, 'reason', { max: 1000 });
    const countedOn = date(b, 'countedOn') ?? todayISO(new Date(), env.TZ);
    const couriers = await couriersNow();
    const before = await batteriesNow();
    const total = showroomQty + repairQty + couriers;
    // A count that does not agree with what was expected is a fact, but it
    // needs words: where the difference came from (crit. 33).
    if (total !== before.total && !reason?.trim()) {
      throw badRequest('missing_field', 'A count that differs from the expected one needs a reason.', { field: 'reason', expected: before.total, counted: total });
    }
    const row = await prisma.batteryInventory.create({
      data: { countedOn: dateFromISO(countedOn)!, showroomQty, repairQty, couriersQty: couriers, totalQty: total, reason: reason ?? null, createdById: actor.id },
    });
    await audit({ actorId: actor.id, action: 'battery.inventory', entityType: 'battery', entityId: row.id, before: { total: before.total }, after: { total, showroomQty, repairQty, couriersQty: couriers }, note: reason });
    return reply.code(201).send({ id: row.id, ...(await batteriesNow()) });
  });

  /** To repair and back, or a battery that turned up (§3.8). */
  app.post<{ Body: Body }>('/api/batteries/moves', { config: { scope: 'fleet.pool.set' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const kind = oneOf(b, 'kind', ['to_repair', 'from_repair', 'lost', 'found'] as const, { required: true })!;
    const qty = int(b, 'qty', { required: true, min: 1 })!;
    const reason = str(b, 'reason', { max: 1000 });
    if (!reason?.trim()) throw badRequest('missing_field', 'Say what happened.', { field: 'reason' });
    const row = await prisma.batteryMove.create({
      data: { kind, qty, reason, occurredOn: dateFromISO(date(b, 'occurredOn') ?? todayISO(new Date(), env.TZ))!, createdById: actor.id },
    });
    await audit({ actorId: actor.id, action: 'battery.move', entityType: 'battery', entityId: row.id, after: { kind, qty }, note: reason });
    return reply.code(201).send({ id: row.id, ...(await batteriesNow()) });
  });
}
