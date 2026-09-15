import { VEHICLE_POOLS, VEHICLE_STATES, type VehiclePool, type VehicleState } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';

// Read side of the fleet (FLT-01, FLT-02). Writes arrive with the hand-over
// and return wizards in step 4 of stage 1; state changes go through events.

export function fleetRoutes(app: FastifyInstance): void {
  app.get('/api/models', { config: { scope: 'fleet.view' } }, async () => {
    const models = await prisma.vehicleModel.findMany({
      where: { archived: false },
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { vehicles: true } } },
    });
    return {
      models: models.map((m) => ({
        id: m.id,
        brand: m.brand,
        name: m.name,
        salePriceTetri: m.salePriceTetri,
        weeklyRateTetri: m.weeklyRateTetri,
        costTetri: m.costTetri,
        forSale: m.forSale,
        forRent: m.forRent,
        photoUrl: m.photoUrl,
        vehicles: m._count.vehicles,
      })),
    };
  });

  app.get('/api/fleet', { config: { scope: 'fleet.view' } }, async () => {
    const vehicles = await prisma.vehicle.findMany({
      where: { archived: false },
      orderBy: [{ state: 'asc' }, { vin: 'asc' }],
      include: {
        model: { select: { brand: true, name: true, weeklyRateTetri: true, salePriceTetri: true } },
        location: { select: { id: true, name: true } },
        // The last thing that happened to this moped. Nothing yet? Then the
        // day it arrived — and for the mopeds Odoo never dated, nothing at
        // all, which the screen shows as a dash and not as a zero.
        events: { select: { occurredOn: true }, orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }], take: 1 },
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
          include: { parts: { select: { qty: true, unitPriceTetri: true } } },
        },
      },
    });
    if (!v) throw notFound('vehicle_not_found', 'No such vehicle.');
    return {
      vehicle: {
        id: v.id,
        vin: v.vin,
        model: { id: v.model.id, brand: v.model.brand, name: v.model.name },
        color: v.color,
        year: v.year,
        arrivedOn: isoDate(v.arrivedOn),
        state: v.state,
        pool: v.pool,
        location: v.location,
        odometerKm: v.odometerKm,
        notes: v.notes,
        costTetri: v.costTetri,
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
        totalTetri: j.labourTetri + j.parts.reduce((n, p) => n + p.qty * p.unitPriceTetri, 0),
        withheldTetri: j.withheldTetri,
      })),
      rentals: v.rentals.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        customer: r.customer,
        pickedUpOn: isoDate(r.pickedUpOn),
        returnedOn: isoDate(r.returnedOn),
        paidThrough: isoDate(r.paidThrough),
        weeklyRateTetri: r.weeklyRateTetri,
      })),
    };
  });
}
