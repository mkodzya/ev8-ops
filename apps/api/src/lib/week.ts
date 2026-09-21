import {
  addDays,
  arrearsOn,
  daysBetween,
  depositsHeld,
  fleetUtilisation,
  minDate,
  todayISO,
  vehicleOn,
  weekMoney,
  type Period,
  type WeekMoney,
  type WeekPayment,
} from '@ev8/shared';
import { batteriesNow } from '../routes/batteries.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { utilisationVehicles } from './utilisation.js';

// The data side of "Отчёты → Неделя" (wave 6 §3.1). The arithmetic is in
// `packages/shared/src/week.ts`; here we only read the rows it needs.
//
// Everything that can be answered *as of a day* is answered as of the day the
// period ends, not as of now — that is what makes "прошлая неделя" its own
// week rather than a snapshot of this morning wearing last week's dates
// (crit. 3). A figure the data cannot place in time says so instead of
// pretending: the battery count is the count today, and it is labelled that
// way on the screen.
//
// One figure has no data at all and never will until somebody starts keeping
// it: battery swaps. It comes back `null`, and the screen writes "нет данных —
// учёта нет" (crit. 2, CLAUDE.md rule 1). A zero there would be a lie.

/** Tbilisi keeps UTC+4 the whole year, so a calendar day ends at 20:00 UTC. */
const endOfDay = (day: string): Date => new Date(`${addDays(day, 1)}T00:00:00+04:00`);

export interface WeekAnswer {
  from: string;
  to: string;
  /** The day the "as of" figures were taken on: the period's end, or today when the week is still running. */
  asOf: string;
  today: string;
  fleet: {
    rented: number;
    freeInRentPool: number;
    inService: number;
    /** The longest a moped in repair has been there, in days. */
    serviceLongestDays: number | null;
  };
  rentals: { started: number; returned: number; overdueCount: number; overdueTetri: number };
  money: WeekMoney & {
    /** Kept out of deposits this week: not money through the door, a deposit spent. */
    withheldTetri: number;
    /** Deposit money still with us at the end of the period. */
    heldTetri: number;
    /**
     * Carried over from Odoo as already settled (default Q3): no day, no
     * payment, so it is never part of a week's takings (crit. 9).
     */
    paidBeforeTransferTetri: number;
  };
  utilisation: { percent: number | null; rentedDays: number; poolDays: number; unassigned: number };
  /** Counted, not numbered (D16) — and only ever as of today. */
  batteries: { showroom: number; couriers: number; repair: number; total: number };
  unmatchedLines: number;
  /** Nobody keeps this (`batteries.md`): the screen says so rather than showing 0. */
  batterySwaps: null;
}

