import { fleetUtilisation, utilisationByModel, type Utilisation, type UtilisationVehicle } from '@ev8/shared';
import { isoDate } from './dates.js';
import { prisma } from './db.js';

// The data side of M-10 (wave 6 §3.2). The arithmetic lives in
// `packages/shared/src/utilisation.ts` so the screen, the week's report and
// a moped's own card all answer with the same function; here we only gather
// what it needs.
//
// A moped's park before its first park event is the awkward part. An event
// that moved it carries where it came from, so the earliest of those is the
// truth for everything before it; a moped that never moved has been in the
// park it is in now since the day it arrived.

export interface UtilisationAnswer extends Utilisation {
  from: string;
  to: string;
  byModel: { modelId: string; model: string; rentedDays: number; poolDays: number; percent: number | null }[];
}

export async function utilisationOf(from: string, to: string): Promise<UtilisationAnswer> {
  const vehicles = await prisma.vehicle.findMany({
    where: { archived: false },
    select: {
      id: true,
      modelId: true,
      pool: true,
      model: { select: { brand: true, name: true } },
      events: {
        orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
        select: { occurredOn: true, toState: true, toPool: true, fromPool: true },
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
      events: v.events.map((e) => ({
        occurredOn: isoDate(e.occurredOn) as string,
        toState: e.toState as UtilisationVehicle['events'][number]['toState'],
        toPool: e.toPool as UtilisationVehicle['events'][number]['toPool'],
      })),
    };
  });

  const u = fleetUtilisation({ vehicles: input, from, to });
  const names = new Map(vehicles.map((v) => [v.modelId, `${v.model.brand} ${v.model.name}`]));
  return {
    ...u,
    from,
    to,
    byModel: utilisationByModel(u)
      .map((m) => ({ ...m, model: names.get(m.modelId) ?? '' }))
      .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || a.model.localeCompare(b.model)),
  };
}
