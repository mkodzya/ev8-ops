import { downtimeInPeriod, repairDowntime, type PeriodDowntime, type RepairClock, type RepairDowntime } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';

// Repair downtime in hours (stage 6; ADR-0038 §5). The arithmetic is shared
// (`packages/shared/src/downtime.ts`); here a repair row becomes its clock,
// and the repairs of a period are read once for the week and utilisation.

type Db = Prisma.TransactionClient;

/** The columns a repair's clock is read from. */
export const CLOCK = { status: true, openedOn: true, closedOn: true, openedAt: true, approvedAt: true, rejectedAt: true, closedAt: true } as const;

type ClockRow = { status: string; openedOn: Date; closedOn: Date | null; openedAt: Date | null; approvedAt: Date | null; rejectedAt: Date | null; closedAt: Date | null };

export function clockOf(j: ClockRow): RepairClock {
  return { status: j.status, openedOn: isoDate(j.openedOn)!, closedOn: isoDate(j.closedOn), openedAt: j.openedAt, approvedAt: j.approvedAt, rejectedAt: j.rejectedAt, closedAt: j.closedAt };
}

/** One repair's hours as of now; null — not known (before stage 2, or a day written in afterwards). */
export function downtimeOf(j: ClockRow, now: Date = new Date()): RepairDowntime | null {
  return repairDowntime(clockOf(j), now, env.TZ);
}

/**
 * The repairs' hours within the Tbilisi days `from`…`to`: the repairs whose
 * days touch the period, each cut to it, the ones with no hours counted apart.
 */
export async function periodDowntime(from: string, to: string, opts: { db?: Db; vehicleIds?: string[]; now?: Date } = {}): Promise<PeriodDowntime> {
  const jobs = await (opts.db ?? prisma).serviceJob.findMany({
    where: {
      openedOn: { lte: dateFromISO(to)! },
      OR: [{ closedOn: null }, { closedOn: { gte: dateFromISO(from)! } }],
      ...(opts.vehicleIds ? { vehicleId: { in: opts.vehicleIds } } : {}),
    },
    select: CLOCK,
  });
  return downtimeInPeriod(jobs.map(clockOf), from, to, opts.now ?? new Date(), env.TZ);
}
