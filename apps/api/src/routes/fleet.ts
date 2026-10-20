import { POOL_EVENT, VEHICLE_POOLS, VEHICLE_STATES, fleetNumber, readFleetNumber, repairTotalTetri, todayISO, type VehiclePool, type VehicleState } from '@ev8/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { PART_MONEY, WORK_MONEY } from '../lib/stock.js';
import { env } from '../lib/env.js';
import { badRequest, notFound } from '../lib/errors.js';
import { mayView } from '../lib/guard.js';
import { preliminaryOf } from '../lib/purchases.js';
import { rentStateOf } from '../lib/rentState.js';
import { renderStickers } from '../lib/pdf/stickers.js';
import { settingsRow } from './settings.js';

// Read side of the fleet (FLT-01, FLT-02). Writes arrive with the hand-over
// and return wizards in step 4 of stage 1; state changes go through events.

export function fleetRoutes(app: FastifyInstance): void {
  app.get('/api/fleet', { config: { scope: 'fleet.view' } }, async () => {
    const vehicles = await prisma.vehicle.findMany({
      where: { archived: false },
      orderBy: [{ state: 'asc' }, { vin: 'asc' }],
      include: {
        model: { select: { brand: true, name: true, weeklyRateTetri: true, salePriceTetri: true } },
        location: { select: { id: true, name: true } },
        // The last thing that happened to this moped. Nothing yet? Then the
        // day it arrived — and for the mopeds Odoo never dated, nothing at
        // all, which the screen shows as a dash and not as a zero. A park move
        // is paper, not a ride: it does not break the silence.
        events: {
          where: { kind: { notIn: Object.values(POOL_EVENT) } },
          select: { occurredOn: true },
          orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
        currentRental: {
          select: { id: true, number: true, paidThrough: true, customer: { select: { id: true, name: true, nameKa: true, nameLat: true } } },
        },
      },
    });
    const byState = Object.fromEntries(VEHICLE_STATES.map((s) => [s, 0])) as Record<VehicleState, number>;
    for (const v of vehicles) byState[v.state as VehicleState]++;
    // Counted the way the screen groups them: a moped that has left the fleet
    // is neither park's, and one nobody has decided on is its own answer.
    const byPool = { ...Object.fromEntries(VEHICLE_POOLS.map((p) => [p, 0])), none: 0, gone: 0 } as Record<VehiclePool | 'none' | 'gone', number>;
    for (const v of vehicles) {
      if (v.state === 'sold' || v.state === 'out') byPool.gone++;
      else if (v.pool) byPool[v.pool as VehiclePool]++;
      else byPool.none++;
    }
    return {
      byState,
      byPool,
      vehicles: vehicles.map((v) => ({
        id: v.id,
        vin: v.vin,
        fleetNo: v.fleetNo,
        model: `${v.model.brand} ${v.model.name}`,
        weeklyRateTetri: v.model.weeklyRateTetri,
        salePriceTetri: v.model.salePriceTetri,
        color: v.color,
        year: v.year,
        arrivedOn: isoDate(v.arrivedOn),
        state: v.state,
        pool: v.pool,
        location: v.location,
        lastSeenOn: isoDate(v.events[0]?.occurredOn ?? v.arrivedOn),
        odometerKm: v.odometerKm,
        notes: v.notes,
        currentRental: v.currentRental
          ? {
              id: v.currentRental.id,
              number: v.currentRental.number,
              paidThrough: isoDate(v.currentRental.paidThrough),
              customer: v.currentRental.customer,
            }
          : null,
      })),
    };
  });

  /** The moped behind a sticker: /m/EV-007 on the screen asks here which card to open (migration 0043). */
  app.get<{ Params: { number: string } }>('/api/fleet/by-number/:number', { config: { scope: 'fleet.view' } }, async (req) => {
    const n = readFleetNumber(req.params.number, { digitsToo: true });
    const v = n ? await prisma.vehicle.findUnique({ where: { fleetNo: n }, select: { id: true } }) : null;
    if (!v) throw notFound('vehicle_not_found', 'No moped has that number.');
    return { id: v.id };
  });

  /**
   * The stickers, an A4 sheet of 24 (variant В1, Mika 15.10.2026). All mopeds
   * in the fleet, or the numbers from–to — a new batch gets consecutive ones.
   * The QR leads to the stand that printed it; only EV8 Ops' own addresses
   * are taken from the screen, anything else falls back to production's.
   */
  app.get<{ Querystring: { from?: string; to?: string; origin?: string } }>('/api/fleet/stickers.pdf', { config: { scope: 'fleet.view' } }, async (req, reply) => {
    const from = req.query.from ? Number(req.query.from) : null;
    const to = req.query.to ? Number(req.query.to) : null;
    if ((from != null && !(from >= 1)) || (to != null && !(to >= 1)) || (from != null && to != null && from > to)) {
      throw badRequest('bad_range', 'Say the numbers from and to, the first not above the last.', { field: 'from' });
    }
    const vehicles = await prisma.vehicle.findMany({
      where: { archived: false, fleetNo: { not: null, gte: from ?? undefined, lte: to ?? undefined } },
      orderBy: { fleetNo: 'asc' },
      select: { fleetNo: true, vin: true, model: { select: { brand: true, name: true } } },
    });
    if (vehicles.length === 0) throw notFound('vehicle_not_found', 'No moped has a number in that range.');
    const bytes = await renderStickers({
      origin: stickerOrigin(req.query.origin),
      phone: (await settingsRow()).stickerPhone,
      vehicles: vehicles.map((v) => ({ fleetNo: v.fleetNo!, vin: v.vin, model: `${v.model.brand} ${v.model.name}` })),
    });
    return sendPdf(reply, `ev8-stickers-${vehicles[0].fleetNo}-${vehicles[vehicles.length - 1].fleetNo}.pdf`, bytes);
  });

  app.get<{ Params: { id: string } }>('/api/fleet/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const v = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      include: {
        model: true,
        location: { select: { id: true, name: true } },
        events: { orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }], include: { actor: { select: { name: true } } } },
        rentals: {
          orderBy: { pickedUpOn: 'desc' },
          include: { customer: { select: { id: true, name: true, nameKa: true, nameLat: true } } },
        },
        serviceJobs: {
          orderBy: { openedOn: 'desc' },
          include: { parts: { select: PART_MONEY }, works: { select: WORK_MONEY } },
        },
        trackers: {
          orderBy: [{ installedOn: 'desc' }, { createdAt: 'desc' }],
          include: { serviceJob: { select: { id: true, number: true } }, removedJob: { select: { id: true, number: true } } },
        },
        donatedParts: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, name: true, qty: true, createdAt: true, job: { select: { id: true, number: true, vehicle: { select: { id: true, fleetNo: true, vin: true } } } } },
        },
      },
    });
    if (!v) throw notFound('vehicle_not_found', 'No such vehicle.');
    // What it cost is still moving while its shipment is unpaid (§7, QA-W5-11).
    const order = v.purchaseId ? (await preliminaryOf([v.purchaseId])).get(v.purchaseId) ?? null : null;
    // Corrections live in the journal and nowhere else, so until now a VIN
    // put right, a park changed or a cost rewritten left no trace anybody
    // could see (crit. 13, 19, 32 — QA-W5-01).
    const journal = await prisma.auditLog.findMany({
      where: { entityType: 'vehicle', entityId: v.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { actor: { select: { name: true } } },
    });
    const today = todayISO(new Date(), env.TZ);
    return {
      vehicle: {
        id: v.id,
        vin: v.vin,
        fleetNo: v.fleetNo,
        model: { id: v.model.id, brand: v.model.brand, name: v.model.name },
        color: v.color,
        year: v.year,
        arrivedOn: isoDate(v.arrivedOn),
        state: v.state,
        pool: v.pool,
        location: v.location,
        odometerKm: v.odometerKm,
        notes: v.notes,
        costTetri: mayView(req, 'cost.view') ? v.costTetri : null,
        costPreliminary: mayView(req, 'cost.view') && v.costTetri != null && (order?.preliminary ?? false),
        costPaidPercent: mayView(req, 'cost.view') ? order?.paidPercent ?? null : null,
        currentRentalId: v.currentRentalId,
      },
      events: v.events.map((e) => ({
        id: e.id,
        kind: e.kind,
        occurredOn: isoDate(e.occurredOn),
        fromState: e.fromState,
        toState: e.toState,
        fromPool: e.fromPool,
        toPool: e.toPool,
        rentalId: e.rentalId,
        reason: e.reason,
        actor: e.actor?.name ?? null,
      })),
      serviceJobs: v.serviceJobs.map((j) => ({
        id: j.id,
        number: j.number,
        status: j.status,
        payer: j.payer,
        reason: j.reason,
        openedOn: isoDate(j.openedOn),
        closedOn: isoDate(j.closedOn),
        // What a repair cost is the owners' (ADR-0033 §4), on the card as in the repairs.
        // On the company's own repair, with its mechanic's approved work (ADR-0037 §6).
        totalTetri: mayView(req, 'cost.view') ? repairTotalTetri(j) : null,
        withheldTetri: mayView(req, 'cost.view') ? j.withheldTetri : null,
      })),
      rentals: v.rentals.map((r) => ({
        id: r.id,
        number: r.number,
        // As the rentals list calls it — never the stored status (ADR-0017).
        status: rentStateOf(r, today).status,
        customer: r.customer,
        pickedUpOn: isoDate(r.pickedUpOn),
        returnedOn: isoDate(r.returnedOn),
        paidThrough: isoDate(r.paidThrough),
        weeklyRateTetri: r.weeklyRateTetri,
      })),
      // The tracker on it now first, then the ones it had (ADR-0036). The IMEI
      // and the SIM are what is searched for when a moped is stolen: the
      // owners' to read, not a manager's.
      trackers: mayView(req, 'service.manage')
        ? v.trackers.map((t) => ({
            id: t.id,
            imei: t.imei,
            simPhone: t.simPhone,
            installedOn: isoDate(t.installedOn),
            removedOn: isoDate(t.removedOn),
            job: t.serviceJob,
            removedJob: t.removedJob,
          }))
        : null,
      /** What was taken off this moped for another, as a donor (ADR-0036). */
      donated: v.donatedParts.map((p) => ({
        id: p.id,
        name: p.name,
        qty: p.qty,
        on: todayISO(p.createdAt, env.TZ),
        job: { id: p.job.id, number: p.job.number },
        to: { id: p.job.vehicle.id, number: fleetNumber(p.job.vehicle.fleetNo), vin: p.job.vehicle.vin },
      })),
      journal: journal.map((l) => ({
        id: l.id,
        at: l.createdAt.toISOString(),
        occurredOn: isoDate(l.createdAt),
        action: l.action,
        by: l.actor?.name ?? null,
        note: l.note,
        before: l.before,
        after: l.after,
      })),
    };
  });
}

/** EV8 Ops' own stands, and a laptop; any other address in a QR would send people elsewhere. */
const OWN_ORIGIN = /^(https:\/\/(test\.)?ops\.ev8\.ge|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

export function stickerOrigin(given: string | undefined): string {
  return given && OWN_ORIGIN.test(given) ? given : 'https://ops.ev8.ge';
}

function sendPdf(reply: FastifyReply, name: string, bytes: Buffer) {
  return reply
    .header('content-type', 'application/pdf')
    .header('content-length', String(bytes.length))
    .header('x-content-type-options', 'nosniff')
    .header('content-disposition', `inline; filename="${name.replace(/[^\w.\-]+/g, '_')}"`)
    .header('cache-control', 'private, no-store')
    .send(bytes);
}
