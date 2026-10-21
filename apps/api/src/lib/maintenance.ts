import { dayStart, fleetNumber, latestReading, maintenanceDue, nextMaintenance, type MaintenanceState, type MileageReading } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { serviceSettings } from './serviceSettings.js';

// The planned maintenance of the fleet (stage 6; ADR-0038 §1–3), read from the
// mileage EV8 Ops recorded at every read — nothing about it is stored.
//
// A reading counts only when EV8 Ops wrote it down with its moment: a pickup
// act, a return act that was not taken back, the two acts of a swap (each of
// its own moped, ADR-0040), the opening of a repair that was not called off
// by mistake and the closing of a finished one. The figure a
// moped's card carries from Odoo or from the static copy, with no such reading
// behind it, is not one (§1): a moped with none is not on «Пора на ТО», and
// its card says so.

type Db = Prisma.TransactionClient;

/**
 * Where the latest reading was written. A swap's two acts read as what they
 * are for the moped: the one handed out — a hand-over, the one given back —
 * a return (ADR-0040).
 */
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
 * Every reading EV8 Ops recorded for these mopeds, and the repairs read for
 * them (with the planned ones still open, which carry no reading of their
 * own). Three queries, whatever the number of mopeds.
 */
async function readingsOf(db: Db, ids: string[]) {
  // An act's reading is its own moped's (migration 0063): after a swap the
  // rental's moped is another, and the old one's mileage is not the new one's.
  // An act that names no moped is its rental's, as every act was before.
  const acts = await db.act.findMany({
    where: {
      odometerKm: { not: null },
      kind: { in: ['pickup', 'return', 'swap_out', 'swap_in'] },
      OR: [{ vehicleId: { in: ids } }, { vehicleId: null, rental: { vehicleId: { in: ids } } }],
    },
    select: { kind: true, odometerKm: true, createdAt: true, settlement: true, vehicleId: true, rental: { select: { vehicleId: true } } },
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
      rejectedAt: true,
      closedAt: true,
      closedOn: true,
    },
  });
  // A repair taken over gets the taker's reading, written then — not when the
  // repair was first opened, maybe days and a return earlier (stage 6).
  const read = jobs.filter((j) => j.openedOdometerKm != null).map((j) => j.id);
  const takes = read.length
    ? await db.auditLog.findMany({ where: { entityType: 'service_job', action: 'service.take', entityId: { in: read } }, select: { entityId: true, createdAt: true } })
    : [];
  const takenAt = new Map<string, Date>();
  for (const t of takes) {
    const was = t.entityId ? takenAt.get(t.entityId) : undefined;
    if (t.entityId && (!was || t.createdAt > was)) takenAt.set(t.entityId, t.createdAt);
  }

  const readings = new Map<string, Reading[]>();
  const add = (vehicleId: string, r: Reading) => readings.set(vehicleId, [...(readings.get(vehicleId) ?? []), r]);
  for (const a of acts) {
    const vehicleId = a.vehicleId ?? a.rental.vehicleId;
    if (!vehicleId || a.odometerKm == null) continue;
    // A return taken back is not a reading: the rental ran on (B5-08).
    if (a.kind === 'return' && (a.settlement as { undone?: boolean } | null)?.undone) continue;
    add(vehicleId, { km: a.odometerKm, at: a.createdAt, source: a.kind === 'pickup' || a.kind === 'swap_in' ? 'pickup' : 'return' });
  }
  for (const j of jobs) {
    // Called off by mistake — cancelled, not refused — it is not a reading
    // either: it may have been typed off another moped (§1, as §5 leaves such
    // a repair out of the downtime). A refused one was read on this moped.
    const mistake = j.status === 'cancelled' && j.rejectedAt == null;
    if (j.openedOdometerKm != null && !mistake) add(j.vehicleId, { km: j.openedOdometerKm, at: takenAt.get(j.id) ?? j.openedAt ?? j.createdAt, source: 'repair_open' });
    const at = closedAt(j);
    if (j.status === 'done' && j.odometerKm != null && at) add(j.vehicleId, { km: j.odometerKm, at, source: 'repair_close' });
  }
  return { readings, jobs };
}

// A repair closed before stage 3 has only its day: the reading counts from that day's start.
const closedAt = (j: { closedAt: Date | null; closedOn: Date | null }): Date | null => j.closedAt ?? (j.closedOn ? dayStart(isoDate(j.closedOn)!, env.TZ) : null);

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
  const { readings, jobs } = await readingsOf(db, vehicles.map((v) => v.id));

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
    const current = latestReading(own);
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

/** The moped's latest reading EV8 Ops recorded, whatever its state; none — none (§1). */
export async function latestReadingKm(db: Db, vehicleId: string): Promise<number | null> {
  const { readings } = await readingsOf(db, [vehicleId]);
  return latestReading(readings.get(vehicleId) ?? [])?.km ?? null;
}

/**
 * A reading taken back — a return undone, a repair called off by mistake — is
 * no longer the moped's last (ADR-0038 §1, §4). The card's figure, which the
 * next hand-over, opening and closing are checked against, goes back to the
 * latest reading still standing, or to what it was before (`beforeKm`, when
 * known) if none stands. A figure written since by something else is left as
 * it is. Called inside the transaction that took the reading back, after it.
 */
export async function restoreOdometer(tx: Db, vehicleId: string, takenBackKm: number, beforeKm?: number | null): Promise<void> {
  const v = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { odometerKm: true } });
  if (!v || v.odometerKm !== takenBackKm) return;
  const standing = await latestReadingKm(tx, vehicleId);
  const km = standing ?? beforeKm;
  if (km === undefined || km === takenBackKm) return;
  await tx.vehicle.update({ where: { id: vehicleId }, data: { odometerKm: km, updatedAt: new Date() } });
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
