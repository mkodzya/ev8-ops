// M-10 — how busy the rental fleet was (wave 6 §3.2, B10-01).
//
// The question is the one the finance plan calls the round's main risk: of
// the mopeds we keep for renting, how much of the time were they actually
// out? So the denominator is not "mopeds we own" but "days a moped stood in
// the rental park" — free and in service included, because that is exactly
// the idle capacity the figure exists to show. The numerator is the days it
// was both in that park and out with somebody.
//
// Three rules the designer settled (21.09.2026):
//
//   * a moped moved between parks mid-period counts its days on the side it
//     was on that day, not by where it ended up;
//   * a moped no park has claimed is in neither figure — and is counted
//     separately, so a percentage built on three quarters of the fleet says
//     so out loud rather than lying quietly;
//   * sold and written off stop counting the day they go.
//
// Everything is worked out from the moped's own events, like the economics
// beside it: the fleet table knows where a VIN is now, only the events know
// where it was on the ninth.
import { addDays, daysBetween } from './time.js';
import type { ISODate, VehiclePool, VehicleState } from './types.js';

/** A moped leaves the count on these: they are not idle capacity, they are gone. */
const GONE: readonly VehicleState[] = ['sold', 'out'];

export interface UtilisationVehicle {
  id: string;
  /** For grouping: the model this VIN belongs to. */
  modelId?: string | null;
  /**
   * The park it was in before its first park event — or, when it has none,
   * the park it is in now. A moped has a park from the day it arrives.
   */
  initialPool: VehiclePool | null;
  events: { occurredOn: ISODate; toState?: VehicleState | null; toPool?: VehiclePool | null }[];
}

export interface UtilisationRow {
  id: string;
  modelId: string | null;
  /** Days both in the rental park and out with somebody. */
  rentedDays: number;
  /** Days in the rental park at all — the idle ones included. */
  poolDays: number;
}

export interface Utilisation {
  rentedDays: number;
  poolDays: number;
  /** Whole per cent, or null when no moped stood in the park at all. */
  percent: number | null;
  /** Mopeds no park has claimed: in neither figure (§3.2). */
  unassigned: number;
  rows: UtilisationRow[];
}

/** The last value an event set on or before `day`, or the fallback. */
function at<T>(
  events: { occurredOn: ISODate; value: T | null | undefined }[],
  day: ISODate,
  fallback: T | null,
): T | null {
  let out = fallback;
  for (const e of events) {
    if (e.occurredOn > day) break;
    if (e.value != null) out = e.value;
  }
  return out;
}

/**
 * Utilisation over `from`…`to`, both days included.
 *
 * A moped whose first event falls inside the period counts only from that
 * day: before it arrived it was not capacity anybody could have rented out.
 */
export function fleetUtilisation(input: { vehicles: readonly UtilisationVehicle[]; from: ISODate; to: ISODate }): Utilisation {
  const rows: UtilisationRow[] = [];
  let unassigned = 0;

  for (const v of input.vehicles) {
    const sorted = [...v.events].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
    const states = sorted.map((e) => ({ occurredOn: e.occurredOn, value: e.toState }));
    const pools = sorted.map((e) => ({ occurredOn: e.occurredOn, value: e.toPool }));
    const born = sorted.find((e) => e.toState != null)?.occurredOn ?? null;

    let rentedDays = 0;
    let poolDays = 0;
    let everInPark = false;
    let everOutsideAPark = false;

    for (let day = input.from; day <= input.to; day = addDays(day, 1)) {
      // Before its first event the moped did not exist for us.
      if (born == null || day < born) continue;
      const state = at(states, day, null);
      if (state == null || GONE.includes(state)) continue;
      const pool = at(pools, day, v.initialPool);
      if (pool !== 'rent') {
        if (pool == null) everOutsideAPark = true;
        continue;
      }
      everInPark = true;
      poolDays++;
      if (state === 'rented') rentedDays++;
    }

    if (everOutsideAPark && !everInPark) unassigned++;
    if (poolDays > 0) rows.push({ id: v.id, modelId: v.modelId ?? null, rentedDays, poolDays });
  }

  const rentedDays = rows.reduce((n, r) => n + r.rentedDays, 0);
  const poolDays = rows.reduce((n, r) => n + r.poolDays, 0);
  return {
    rentedDays,
    poolDays,
    percent: poolDays === 0 ? null : Math.round((rentedDays / poolDays) * 100),
    unassigned,
    rows,
  };
}

/** The same figure per model, for the "по моделям" cut (§3.2). */
export function utilisationByModel(u: Utilisation): { modelId: string; rentedDays: number; poolDays: number; percent: number | null }[] {
  const by = new Map<string, { rentedDays: number; poolDays: number }>();
  for (const r of u.rows) {
    if (r.modelId == null) continue;
    const acc = by.get(r.modelId) ?? { rentedDays: 0, poolDays: 0 };
    acc.rentedDays += r.rentedDays;
    acc.poolDays += r.poolDays;
    by.set(r.modelId, acc);
  }
  return [...by].map(([modelId, a]) => ({
    modelId,
    ...a,
    percent: a.poolDays === 0 ? null : Math.round((a.rentedDays / a.poolDays) * 100),
  }));
}

/** Days in a period, both ends included — for a screen that shows the basis. */
export const periodDays = (from: ISODate, to: ISODate): number => Math.max(0, daysBetween(from, to) + 1);
