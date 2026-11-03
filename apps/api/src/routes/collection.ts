import { COLLECTION_GPS, COLLECTION_OUTCOMES, addDays, blockedSince, todayISO, type CollectionEvent, type ISODate } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { date, oneOf, str } from '../lib/validate.js';

// «Взыскание» — what a person writes down (ADR-0054): how a call went, and
// that the moped was blocked or unblocked in the tracker's app. Whoever calls
// by the schedule writes them — an owner and a manager (`payments.schedule`);
// a manager blocks and picks up (Mika, 03.11.2026). Each is a row of its own
// and a line in the journal: who called, when, and what was said.

type Body = Record<string, unknown>;

// A promise further than this is not a promise to pay but a new arrangement.
const MAX_PROMISE_DAYS = 60;
const RUNNING = ['active', 'overdue'];

async function runningRental(id: string) {
  const r = await prisma.rental.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!r) throw notFound('rental_not_found', 'No such rental.');
  if (!RUNNING.includes(r.status)) throw conflict('collection_not_running', 'Only a running rental is called about and blocked.');
  return r;
}

async function marks(rentalId: string): Promise<CollectionEvent[]> {
  const rows = await prisma.collectionEvent.findMany({ where: { rentalId, kind: { in: ['blocked', 'unblocked'] } }, orderBy: { createdAt: 'asc' }, select: { kind: true, day: true } });
  return rows.map((e) => ({ kind: e.kind as CollectionEvent['kind'], on: isoDate(e.day) as ISODate }));
}

export function collectionRoutes(app: FastifyInstance): void {
  /** How a call went: paid or pays today, promised by a day, refuses, did not answer — and what the GPS showed. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/rentals/:id/collection/call', { config: { scope: 'payments.schedule' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const today = todayISO(new Date(), env.TZ) as ISODate;
    const outcome = oneOf(b, 'outcome', COLLECTION_OUTCOMES, { required: true })!;
    const gps = oneOf(b, 'gps', COLLECTION_GPS);
    const note = str(b, 'note', { max: 1000 });
    let promisedOn: ISODate | null = null;
    if (outcome === 'promised') {
      promisedOn = date(b, 'promisedOn', { required: true }) as ISODate;
      if (promisedOn < today || promisedOn > addDays(today, MAX_PROMISE_DAYS)) {
        throw badRequest('bad_field', `A promise is for today or a day within ${MAX_PROMISE_DAYS} days.`, { field: 'promisedOn', maxDays: MAX_PROMISE_DAYS });
      }
    }
    const r = await runningRental(req.params.id);
    const made = await prisma.collectionEvent.create({
      data: { rentalId: r.id, kind: 'call', day: dateFromISO(today)!, outcome, promisedOn: promisedOn ? dateFromISO(promisedOn) : null, gps, note, createdById: actor.id },
      select: { id: true },
    });
    await audit({ actorId: actor.id, action: 'rental.collection.call', entityType: 'rental', entityId: r.id, after: { outcome, promisedOn, gps }, note });
    return reply.code(201).send({ ok: true, id: made.id });
  });

  /** Blocked in the tracker's app — and where the moped is, for whoever picks it up. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/rentals/:id/collection/block', { config: { scope: 'payments.schedule' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const today = todayISO(new Date(), env.TZ) as ISODate;
    const place = str(b, 'place', { max: 500 });
    const note = str(b, 'note', { max: 1000 });
    const r = await runningRental(req.params.id);
    if (blockedSince(await marks(r.id))) throw conflict('already_blocked', 'This moped is marked blocked already.');
    const made = await prisma.collectionEvent.create({ data: { rentalId: r.id, kind: 'blocked', day: dateFromISO(today)!, place, note, createdById: actor.id }, select: { id: true } });
    await audit({ actorId: actor.id, action: 'rental.collection.blocked', entityType: 'rental', entityId: r.id, after: { place }, note });
    return reply.code(201).send({ ok: true, id: made.id });
  });

  /** The block taken off in the tracker's app: paid since, or decided otherwise. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/rentals/:id/collection/unblock', { config: { scope: 'payments.schedule' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const today = todayISO(new Date(), env.TZ) as ISODate;
    const note = str(b, 'note', { max: 1000 });
    const r = await runningRental(req.params.id);
    if (!blockedSince(await marks(r.id))) throw conflict('not_blocked', 'This moped is not marked blocked.');
    const made = await prisma.collectionEvent.create({ data: { rentalId: r.id, kind: 'unblocked', day: dateFromISO(today)!, note, createdById: actor.id }, select: { id: true } });
    await audit({ actorId: actor.id, action: 'rental.collection.unblocked', entityType: 'rental', entityId: r.id, note });
    return reply.code(201).send({ ok: true, id: made.id });
  });
}
