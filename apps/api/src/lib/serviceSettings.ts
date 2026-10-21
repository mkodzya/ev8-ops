import { LABOUR_RATE_TETRI, MAINTENANCE_INTERVAL_KM, MAINTENANCE_WARN_KM } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from './db.js';

// The repair settings an owner sets (stage 6; ADR-0038 §3): the company rate
// for an hour of norm, and the interval and the warning of the planned
// maintenance. One reader for all of them, so the work book, a new line of
// work and «К оплате» cannot each keep a rate of their own.

type Db = Prisma.TransactionClient;

export interface ServiceSettingsRow {
  /** What a mechanic without a rate of his own is paid for an hour of norm. */
  defaultRateTetri: number;
  maintenanceIntervalKm: number;
  maintenanceWarnKm: number;
  updatedAt: Date | null;
  updatedById: string | null;
}

/**
 * The one row. The migration writes it; should it ever be missing, the
 * figures the spec starts from are read — and nothing is written on a read.
 */
export async function serviceSettings(db: Db = prisma): Promise<ServiceSettingsRow> {
  const row = await db.serviceSettings.findUnique({ where: { id: true } });
  return (
    row ?? {
      defaultRateTetri: LABOUR_RATE_TETRI,
      maintenanceIntervalKm: MAINTENANCE_INTERVAL_KM,
      maintenanceWarnKm: MAINTENANCE_WARN_KM,
      updatedAt: null,
      updatedById: null,
    }
  );
}

/** A mechanic's rate, or the company's when he has none of his own (ADR-0038 §3). */
export async function rateOf(db: Db, person: { labourRateTetri: number | null } | null): Promise<number> {
  return person?.labourRateTetri ?? (await serviceSettings(db)).defaultRateTetri;
}
