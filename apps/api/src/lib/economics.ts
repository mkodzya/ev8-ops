// What each moped earned and cost (DSH-03).
//
// Nothing here is stored. Every figure is added up from the rows that caused
// it — allocations, sale payments, repair lines, events — so a voided payment
// or a corrected repair changes the answer the moment it is saved, and a
// number on this screen can always be walked back to the row it came from.
import { type GoodsEconomicsLine, type VehicleEconomics, type VehicleState, mopedLegs, mopedOnDay, repairTotalTetri, todayISO, vehicleEconomics } from '@ev8/shared';
import { MOPED_ACT, mopedActOf } from './acts.js';
import { isoDate } from './dates.js';
import { prisma } from './db.js';
import { PART_MONEY, WORK_MONEY } from './stock.js';
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

  // A rental is a moped's when the moped was in it at all: its moped now, or
  // one its acts name — a swap gives a rental more than one (ADR-0040).
  const rentals = await prisma.rental.findMany({
    where: { OR: [{ vehicleId: { in: ids } }, { acts: { some: { vehicleId: { in: ids } } } }] },
    select: { id: true, vehicleId: true, acts: { select: MOPED_ACT } },
  });
  const legsOfRental = new Map(rentals.map((r) => [r.id, { legs: mopedLegs(r.acts.map(mopedActOf), r.vehicleId), vehicleId: r.vehicleId }]));
  /**
   * Which moped a week's rent belongs to: the one the rental had on the
   * week's first day. A week a swap fell in is not split by days — the money
   * goes to the moped the week began with (ADR-0040).
   */
  const vehicleOfWeek = (rentalId: string, startsOn: Date): string | null => {
    const r = legsOfRental.get(rentalId);
    if (!r) return null;
    return mopedOnDay(r.legs, isoDate(startsOn)!) ?? r.vehicleId;
  };

  // Rent only. A deposit is the customer's money held, not income, so
  // allocations to deposits are deliberately left out; what is kept back on
  // return arrives as a repair charged to the renter instead.
  const rentAllocations =
    rentals.length === 0
      ? []
      : await prisma.paymentAllocation.findMany({
          where: { target: 'period', period: { rentalId: { in: rentals.map((r) => r.id) } } },
          select: { amountTetri: true, period: { select: { rentalId: true, startsOn: true } } },
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
    select: { vehicleId: true, status: true, payer: true, labourTetri: true, parts: { select: PART_MONEY }, works: { select: WORK_MONEY } },
  });

  const events = await prisma.vehicleEvent.findMany({
    where: { vehicleId: { in: ids } },
    orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
    select: { vehicleId: true, occurredOn: true, toState: true },
  });

  const zero = () => ({ rent: 0, saleIn: 0, saleOut: 0, company: 0, charged: 0 });
  const acc = new Map(ids.map((id) => [id, zero()]));
  for (const a of rentAllocations) {
    const vid = a.period ? vehicleOfWeek(a.period.rentalId, a.period.startsOn) : null;
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
    // The company's own repair carries its mechanic's approved work (ADR-0037 §6).
    const total = repairTotalTetri(j);
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

/**
 * Goods sold over the counter as «Экономика» reads them (issue #11,
 * ADR-0045): every line of every sale, the cancelled included — the shared
 * `goodsEconomics` leaves them out — so the period is applied in one place.
 */
export async function goodsLinesOf(): Promise<GoodsEconomicsLine[]> {
  const lines = await prisma.goodsSaleLine.findMany({
    select: { partId: true, countedItem: true, spec: true, name: true, nameKa: true, qty: true, unitPriceTetri: true, unitCostTetri: true, sale: { select: { id: true, soldOn: true, status: true } } },
  });
  return lines.map((l) => ({
    saleId: l.sale.id,
    soldOn: isoDate(l.sale.soldOn)!,
    status: l.sale.status === 'cancelled' ? 'cancelled' : 'active',
    // A charger by its model: «Зарядка 73V6A» and «Зарядка 60V3A» are two rows.
    key: l.partId ? `part:${l.partId}` : `${l.countedItem}:${(l.spec ?? '').toLowerCase()}`,
    name: l.name,
    qty: l.qty,
    unitPriceTetri: l.unitPriceTetri,
    unitCostTetri: l.unitCostTetri,
  }));
}
