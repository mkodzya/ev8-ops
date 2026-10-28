import { asksForSignature, contractState, countFleetChips, dayQueue, queueCount, statusBySchedule, todayISO, VEHICLE_STATES, type QueueRental, type SchedulePay, type VehicleState } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../generated/prisma/client.js';
import { scheduleToday } from '../lib/calendar.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { debtsOf, rentalDebt, rentalDueToday, type CustomerDebt } from '../lib/debt.js';
import { depositsOverview } from '../lib/deposits.js';
import { driveTasks, joinKommoDeals } from '../lib/driveScan.js';
import { prisma } from '../lib/db.js';
import { partRows } from '../lib/stock.js';
import { env } from '../lib/env.js';
import { kommoReconciliation } from '../lib/kommo.js';
import { hasPerm } from '../lib/auth.js';
import { actorOf, mayView } from '../lib/guard.js';
import { onHandOf } from '../lib/till.js';
import { maintenanceOverview } from '../lib/maintenance.js';
import { UNDO_RETURN_MS } from '../lib/rentals.js';
import { payOffsetOf, rentStateOf } from '../lib/rentState.js';
import { BANKS } from './statements.js';
import { batteriesNow } from './batteries.js';

// "Today" (wave 4 §3.1): the queue and the numbers beside it. The rules of
// the queue live in @ev8/shared, so the screen, the badge and the laptop's
// column count the same things.

const STALE_DAYS = 7;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** What the queue reads of a rental: one select, so the route and the mapper below cannot part. */
export const QUEUE_RENTAL = {
  id: true,
  number: true,
  status: true,
  pickedUpOn: true,
  expectedReturnOn: true,
  paidThrough: true,
  payWeekday: true,
  weekShiftDays: true,
  vinUnconfirmed: true,
  odooOrderId: true,
  transferredAt: true,
  // Marked signed in Signify (ADR-0039): no longer asked for on "Today".
  contractSignedElsewhereAt: true,
  customer: { select: { id: true, name: true, nameKa: true, nameLat: true, phone: true } },
  vehicle: { select: { vin: true } },
  deposit: { select: { paidTetri: true, status: true, decidedById: true, migrationDecision: true } },
  documents: { where: { kind: 'pdf', docKind: 'contract', archived: false }, select: { signedAt: true } },
  // The latest swap: the contract is drawn again from it and signed again (ADR-0040).
  acts: { where: { kind: 'swap_in' }, select: { occurredOn: true }, orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }], take: 1 },
} satisfies Prisma.RentalSelect;

/**
 * A rental as the queue of "Today" reads it: what it is called today, its
 * part of the one debt figure and how much of that is awaited. `today` is the
 * day the debts were asked for — one clock for the status and for the figure.
 * `pays`: what «Оплаты по графику» says of the running rentals (issue #18,
 * B4) — given, a running rental is called by it, as on every list; absent,
 * by its stored "paid through". Exported with its select so that a test can
 * hold the mapping for ONE rental: a group shows three rows, and the rule is
 * for every one.
 */
