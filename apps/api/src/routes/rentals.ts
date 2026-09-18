import { effectiveRentalStatus, overdueDays, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { isoDate } from '../lib/dates.js';
import { debtsOf } from '../lib/debt.js';
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
        // The phone too: "Whose return?" finds a renter by the digits of it (wave 1 §3.2).
        customer: { select: { id: true, name: true, nameKa: true, nameLat: true, phone: true } },
        vehicle: { select: { id: true, vin: true, model: { select: { brand: true, name: true } } } },
        deposit: { select: { amountTetri: true, status: true } },
        // What is owed, from the periods that were not paid — the list shows
        // the debt beside the status (U5) and must not invent a second rule.
        periods: { where: { payStatus: { not: 'paid' } }, select: { amountTetri: true, paidTetri: true } },
        _count: { select: { periods: true } },
      },
    });
    // A rental's debt is its part of its customer's one figure: its unpaid weeks and deposit.
    const debts = await debtsOf(rentals.map((r) => r.customerId));
    const debtOfRental = (customerId: string, rentalId: string) =>
      (debts.get(customerId)?.parts ?? []).filter((p) => p.id === rentalId && (p.kind === 'rent' || p.kind === 'deposit')).reduce((n, p) => n + p.owesTetri, 0);
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
          debtTetri: debtOfRental(r.customerId, r.id),
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
        payments: { where: { voidedAt: null }, orderBy: { occurredOn: 'asc' }, select: { id: true, occurredOn: true, channel: true, grossTetri: true, feeTetri: true } },
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
        nightParkingAddress: r.nightParkingAddress,
        batteries: r.batteries,
        chargers: r.chargers,
        notes: r.notes,
      },
      deposit: r.deposit
        ? {
            amountTetri: r.deposit.amountTetri,
            paidTetri: r.deposit.paidTetri,
            status: r.deposit.status,
            returnedTetri: r.deposit.returnedTetri,
            withheldTetri: r.deposit.withheldTetri,
            withheldReason: r.deposit.withheldReason,
            withheldGrounds: r.deposit.withheldGrounds,
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
      payments: r.payments.map((p) => ({
        id: p.id,
        occurredOn: isoDate(p.occurredOn),
        channel: p.channel,
        grossTetri: p.grossTetri,
        feeTetri: p.feeTetri,
      })),
      acts: r.acts.map((a) => ({
        id: a.id,
        kind: a.kind,
        occurredOn: isoDate(a.occurredOn),
        odometerKm: a.odometerKm,
        condition: a.condition,
        items: a.items,
        photos: a.photos.map((p) => ({ id: p.id, label: p.label, sizeBytes: p.sizeBytes })),
        pdfUrl: a.pdfUrl,
      })),
    };
  });
}
