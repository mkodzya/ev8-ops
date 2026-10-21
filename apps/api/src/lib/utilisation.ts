import {
  fleetBlockers,
  fleetUtilisation,
  todayISO,
  utilisationByModel,
  utilisationModelVehicles,
  type BlockerRow,
  type Utilisation,
  type UtilisationVehicle,
} from '@ev8/shared';
import { isoDate } from './dates.js';
import { prisma } from './db.js';
import { periodDowntime } from './downtime.js';
import { env } from './env.js';

// The data side of M-10 (wave 6 §3.2). The arithmetic lives in
// `packages/shared/src/utilisation.ts` so the screen, the week's report and
// a moped's own card all answer with the same function; here we only gather
// what it needs.
//
// A moped's park before its first park event is the awkward part. An event
// that moved it carries where it came from, so the earliest of those is the
// truth for everything before it; a moped that never moved has been in the
// park it is in now since the day it arrived.

/** A moped on the "что мешает" list, named so the screen can show it. */
export interface BlockerVehicle extends BlockerRow {
  vin: string;
  model: string;
}

export interface UtilisationAnswer extends Utilisation {
  from: string;
  to: string;
  /** Mopeds that stood in the rental park at all over the period. */
  vehicles: number;
  byModel: { modelId: string; model: string; vehicles: number; rentedDays: number; poolDays: number; percent: number | null }[];
  /**
   * What kept the figure down (§3.2). `batteriesHolding` is null, not 0:
   * nothing in the data ties a repair to a missing battery.
   */
  blockers: { inRepairAllPeriod: BlockerVehicle[]; freeTooLong: BlockerVehicle[]; batteriesHolding: null };
  /**
   * Hours in repair over the period by Tbilisi days, in minutes, and of them
   * the wait for approval (ADR-0038 §5) — beside the blockers, not one of
   * them: those count days from events, this counts the repairs' minutes.
   */
  repairs: { minutes: number; waitMinutes: number; counted: number; unknown: number };
}

/**
 * Every moped with the events it needs, in the shape the arithmetic takes.
 * The week's report reads the same rows for its own fleet counts, so the two
 * screens can never disagree about where a VIN stood on Tuesday.
 */
export async function utilisationVehicles(): Promise<{ input: UtilisationVehicle[]; names: Map<string, string>; vins: Map<string, string> }> {
  const vehicles = await prisma.vehicle.findMany({
    where: { archived: false },
    select: {
      id: true,
      vin: true,
      modelId: true,
      pool: true,
      model: { select: { brand: true, name: true } },
      events: {
        orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
        select: { occurredOn: true, toState: true, toPool: true, fromPool: true },
      },
      // A sale carried over from Odoo has no event of its own: the deal was
      // written straight into `sales`, and the moped went on counting as
      // idle capacity for months (QA-W6-06). The day it was sold is known,
      // so the sale itself stands in for the event that never happened.
      sales: {
        where: { status: { not: 'cancelled' } },
        orderBy: { soldOn: 'asc' },
        select: { soldOn: true, boughtBackOn: true },
      },
    },
  });

  const input: UtilisationVehicle[] = vehicles.map((v) => {
    const firstMove = v.events.find((e) => e.toPool != null && e.fromPool != null);
    return {
      id: v.id,
      modelId: v.modelId,
      // Where it was before anything moved it: the first move remembers, and
      // a moped that never moved is where it is now.
      initialPool: (firstMove?.fromPool ?? v.pool) as UtilisationVehicle['initialPool'],
      events: [
        ...v.events.map((e) => ({
          occurredOn: isoDate(e.occurredOn) as string,
          toState: e.toState as UtilisationVehicle['events'][number]['toState'],
          toPool: e.toPool as UtilisationVehicle['events'][number]['toPool'],
        })),
        // Sold on a day nobody wrote an event for. A buy-back that did leave
        // one wins by being later, because the arithmetic reads the last
        // word about each day.
        ...v.sales.flatMap((sale) => {
          const day = isoDate(sale.soldOn);
          if (!day) return [];
          const back = isoDate(sale.boughtBackOn);
          return [
            { occurredOn: day, toState: 'sold' as const, toPool: null },
            ...(back ? [{ occurredOn: back, toState: 'available' as const, toPool: null }] : []),
          ];
        }),
      ].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn)),
    };
  });

  return {
    input,
    names: new Map(vehicles.map((v) => [v.modelId, `${v.model.brand} ${v.model.name}`])),
    vins: new Map(vehicles.map((v) => [v.id, v.vin])),
  };
}

export async function utilisationOf(from: string, to: string): Promise<UtilisationAnswer> {
  const [{ input, names, vins }, repairs] = await Promise.all([utilisationVehicles(), periodDowntime(from, to)]);
  const u = fleetUtilisation({ vehicles: input, from, to });
  const perModel = utilisationModelVehicles(u);
  const blockers = fleetBlockers({ vehicles: input, from, to });
  const named = (rows: BlockerRow[]): BlockerVehicle[] =>
    rows.map((r) => ({ ...r, vin: vins.get(r.id) ?? '', model: r.modelId == null ? '' : names.get(r.modelId) ?? '' }));

  return {
    ...u,
    from,
    to,
    vehicles: u.rows.length,
    byModel: utilisationByModel(u)
      .map((m) => ({ ...m, model: names.get(m.modelId) ?? '', vehicles: perModel.get(m.modelId) ?? 0 }))
      .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || a.model.localeCompare(b.model)),
    blockers: {
      inRepairAllPeriod: named(blockers.inRepairAllPeriod),
      freeTooLong: named(blockers.freeTooLong),
      batteriesHolding: blockers.batteriesHolding,
    },
    repairs,
  };
}

/**
 * M-10 for each moped over its whole life, for "Экономика" (§3.3). The same
 * function as the screen's — a moped's card and the report cannot disagree
 * about how busy it was. The period starts at the earliest event there is,
 * because "за всё время" is exactly that.
 */
export async function lifetimeUtilisation(): Promise<Map<string, { percent: number | null; rentedDays: number; poolDays: number }>> {
  const { input } = await utilisationVehicles();
  const days = input.flatMap((v) => v.events.map((e) => e.occurredOn)).sort();
  const to = todayISO(new Date(), env.TZ);
  const from = days[0] ?? to;
  // A moped whose only event is dated ahead of today still gets a period of one day.
  const u = fleetUtilisation({ vehicles: input, from, to: from > to ? from : to });
  return new Map(
    u.rows.map((r) => [
      r.id,
      { percent: r.poolDays === 0 ? null : Math.round((r.rentedDays / r.poolDays) * 100), rentedDays: r.rentedDays, poolDays: r.poolDays },
    ]),
  );
}
