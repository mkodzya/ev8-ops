// Points: the company's own words for where a moped stands.
//
// Two rights, on purpose. Naming the places is the owner's (settings.manage);
// saying which one a moped is at is everyone who touches mopeds, Kardu and
// the mechanic included (fleet.location.set) — a point nobody may correct
// goes stale by the end of the first week.
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { int, str } from '../lib/validate.js';

type Body = Record<string, unknown>;

export function locationRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { all?: string } }>('/api/locations', { config: { scope: 'fleet.view' } }, async (req) => {
    const rows = await prisma.location.findMany({
      where: req.query.all === '1' ? {} : { archived: false },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { vehicles: true } } },
    });
    return {
      locations: rows.map((l) => ({
        id: l.id,
        name: l.name,
        note: l.note,
        sortOrder: l.sortOrder,
        archived: l.archived,
        vehicles: l._count.vehicles,
      })),
    };
  });

  app.post<{ Body: Body }>('/api/locations', { config: { scope: 'settings.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const name = str(b, 'name', { required: true, max: 120 })!;
    try {
      const l = await prisma.location.create({
        data: {
          name,
          note: str(b, 'note', { max: 1000 }),
          sortOrder: int(b, 'sortOrder', { min: 0, max: 999 }) ?? 0,
          createdById: actor.id,
        },
      });
      await audit({ actorId: actor.id, action: 'location.create', entityType: 'location', entityId: l.id, after: { name: l.name } });
      return reply.code(201).send({ id: l.id });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_location', 'A point with that name already exists.');
      throw e;
    }
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/locations/:id', { config: { scope: 'settings.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const before = await prisma.location.findUnique({ where: { id: req.params.id }, include: { _count: { select: { vehicles: true } } } });
    if (!before) throw notFound('location_not_found', 'No such point.');
    const data: Record<string, unknown> = {};
    if ('name' in b) data.name = str(b, 'name', { required: true, max: 120 });
    if ('note' in b) data.note = str(b, 'note', { max: 1000 });
    if ('sortOrder' in b) data.sortOrder = int(b, 'sortOrder', { min: 0, max: 999 }) ?? 0;
    if ('archived' in b) {
      // Retiring a point that still holds mopeds would leave them pointing at
      // a place the company no longer has. Move them first; the count says how
      // many, so the message is an instruction and not a refusal.
      if (Boolean(b.archived) && before._count.vehicles > 0) {
        throw conflict('location_in_use', `${before._count.vehicles} moped(s) still stand here. Move them to another point first.`, {
          vehicles: before._count.vehicles,
        });
      }
      data.archived = Boolean(b.archived);
    }
    try {
      await prisma.location.update({ where: { id: before.id }, data: { ...data, updatedAt: new Date() } });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_location', 'A point with that name already exists.');
      throw e;
    }
    await audit({ actorId: actor.id, action: 'location.update', entityType: 'location', entityId: before.id, before: { name: before.name, archived: before.archived }, after: data as object });
    return { ok: true };
  });

  // Where this moped stands now. `null` clears it: "nobody has placed it" is
  // an answer, and a better one than a stale yard.
  app.post<{ Params: { id: string }; Body: Body }>('/api/fleet/:id/location', { config: { scope: 'fleet.location.set' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const v = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
    if (!v) throw notFound('vehicle_not_found', 'No such moped.');
    if (v.state === 'rented') throw conflict('vehicle_rented', 'This moped is with a customer, which is where it is. It takes a point back on return.');
    const raw = str(b, 'locationId', { max: 64 });
    let locationId: string | null = null;
    if (raw) {
      const l = await prisma.location.findUnique({ where: { id: raw } });
      if (!l || l.archived) throw notFound('location_not_found', 'No such point.');
      locationId = l.id;
    }
    await prisma.vehicle.update({ where: { id: v.id }, data: { locationId, updatedAt: new Date() } });
    await audit({ actorId: actor.id, action: 'vehicle.location', entityType: 'vehicle', entityId: v.id, before: { locationId: v.locationId }, after: { locationId } });
    return { ok: true };
  });
}
