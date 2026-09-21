import {
  addDays,
  daysBetween,
  fleetUtilisation,
  minDate,
  todayISO,
  vehicleOn,
  weekIncome,
  type Period,
  type WeekIncome,
  type WeekPayment,
} from '@ev8/shared';
import { batteriesNow } from '../routes/batteries.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { depositsOverview } from './deposits.js';
import { env } from './env.js';
import { overdueTotals } from './overdue.js';
import { utilisationVehicles } from './utilisation.js';

// The data side of "Отчёты → Неделя" (wave 6 §3.1). The arithmetic of the
// money is in `packages/shared/src/week.ts`; here we only read the rows it
// needs, and borrow the figures other screens already own.
//
// Nothing here recomputes what another screen answers. Arrears come from the
// scan "Today" uses (`overdue.ts`), deposit money held comes from the one
// "Деньги → Залоги" uses (`deposits.ts`), utilisation comes from M-10. A week
// that quietly disagreed with the screen beside it would be worse than no
// week at all.
//
// What can be dated is read as of the day the period ends, so "прошлая
// неделя" is its own week rather than this morning wearing older labels
// (crit. 3). Two figures cannot be: arrears and deposit money held are what
// they are now, because that is how "Сегодня" and "Залоги" report them and
// the week must agree with those (crit. 1в).
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
  /** `overdue*` is now, and is the same pair of figures "Today" shows (crit. 1в). */
  rentals: { started: number; returned: number; overdueCount: number; overdueTetri: number };
  money: WeekIncome & {
    /** Kept out of deposits this week: not money through the door, a deposit spent. */
    withheldTetri: number;
    /** Deposit money still with us — the figure "Деньги → Залоги" shows. */
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

  const [{ input: vehicles }, started, returned, overdue, payments, withheld, deposits, transferPeriods, transferDeposits, unmatchedLines, batteries] =
    await Promise.all([
      utilisationVehicles(),
      prisma.rental.count({ where: { pickedUpOn: { gte: fromDate, lte: toDate } } }),
      prisma.rental.count({ where: { returnedOn: { gte: fromDate, lte: toDate } } }),
      overdueTotals(),
      prisma.payment.findMany({
        where: { voidedAt: null, occurredOn: { gte: fromDate, lte: toDate } },
        select: {
          occurredOn: true,
          direction: true,
          channel: true,
          kind: true,
          grossTetri: true,
          feeTetri: true,
          allocations: { select: { target: true, amountTetri: true } },
        },
      }),
      prisma.depositWithholding.aggregate({
        where: { voidedAt: null, createdAt: { gte: new Date(`${from}T00:00:00+04:00`), lt: endOfDay(to) } },
        _sum: { amountTetri: true },
      }),
      depositsOverview(),
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
  const income = weekIncome(
    payments.map<WeekPayment>((p) => ({
      occurredOn: isoDate(p.occurredOn)!,
      direction: p.direction as WeekPayment['direction'],
      channel: p.channel as WeekPayment['channel'],
      kind: p.kind as WeekPayment['kind'],
      grossTetri: p.grossTetri,
      feeTetri: p.feeTetri,
      allocations: p.allocations.map((a) => ({ target: a.target as WeekPayment['allocations'][number]['target'], amountTetri: a.amountTetri })),
    })),
    period,
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
    rentals: { started, returned, overdueCount: overdue.rentals, overdueTetri: overdue.tetri },
    money: {
      ...income,
      withheldTetri: withheld._sum.amountTetri ?? 0,
      heldTetri: deposits.totals.heldTetri,
      paidBeforeTransferTetri: (transferPeriods._sum.amountTetri ?? 0) + (transferDeposits._sum.receivedBeforeTransferTetri ?? 0),
    },
    utilisation: { percent: u.percent, rentedDays: u.rentedDays, poolDays: u.poolDays, unassigned: u.unassigned },
    batteries: { showroom: batteries.showroom, couriers: batteries.couriers, repair: batteries.repair, total: batteries.total },
    unmatchedLines,
    batterySwaps: null,
  };
}