export function queueRental(r: Prisma.RentalGetPayload<{ select: typeof QUEUE_RENTAL }>, today: string, debts: Map<string, CustomerDebt>, pays?: Map<string, SchedulePay>): QueueRental {
  const paidThrough = isoDate(r.paidThrough);
  const pickedUpOn = isoDate(r.pickedUpOn);
  const stored = rentStateOf(r, today).status;
  const status = pays ? statusBySchedule(stored, pays.get(r.id)) : stored;
  // The contract to sign is the one of the moped the customer has: after a
  // swap it is a new paper from the swap's day, for a rental brought over too.
  const swappedOn = isoDate(r.acts[0]?.occurredOn);
  const handedOverOn = swappedOn ?? pickedUpOn;
  const handedOverAgo = handedOverOn ? daysBetween(handedOverOn, today) : 0;
  // The list's rule too (ADR-0039): signed here, marked signed in Signify, brought over, or waiting.
  const contract = contractState({
    signedHere: r.documents.some((d) => d.signedAt != null),
    signedElsewhereAt: r.contractSignedElsewhereAt,
    transferredAt: r.transferredAt,
    swapped: swappedOn != null,
    returned: r.status === 'returned',
  });
  return {
    id: r.id,
    number: r.number,
    customer: { id: r.customer.id, name: r.customer.name, phone: r.customer.phone },
    vin: r.vehicle?.vin ?? null,
    pickedUpOn,
    expectedReturnOn: isoDate(r.expectedReturnOn),
    paidThrough,
    payOffsetDays: payOffsetOf(r),
    status,
    debtTetri: rentalDebt(debts.get(r.customer.id), r.id),
    // Of that debt: awaited today and not late — the row of "due today" carries it (ADR-0017).
    dueTodayTetri: rentalDueToday(debts.get(r.customer.id), r.id),
    // A deposit the transfer brought over is not this week's decision: it
    // stands in one row of its own (§3.7), and the rows here are the
    // returns the company itself made.
    depositUndecided: r.status === 'returned' && r.deposit?.status === 'held' && !r.deposit.decidedById && !r.deposit.migrationDecision && r.odooOrderId == null,
    vinUnconfirmed: r.vinUnconfirmed,
    // A rental brought over has its contract from before EV8 Ops, kept outside
    // it: nobody is asked to sign that one here (Mika, 08.10.2026) — until a
    // swap replaces it with one of EV8 Ops (ADR-0040). Nor one a person
    // marked signed in Signify (ADR-0039). A day of grace after the hand-over.
    contractUnsigned: asksForSignature(contract, handedOverAgo),
  };
}

