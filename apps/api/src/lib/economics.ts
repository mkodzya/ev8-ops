// What each moped earned and cost (DSH-03).
//
// Nothing here is stored. Every figure is added up from the rows that caused
// it — allocations, sale payments, repair lines, events — so a voided payment
// or a corrected repair changes the answer the moment it is saved, and a
// number on this screen can always be walked back to the row it came from.
import { type VehicleEconomics, type VehicleState, todayISO, vehicleEconomics } from '@ev8/shared';
import { isoDate } from './dates.js';
import { prisma } from './db.js';
import { preliminaryOf } from './purchases.js';

export interface VehicleRow extends VehicleEconomics {
  id: string;
  vin: string;
  model: string;
  state: VehicleState;
  arrivedOn: string | null;
  /** The shipment is not settled yet, so the cost is still moving (§7). */
  costPreliminary: boolean;
  /** What share of that invoice is paid, the figure the note quotes. */
  costPaidPercent: number | null;
}

/** Money and days for every live moped, or just the ones asked for. */
export async function fleetEconomics(opts: { vehicleIds?: string[]; until?: string } = {}): Promise<VehicleRow[]> {
  const until = opts.until ?? todayISO();
  const where = opts.vehicleIds ? { id: { in: opts.vehicleIds } } : { archived: false };
  const vehicles = await prisma.vehicle.findMany({
    where,
    orderBy: [{ vin: 'asc' }],
    include: { model: { select: { brand: true, name: true } } },
  });
  const ids = vehicles.map((v) => v.id);
  if (ids.length === 0) return [];

  const rentals = await prisma.rental.findMany({ where: { vehicleId: { in: ids } }, select: { id: true, vehicleId: true } });
  const vehicleOfRental = new Map(rentals.map((r) => [r.id, r.vehicleId as string]));

  // Rent only. A deposit is the customer's money held, not income, so
  // allocations to deposits are deliberately left out; what is kept back on
  // return arrives as a repair charged to the renter instead.
  const rentAllocations =
    rentals.length === 0
      ? []
      : await prisma.paymentAllocation.findMany({
          where: { target: 'period', period: { rentalId: { in: rentals.map((r) => r.id) } } },
          select: { amountTetri: true, period: { select: { rentalId: true } } },
        });

  const sales = await prisma.sale.findMany({
    where: { vehicleId: { in: ids }, status: { not: 'cancelled' } },
    select: {
      vehicleId: true,
      payments: { where: { voidedAt: null }, select: { direction: true, grossTetri: true } },
    },
  });

  const jobs = await prisma.serviceJob.findMany({
    where: { vehicleId: { in: ids }, status: { not: 'cancelled' } },
    select: { vehicleId: true, payer: true, labourTetri: true, parts: { select: { qty: true, unitPriceTetri: true } } },
  });

  const events = await prisma.vehicleEvent.findMany({
    where: { vehicleId: { in: ids } },
    orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
    select: { vehicleId: true, occurredOn: true, toState: true },
  });

  const zero = () => ({ rent: 0, saleIn: 0, saleOut: 0, company: 0, charged: 0 });
  const acc = new Map(ids.map((id) => [id, zero()]));
  for (const a of rentAllocations) {
    const vid = a.period ? vehicleOfRental.get(a.period.rentalId) : undefined;
    if (vid) (acc.get(vid) ?? zero()).rent += a.amountTetri;
  }
  for (const s of sales) {
    const bucket = s.vehicleId ? acc.get(s.vehicleId) : undefined;
    if (!bucket) continue;
    for (const p of s.payments) {
      if (p.direction === 'out') bucket.saleOut += p.grossTetri;
      else bucket.saleIn += p.grossTetri;
    }
  }
  for (const j of jobs) {
    const bucket = acc.get(j.vehicleId);
    if (!bucket) continue;
    const total = j.labourTetri + j.parts.reduce((n, p) => n + p.qty * p.unitPriceTetri, 0);
    if (j.payer === 'customer') bucket.charged += total;
    else bucket.company += total;
  }
  const eventsOf = new Map<string, { occurredOn: string; toState: VehicleState }[]>();
  for (const e of events) {
    const list = eventsOf.get(e.vehicleId) ?? [];
    list.push({ occurredOn: isoDate(e.occurredOn) as string, toState: e.toState as VehicleState });
    eventsOf.set(e.vehicleId, list);
  }

  // A cost worked out at 17 % of an invoice is not the cost; the screens
  // that quote it say so (§7, QA-W5-11).
  const preliminary = await preliminaryOf(vehicles.map((v) => v.purchaseId).filter((id): id is string => !!id));

  return vehicles.map((v) => {
    const a = acc.get(v.id) ?? zero();
    const order = v.purchaseId ? preliminary.get(v.purchaseId) ?? null : null;
    return {
      id: v.id,
      vin: v.vin,
      model: `${v.model.brand} ${v.model.name}`,
      state: v.state as VehicleState,
      arrivedOn: isoDate(v.arrivedOn),
      costPreliminary: v.costTetri != null && (order?.preliminary ?? false),
      costPaidPercent: order?.paidPercent ?? null,
      ...vehicleEconomics({
        costTetri: v.costTetri,
        rentalRevenueTetri: a.rent,
        saleRevenueTetri: a.saleIn,
        buyBackTetri: a.saleOut,
        serviceCompanyTetri: a.company,
        serviceChargedTetri: a.charged,
        events: eventsOf.get(v.id) ?? [],
        until,
      }),
    };
  });
}
