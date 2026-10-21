import { dayStart, fleetNumber, maintenanceDue, nextMaintenance, type MaintenanceState, type MileageReading } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { serviceSettings } from './serviceSettings.js';

// The planned maintenance of the fleet (stage 6; ADR-0038 §1–3), read from the
// mileage EV8 Ops recorded at every read — nothing about it is stored.
//
// A reading counts only when EV8 Ops wrote it down with its moment: a pickup
// act, a return act that was not taken back, the opening of a repair and the
// closing of a finished one. The figure a moped's card carries from Odoo or
// from the static copy, with no such reading behind it, is not one (§1): a
// moped with none is not on «Пора на ТО», and its card says so.

type Db = Prisma.TransactionClient;

/** Where the latest reading was written. */
export type ReadingSource = 'pickup' | 'return' | 'repair_open' | 'repair_close';

export interface VehicleMaintenance {
  vehicleId: string;
  /** EV-007, or none for a moped not numbered yet. */
  number: string | null;
  model: string;
  vin: string;
  state: MaintenanceState;
  currentKm: number | null;
  currentAt: string | null;
  readingSource: ReadingSource | null;
  dueKm: number | null;
  leftKm: number | null;
  /** The closed planned repair the mark is counted from; none — the first mark. */
  lastPlanned: { jobId: string; number: string; km: number; closedOn: string | null } | null;
  /** A planned repair waiting or in work now: the maintenance is under way. */
  openPlanned: { jobId: string; number: string; status: string } | null;
}

export interface MaintenanceOverview {
  intervalKm: number;
  warnKm: number;
  /** «Пора на ТО»: less than the warning left or past the mark, the most urgent first. */
  due: VehicleMaintenance[];
  /** Mopeds in the fleet with no mileage recorded in EV8 Ops: no maintenance for them (§1). */
  unknownCount: number;
  knownCount: number;
}

type Reading = MileageReading & { source: ReadingSource };

const ms = (at: Date | string): number => (typeof at === 'string' ? Date.parse(at) : at.getTime());

/**
 * Every moped still in the fleet — not archived, not sold, not gone — with
 * its next maintenance. A handful of queries for the whole fleet, one after
 * another (inside a transaction they share one connection).
 */