export function todayRoutes(app: FastifyInstance): void {
  app.get('/api/today', { config: { scope: 'fleet.view' } }, async (req) => {
    const actor = actorOf(req);
    const owner = mayView(req, 'deposit.decide');
    const today = todayISO(new Date(), env.TZ);
    const day = dateFromISO(today)!;

    const [rentalRows, tills, unmatchedLines, lastLines, instalmentRows, serviceJobs, reportRows, parts, purchaseRows, vehicles, myTill, schedule] = await Promise.all([
      prisma.rental.findMany({
        where: { OR: [{ status: { not: 'returned' } }, { status: 'returned', deposit: { status: 'held', decidedById: null, migrationDecision: null, paidTetri: { gt: 0 } } }] },
        select: QUEUE_RENTAL,
      }),
      owner ? prisma.cashHandover.findMany({ where: { status: 'pending' }, select: { id: true, amountTetri: true, fromUser: { select: { name: true } } }, orderBy: { handedAt: 'asc' } }) : [],
      owner ? prisma.statementLine.count({ where: { status: 'unmatched' } }) : 0,
      owner ? prisma.statementLine.groupBy({ by: ['bank'], _max: { occurredOn: true } }) : [],
      owner
        ? prisma.saleInstalment.findMany({
            where: { dueOn: { lt: day }, payStatus: { not: 'paid' }, sale: { status: { not: 'cancelled' } } },
            select: { id: true, dueOn: true, amountTetri: true, paidTetri: true, sale: { select: { id: true, number: true, customer: { select: { name: true, phone: true } } } } },
            orderBy: { dueOn: 'asc' },
          })
        : [],
      prisma.serviceJob.findMany({ where: { status: 'open' }, select: { openedOn: true } }),
      owner
        ? prisma.serviceJob.findMany({
            where: { status: 'draft' },
            orderBy: { createdAt: 'asc' },
            select: { id: true, number: true, reason: true, vehicle: { select: { vin: true } }, createdBy: { select: { name: true } }, mechanic: { select: { name: true } }, _count: { select: { photos: true } } },
          })
        : [],
      owner ? partRows() : [],
      owner ? prisma.purchase.findMany({ where: { status: 'ordered' }, select: { id: true, number: true, supplier: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }) : [],
      prisma.vehicle.findMany({ where: { archived: false }, select: { state: true, pool: true, locationId: true } }),
      owner ? 0 : onHandOf(actor.id),
      // «Оплаты по графику» for the same day (issue #18, B4): its one line, the
      // status of every running rental, and the owner's «просрочка».
      mayView(req, 'payments.schedule') ? scheduleToday(today) : null,
    ]);

    // The debts for the same day the statuses are read for: one clock for one answer.
    const debts = await debtsOf([...new Set(rentalRows.map((r) => r.customer.id))], today);
    const rentals: QueueRental[] = rentalRows.map((r) => queueRental(r, today, debts, schedule?.pay));

    // What the transfer left undecided, as one number (§3.7). Only an owner
    // ever sees it, so only an owner's request pays for the query.
    const odooDeposits = owner
      ? await (async () => {
          const agg = await prisma.deposit.aggregate({
            where: { status: 'held', decidedById: null, migrationDecision: null, rental: { odooOrderId: { not: null }, status: { in: ['returned', 'disputed'] } } },
            _count: { _all: true },
            _sum: { paidTetri: true },
          });
          return { count: agg._count._all, amountTetri: agg._sum.paidTetri ?? 0 };
        })()
      : { count: 0, amountTetri: 0 };

    // Kommo against the rentals here, as one row (ADR-0012). An owner's, and
    // only with the link on; before Kommo has answered once there is nothing
    // to compare and nothing is said.
    // The comparison is an owner's; the deals to enter are for whoever enters
    // them — a hand-over is a manager's too, a sale is for those who may sell.
    const kommoNow = await kommoReconciliation();
    const maySell = hasPerm(actor, 'sales.create');
    const kommoDeals = kommoNow && kommoNow.freshness !== 'waiting' ? kommoNow.deals.filter((d) => d.kind === 'rent' || maySell) : [];
    const kommo =
      owner && kommoNow && kommoNow.freshness !== 'waiting'
        ? { rentedThere: kommoNow.rentedThere.length, rentedHere: kommoNow.rentedHere.length, silent: kommoNow.freshness === 'silent', lastOkAt: kommoNow.lastOkAt?.toISOString() ?? null }
        : null;

    const staleBanks = owner
      ? BANKS.map((bank) => {
          const through = isoDate(lastLines.find((l) => l.bank === bank)?._max.occurredOn ?? null);
          const days = through ? Math.max(0, daysBetween(through, today)) : null;
          return { bank, days: days ?? STALE_DAYS + 1 };
        }).filter((b) => b.days > STALE_DAYS)
      : [];

    // Drive is read by the owners only (ADR-0031), and so are its rows; a
    // contract there and a deal in Kommo for one person are one row (ADR-0034).
    const driveNow = owner && mayView(req, 'users.manage') ? await driveTasks(today) : null;
    const joined = driveNow ? joinKommoDeals(driveNow.contracts, kommoDeals) : null;

    // The mopeds under each chip of «Парк → Мопеды», by the list's own rule
    // (Mika, answer «А», 22.10.2026): «Свободно» and the two rows below open
    // those chips, and each says the number of the list it opens.
    const chips = countFleetChips(vehicles, (v) => v.locationId != null);

    const longest = serviceJobs.reduce((n, j) => Math.max(n, daysBetween(isoDate(j.openedOn)!, today)), 0);
    // Planned maintenance (ADR-0038): owners and managers alike — whoever brings the moped in.
    const maintenance = await maintenanceOverview(prisma);
    const groups = dayQueue({
      today,
      owner,
      rentals,
      schedule: schedule?.counts ?? null,
      tills: tills.map((t) => ({ id: t.id, who: t.fromUser.name, amountTetri: t.amountTetri })),
      myTillTetri: myTill,
      unmatchedLines,
      staleBanks,
      instalments: instalmentRows.map((i) => ({
        id: i.id,
        saleId: i.sale.id,
        number: i.sale.number,
        who: i.sale.customer.name,
        phone: i.sale.customer.phone,
        days: daysBetween(isoDate(i.dueOn)!, today),
        amountTetri: i.amountTetri - i.paidTetri,
      })),
      service: { open: serviceJobs.length, longerThanWeek: serviceJobs.filter((j) => daysBetween(isoDate(j.openedOn)!, today) > 7).length, longestDays: longest },
      // A breakdown a manager reported (wave 5 §3.10) and the shelf running
      // low: both are the owners' to act on, and both are one line each.
      reports: reportRows.map((j) => ({
        id: j.id,
        number: j.number,
        vin: j.vehicle?.vin ?? null,
        // The mechanic who carries it, or whoever reported the breakdown.
        who: j.mechanic?.name ?? j.createdBy?.name ?? null,
        note: j.reason,
        photos: j._count.photos,
      })),
      lowParts: (() => {
        const low = parts.filter((p) => p.minQty > 0 && p.onHand < p.minQty);
        return {
          count: low.length,
          note: low
            .slice(0, 2)
            .map((p) => `${p.name}: ${p.onHand}/${p.minQty}`)
            .join(' · '),
        };
      })(),
      purchases: purchaseRows.map((p) => ({ id: p.id, number: p.number, who: p.supplier.name, note: 'ordered' })),
      vehiclesWithoutPool: chips.nopool,
      vehiclesWithoutPoint: chips.nopoint,
      odooDeposits,
      kommo,
      kommoDeals: joined?.deals ?? kommoDeals,
      drive: driveNow && joined ? { contracts: joined.contracts, returns: driveNow.returns } : undefined,
      maintenance: maintenance.due.map((m) => ({ vehicleId: m.vehicleId, number: m.number, model: m.model, vin: m.vin, dueKm: m.dueKm!, currentKm: m.currentKm!, leftKm: m.leftKm! })),
    });

    const fleet = Object.fromEntries(VEHICLE_STATES.map((s) => [s, 0])) as Record<VehicleState, number>;
    for (const v of vehicles) fleet[v.state as VehicleState]++;
    // Late rentals only: a rental due today is not in it (ADR-0017). The same
    // set and the same figures as the week's report, "Аренды → Просрочены" and
    // «Оплаты по графику → Просрочки» — the schedule's own sum (issue #18, B4).
    const overdueTetri = schedule?.lateDebtTetri ?? rentals.filter((r) => r.status === 'overdue').reduce((n, r) => n + r.debtTetri, 0);
    // Deposit money held comes from the one function "Деньги → Залоги" and
    // the week both read (`lib/deposits.ts`). This line used to count it
    // itself — `status: 'held'` and nothing else — and a deposit closed by a
    // transfer decision keeps that status, so "Сегодня" went on holding
    // 3 160 ₾ that two other screens had already let go (QA-W6-21). Three
    // readings of one figure is two too many; there is one now.
    const depositsHeldTetri = owner ? (await depositsOverview()).totals.heldTetri : null;
    // The week's money is no longer a card here (issue #18, B7): it repeated
    // «Отчёты → Неделя», «Оплаты → Месяц» and the payments' totals, and the
    // screen links to the report instead.

    return {
      today,
      owner,
      queue: groups,
      count: queueCount(groups),
      numbers: {
        // By state — what the fleet holds; «В сервисе» opens the repairs.
        fleet,
        // By chip — what a number opening «Парк → Мопеды» says («В аренде», «Свободно»).
        chips,
        overdueTetri: owner ? overdueTetri : null,
        depositsHeldTetri,
        myTillTetri: owner ? null : myTill,
        batteries: await batteriesNow(),
      },
      undoReturnMs: UNDO_RETURN_MS,
      /** Mopeds with no mileage written in EV8 Ops yet: no maintenance is counted for them (ADR-0038 §1). */
      maintenanceUnknown: maintenance.unknownCount,
    };
  });
}