export async function weekReport(from: string, to: string): Promise<WeekAnswer> {
  const today = todayISO(new Date(), env.TZ);
  // A week that has not finished is read as far as it has got.
  const asOf = minDate(to, today);
  const fromDate = dateFromISO(from)!;
  const toDate = dateFromISO(to)!;
  const asOfDate = dateFromISO(asOf)!;

  const [{ input: vehicles }, started, returned, rentalRows, payments, withheld, depositRows, transferPeriods, transferDeposits, unmatchedLines, batteries] =
    await Promise.all([
      utilisationVehicles(),
      prisma.rental.count({ where: { pickedUpOn: { gte: fromDate, lte: toDate } } }),
      prisma.rental.count({ where: { returnedOn: { gte: fromDate, lte: toDate } } }),
      // Arrears as they stood on `asOf`: a week counts as paid only by money
      // that had arrived by then, so last week's figure is last week's.
      prisma.rental.findMany({
        where: { pickedUpOn: { not: null, lte: asOfDate } },
        select: {
          id: true,
          periods: {
            select: {
              startsOn: true,
              amountTetri: true,
              paidBeforeTransfer: true,
              allocations: {
                where: { payment: { voidedAt: null, occurredOn: { lte: asOfDate } } },
                select: { amountTetri: true },
              },
            },
          },
        },
      }),
      prisma.payment.findMany({
        where: { voidedAt: null, occurredOn: { gte: fromDate, lte: toDate } },
        select: {
          occurredOn: true,
          direction: true,
          channel: true,
          kind: true,
          grossTetri: true,
          feeTetri: true,
          allocations: { where: { target: 'deposit' }, select: { amountTetri: true } },
        },
      }),
      prisma.depositWithholding.aggregate({
        where: { voidedAt: null, createdAt: { gte: new Date(`${from}T00:00:00+04:00`), lt: endOfDay(to) } },
        _sum: { amountTetri: true },
      }),
      // Every deposit, read as it stood on `asOf`: what had been paid onto it,
      // kept out of it and handed back by that day.
      prisma.deposit.findMany({
        select: {
          receivedBeforeTransferTetri: true,
          paidOutBeforeTetri: true,
          allocations: { where: { payment: { voidedAt: null, occurredOn: { lte: asOfDate } } }, select: { amountTetri: true } },
          payouts: { where: { voidedAt: null, occurredOn: { lte: asOfDate } }, select: { grossTetri: true } },
          withholdings: { where: { voidedAt: null, createdAt: { lt: endOfDay(asOf) } }, select: { amountTetri: true } },
        },
      }),
      prisma.rentalPeriod.aggregate({ where: { paidBeforeTransfer: true }, _sum: { amountTetri: true } }),
      prisma.deposit.aggregate({ _sum: { receivedBeforeTransferTetri: true } }),
      prisma.statementLine.count({ where: { status: 'unmatched', occurredOn: { gte: fromDate, lte: toDate } } }),
      batteriesNow(),
    ]);

  const fleet = { rented: 0, freeInRentPool: 0, inService: 0, serviceLongestDays: null as number | null };
  for (const v of vehicles) {
    const on = vehicleOn(v, asOf);
    if (!on) continue;
    if (on.state === 'rented') fleet.rented++;
    if (on.state === 'available' && on.pool === 'rent') fleet.freeInRentPool++;
    if (on.state === 'service') {
      fleet.inService++;
      fleet.serviceLongestDays = Math.max(fleet.serviceLongestDays ?? 0, Math.max(0, daysBetween(on.since, asOf)));
    }
  }

  const period: Period = { from, to };
  const money = weekMoney(
    payments.map<WeekPayment>((p) => ({
      occurredOn: isoDate(p.occurredOn)!,
      direction: p.direction as WeekPayment['direction'],
      channel: p.channel as WeekPayment['channel'],
      kind: p.kind as WeekPayment['kind'],
      grossTetri: p.grossTetri,
      feeTetri: p.feeTetri,
      toDepositTetri: p.allocations.reduce((n, a) => n + a.amountTetri, 0),
    })),
    period,
  );

  const arrears = arrearsOn(
    rentalRows.map((r) => ({
      id: r.id,
      periods: r.periods.map((p) => ({
        startsOn: isoDate(p.startsOn)!,
        amountTetri: p.amountTetri,
        // A week settled before the transfer carries no payment and no day:
        // it is paid, and it is not this week's takings (crit. 9).
        paidTetri: p.paidBeforeTransfer ? p.amountTetri : p.allocations.reduce((n, a) => n + a.amountTetri, 0),
      })),
    })),
    asOf,
  );

  // The same M-10 the utilisation screen shows, from the same function: the
  // week and the report disagreeing about one per cent would be a defect.
  const u = fleetUtilisation({ vehicles, from, to });

  return {
    from,
    to,
    asOf,
    today,
    fleet,
    rentals: { started, returned, overdueCount: arrears.rentals, overdueTetri: arrears.tetri },
    money: {
      ...money,
      withheldTetri: withheld._sum.amountTetri ?? 0,
      heldTetri: depositsHeld(
        depositRows.map((d) => ({
          paidTetri: d.receivedBeforeTransferTetri + d.allocations.reduce((n, a) => n + a.amountTetri, 0),
          withheldTetri: d.withholdings.reduce((n, w) => n + w.amountTetri, 0),
          paidOutTetri: d.paidOutBeforeTetri + d.payouts.reduce((n, p) => n + p.grossTetri, 0),
        })),
      ),
      paidBeforeTransferTetri: (transferPeriods._sum.amountTetri ?? 0) + (transferDeposits._sum.receivedBeforeTransferTetri ?? 0),
    },
    utilisation: { percent: u.percent, rentedDays: u.rentedDays, poolDays: u.poolDays, unassigned: u.unassigned },
    batteries: { showroom: batteries.showroom, couriers: batteries.couriers, repair: batteries.repair, total: batteries.total },
    unmatchedLines,
    batterySwaps: null,
  };
}
