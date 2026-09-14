import { effectiveRentalStatus, overdueDays, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { notFound } from '../lib/errors.js';

// Rentals, read side (RNT-03 overdue as a signal, RNT-06 the no-VIN list).

export function rentalRoutes(app: FastifyInstance): void {
  app.get('/api/rentals', { config: { scope: 'fleet.view' } }, async () => {
    const today = todayISO(new Date(), env.TZ);
    const rentals = await prisma.rental.findMany({
      orderBy: [{ status: 'asc' }, { pickedUpOn: 'desc' }],
      include: {
        customer: { select: { id: true, name: true } },
        vehicle: { select: { id: true, vin: true, model: { select: { brand: true, name: true } } } },
        deposit: { select: { amountTetri: true, status: true } },
        _count: { select: { periods: true } },
      },
    });
    return {
      today,
      rentals: rentals.map((r) => {
        const pickedUpOn = isoDate(r.pickedUpOn);
        const paidThrough = isoDate(r.paidThrough);
        const status = effectiveRentalStatus(r.status, paidThrough, pickedUpOn, today);
        return {
          id: r.id,
          number: r.number,
          odooName: r.odooName,
          status,
          customer: r.customer,
          vehicle: r.vehicle ? { id: r.vehicle.id, vin: r.vehicle.vin, model: `${r.vehicle.model.brand} ${r.vehicle.model.name}` } : null,
          vinUnconfirmed: r.vinUnconfirmed,
          vinNote: r.vinNote,
          weeklyRateTetri: r.weeklyRateTetri,
          depositTetri: r.depositTetri,
          deposit: r.deposit,
          pickedUpOn,
          expectedReturnOn: isoDate(r.expectedReturnOn),
          returnedOn: isoDate(r.returnedOn),
          paidThrough,
          overdueDays: status === 'overdue' && pickedUpOn ? overdueDays(paidThrough, pickedUpOn, today) : 0,
          periods: r._count.periods,
          buyoutTargetTetri: r.buyoutTargetTetri,
          buyoutPerPaymentTetri: r.buyoutPerPaymentTetri,
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>('/api/rentals/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const r = await prisma.rental.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        vehicle: { include: { model: true } },
        deposit: true,
        periods: { orderBy: { seq: 'asc' } },
        acts: { orderBy: { occurredOn: 'asc' }, include: { photos: { where: { archived: false }, select: { id: true, label: true, sizeBytes: true }, orderBy: { createdAt: 'asc' } } } },
      },
    });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    const today = todayISO(new Date(), env.TZ);
    const pickedUpOn = isoDate(r.pickedUpOn);
    const paidThrough = isoDate(r.paidThrough);
    return {
      rental: {
        id: r.id,
        number: r.number,
        odooName: r.odooName,
        status: effectiveRentalStatus(r.status, paidThrough, pickedUpOn, today),
        storedStatus: r.status,
        customer: { id: r.customer.id, name: r.customer.name, phone: r.customer.phone },
        vehicle: r.vehicle ? { id: r.vehicle.id, vin: r.vehicle.vin, model: `${r.vehicle.model.brand} ${r.vehicle.model.name}` } : null,
        vinUnconfirmed: r.vinUnconfirmed,
        vinNote: r.vinNote,
        weeklyRateTetri: r.weeklyRateTetri,
        depositTetri: r.depositTetri,
        pickedUpOn,
        expectedReturnOn: isoDate(r.expectedReturnOn),
        returnedOn: isoDate(r.returnedOn),
        paidThrough,
        buyoutTargetTetri: r.buyoutTargetTetri,
        buyoutPerPaymentTetri: r.buyoutPerPaymentTetri,
        notes: r.notes,
      },
      deposit: r.deposit
        ? {
            amountTetri: r.deposit.amountTetri,
            status: r.deposit.status,
            returnedTetri: r.deposit.returnedTetri,
            withheldTetri: r.deposit.withheldTetri,
            withheldReason: r.deposit.withheldReason,
            returnedTo: r.deposit.returnedTo,
            returnedOn: isoDate(r.deposit.returnedOn),
            confirmed: r.deposit.status === 'held' ? null : r.deposit.confirmedById != null,
          }
        : null,
      periods: r.periods.map((p) => ({
        seq: p.seq,
        startsOn: isoDate(p.startsOn),
        endsOn: isoDate(p.endsOn),
        amountTetri: p.amountTetri,
        paidTetri: p.paidTetri,
        payStatus: p.payStatus,
      })),
      acts: r.acts.map((a) => ({
        id: a.id,
        kind: a.kind,
        occurredOn: isoDate(a.occurredOn),
        odometerKm: a.odometerKm,
        condition: a.condition,
        photos: a.photos.map((p) => ({ id: p.id, label: p.label, sizeBytes: p.sizeBytes })),
        pdfUrl: a.pdfUrl,
      })),
    };
  });
}