export async function maintenanceOf(db: Db = prisma, opts: { vehicleIds?: string[] } = {}): Promise<VehicleMaintenance[]> {
  const settings = await serviceSettings(db);
  const vehicles = await db.vehicle.findMany({
    where: { archived: false, state: { notIn: ['sold', 'out'] }, ...(opts.vehicleIds ? { id: { in: opts.vehicleIds } } : {}) },
    orderBy: [{ fleetNo: { sort: 'asc', nulls: 'last' } }, { vin: 'asc' }],
    select: { id: true, vin: true, fleetNo: true, model: { select: { brand: true, name: true } } },
  });
  if (vehicles.length === 0) return [];
  const ids = vehicles.map((v) => v.id);
  const acts = await db.act.findMany({
    where: { odometerKm: { not: null }, kind: { in: ['pickup', 'return'] }, rental: { vehicleId: { in: ids } } },
    select: { kind: true, odometerKm: true, createdAt: true, settlement: true, rental: { select: { vehicleId: true } } },
  });
  const jobs = await db.serviceJob.findMany({
    where: {
      vehicleId: { in: ids },
      OR: [{ openedOdometerKm: { not: null } }, { status: 'done', odometerKm: { not: null } }, { reasonKind: 'planned', status: { in: ['open', 'draft'] } }],
    },
    select: {
      id: true,
      number: true,
      vehicleId: true,
      status: true,
      reasonKind: true,
      openedOdometerKm: true,
      odometerKm: true,
      openedAt: true,
      createdAt: true,
      closedAt: true,
      closedOn: true,
    },
  });

  const readings = new Map<string, Reading[]>();
  const add = (vehicleId: string, r: Reading) => readings.set(vehicleId, [...(readings.get(vehicleId) ?? []), r]);
  for (const a of acts) {
    if (!a.rental.vehicleId || a.odometerKm == null) continue;
    // A return taken back is not a reading: the rental ran on (B5-08).
    if (a.kind === 'return' && (a.settlement as { undone?: boolean } | null)?.undone) continue;
    add(a.rental.vehicleId, { km: a.odometerKm, at: a.createdAt, source: a.kind === 'pickup' ? 'pickup' : 'return' });
  }
  // A repair closed before stage 3 has only its day: the reading counts from that day's start.
  const closedAt = (j: (typeof jobs)[number]): Date | null => j.closedAt ?? (j.closedOn ? dayStart(isoDate(j.closedOn)!, env.TZ) : null);
  for (const j of jobs) {
    if (j.openedOdometerKm != null) add(j.vehicleId, { km: j.openedOdometerKm, at: j.openedAt ?? j.createdAt, source: 'repair_open' });
    const at = closedAt(j);
    if (j.status === 'done' && j.odometerKm != null && at) add(j.vehicleId, { km: j.odometerKm, at, source: 'repair_close' });
  }

  return vehicles.map((v) => {
    const own = readings.get(v.id) ?? [];
    // The latest closed planned repair; a refused or called-off one never counts (ADR-0038 §2).
    const planned = jobs
      .filter((j) => j.vehicleId === v.id && j.status === 'done' && j.reasonKind === 'planned' && (j.odometerKm ?? j.openedOdometerKm) != null)
      .sort((a, b) => (closedAt(b)?.getTime() ?? 0) - (closedAt(a)?.getTime() ?? 0) || b.number.localeCompare(a.number))[0];
    const open = jobs
      .filter((j) => j.vehicleId === v.id && j.reasonKind === 'planned' && (j.status === 'open' || j.status === 'draft'))
      .sort((a, b) => ms(b.openedAt ?? b.createdAt) - ms(a.openedAt ?? a.createdAt))[0];
    const lastPlannedKm = planned ? (planned.odometerKm ?? planned.openedOdometerKm)! : null;
    const m = nextMaintenance({ readings: own, lastPlannedKm, intervalKm: settings.maintenanceIntervalKm, warnKm: settings.maintenanceWarnKm });
    const current = m.currentAt == null ? undefined : own.find((r) => r.km === m.currentKm && ms(r.at) === ms(m.currentAt!));
    return {
      vehicleId: v.id,
      number: fleetNumber(v.fleetNo),
      model: `${v.model.brand} ${v.model.name}`,
      vin: v.vin,
      state: m.state,
      currentKm: m.currentKm,
      currentAt: m.currentAt,
      readingSource: current?.source ?? null,
      dueKm: m.dueKm,
      leftKm: m.leftKm,
      lastPlanned: planned ? { jobId: planned.id, number: planned.number, km: lastPlannedKm!, closedOn: isoDate(planned.closedOn) } : null,
      openPlanned: open ? { jobId: open.id, number: open.number, status: open.status } : null,
    };
  });
}

/**
 * «Пора на ТО» for the fleet (ADR-0038 §3): what the repairs screen asks, and
 * what «Сегодня» will ask once its screen is chosen.
 */
export async function maintenanceOverview(db: Db = prisma): Promise<MaintenanceOverview> {
  const settings = await serviceSettings(db);
  const all = await maintenanceOf(db);
  const known = all.filter((m) => m.state !== 'unknown');
  return {
    intervalKm: settings.maintenanceIntervalKm,
    warnKm: settings.maintenanceWarnKm,
    due: known.filter((m) => maintenanceDue(m.state)).sort((a, b) => a.leftKm! - b.leftKm! || (a.number ?? a.vin).localeCompare(b.number ?? b.vin)),
    unknownCount: all.length - known.length,
    knownCount: known.length,
  };
}
