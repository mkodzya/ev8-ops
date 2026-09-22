import { dayQueue, effectiveRentalStatus, queueCount, todayISO, VEHICLE_STATES, type QueueRental, type VehicleState } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { debtsOf } from '../lib/debt.js';
import { depositsOverview } from '../lib/deposits.js';
import { prisma } from '../lib/db.js';
import { partRows } from '../lib/stock.js';
import { env } from '../lib/env.js';
import { actorOf, mayView } from '../lib/guard.js';
import { onHandOf } from '../lib/till.js';
import { UNDO_RETURN_MS } from '../lib/rentals.js';
import { BANKS } from './statements.js';
import { batteriesNow } from './batteries.js';

// "Today" (wave 4 §3.1): the queue and the numbers beside it. The rules of
// the queue live in @ev8/shared, so the screen, the badge and the laptop's
// column count the same things.

const STALE_DAYS = 7;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Monday of the week `today` falls in — the week the numbers are about (`weekly.md`). */
export function weekStart(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

export function todayRoutes(app: FastifyInstance): void {
  app.get('/api/today', { config: { scope: 'session' } }, async (req) => {
    const actor = actorOf(req);
    const owner = mayView(req, 'deposit.decide');
    const today = todayISO(new Date(), env.TZ);
    const day = dateFromISO(today)!;
    const monday = dateFromISO(weekStart(today))!;

    const [rentalRows, tills, unmatchedLines, lastLines, instalmentRows, serviceJobs, reportRows, parts, purchaseRows, vehicles, week, myTill] = await Promise.all([
      prisma.rental.findMany({
        where: { OR: [{ status: { not: 'returned' } }, { status: 'returned', deposit: { status: 'held', decidedById: null, migrationDecision: null, paidTetri: { gt: 0 } } }] },
        select: {
          id: true,
          number: true,
          status: true,
          pickedUpOn: true,
          expectedReturnOn: true,
          paidThrough: true,
          vinUnconfirmed: true,
          odooOrderId: true,
          customer: { select: { id: true, name: true, nameKa: true, nameLat: true, phone: true } },
          vehicle: { select: { vin: true } },
          deposit: { select: { paidTetri: true, status: true, decidedById: true, migrationDecision: true } },
          periods: { select: { paidTetri: true } },
          documents: { where: { kind: 'pdf', docKind: 'contract', archived: false }, select: { signedAt: true } },
        },
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
            select: { id: true, number: true, reason: true, vehicle: { select: { vin: true } }, createdBy: { select: { name: true } }, _count: { select: { photos: true } } },
          })
        : [],
      owner ? partRows() : [],
      owner ? prisma.purchase.findMany({ where: { status: 'ordered' }, select: { id: true, number: true, supplier: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }) : [],
      prisma.vehicle.findMany({ where: { archived: false }, select: { state: true, pool: true, locationId: true } }),
      owner
        ? prisma.payment.findMany({
            where: { voidedAt: null, occurredOn: { gte: monday }, channel: { not: 'deposit' } },
            select: { direction: true, kind: true, grossTetri: true, feeTetri: true },
          })
        : [],
      owner ? 0 : onHandOf(actor.id),
    ]);

    const debts = await debtsOf([...new Set(rentalRows.map((r) => r.customer.id))]);
    const debtOfRental = (customerId: string, rentalId: string) =>
      (debts.get(customerId)?.parts ?? []).filter((p) => p.id === rentalId && (p.kind === 'rent' || p.kind === 'deposit' || p.kind === 'charge')).reduce((n, p) => n + p.owesTetri, 0);

    const rentals: QueueRental[] = rentalRows.map((r) => {
      const paidThrough = isoDate(r.paidThrough);
      const pickedUpOn = isoDate(r.pickedUpOn);
      const nothingPaid = !paidThrough && (r.deposit?.paidTetri ?? 0) === 0 && r.periods.every((p) => p.paidTetri === 0);
      const status = effectiveRentalStatus(r.status, paidThrough, pickedUpOn, today, nothingPaid);
      const signed = r.documents.some((d) => d.signedAt != null);
      const handedOverAgo = pickedUpOn ? daysBetween(pickedUpOn, today) : 0;
      return {
        id: r.id,
        number: r.number,
        customer: { id: r.customer.id, name: r.customer.name, phone: r.customer.phone },
        vin: r.vehicle?.vin ?? null,
        pickedUpOn,
        expectedReturnOn: isoDate(r.expectedReturnOn),
        paidThrough,
        status,
        debtTetri: debtOfRental(r.customer.id, r.id),
        awaitingPayment: status === 'awaiting_payment',
        // A deposit the transfer brought over is not this week's decision: it
        // stands in one row of its own (§3.7), and the rows here are the
        // returns the company itself made.
        depositUndecided: r.status === 'returned' && r.deposit?.status === 'held' && !r.deposit.decidedById && !r.deposit.migrationDecision && r.odooOrderId == null,
        vinUnconfirmed: r.vinUnconfirmed,
        contractUnsigned: !signed && handedOverAgo >= 1 && r.status !== 'returned',
      };
    });

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

    const staleBanks = owner
      ? BANKS.map((bank) => {
          const through = isoDate(lastLines.find((l) => l.bank === bank)?._max.occurredOn ?? null);
          const days = through ? Math.max(0, daysBetween(through, today)) : null;
          return { bank, days: days ?? STALE_DAYS + 1 };
        }).filter((b) => b.days > STALE_DAYS)
      : [];

    const longest = serviceJobs.reduce((n, j) => Math.max(n, daysBetween(isoDate(j.openedOn)!, today)), 0);
    const groups = dayQueue({
      today,
      owner,
      rentals,
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
        who: j.createdBy?.name ?? null,
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
      vehiclesWithoutPool: vehicles.filter((v) => v.pool == null && v.state !== 'sold' && v.state !== 'out').length,
      vehiclesWithoutPoint: vehicles.filter((v) => v.locationId == null && v.state === 'available').length,
      odooDeposits,
    });

    const fleet = Object.fromEntries(VEHICLE_STATES.map((s) => [s, 0])) as Record<VehicleState, number>;
    for (const v of vehicles) fleet[v.state as VehicleState]++;
    const overdueTetri = rentals.filter((r) => r.status === 'overdue').reduce((n, r) => n + r.debtTetri, 0);
    // Deposit money held comes from the one function "Деньги → Залоги" and
    // the week both read (`lib/deposits.ts`). This line used to count it
    // itself — `status: 'held'` and nothing else — and a deposit closed by a
    // transfer decision keeps that status, so "Сегодня" went on holding
    // 3 160 ₾ that two other screens had already let go (QA-W6-21). Three
    // readings of one figure is two too many; there is one now.
    const depositsHeldTetri = owner ? (await depositsOverview()).totals.heldTetri : null;
    // Deposit money of the week is what payments put on deposits, not a kind of payment.
    const depositsIn = owner
      ? await prisma.paymentAllocation.aggregate({ where: { target: 'deposit', payment: { voidedAt: null, occurredOn: { gte: monday }, channel: { not: 'deposit' } } }, _sum: { amountTetri: true } })
      : null;

    // What came in this week, by what it was for (`weekly.md`): the fee and
    // the deposits stand apart from what the rentals and the sales brought.
    const inWeek = week.filter((p) => p.direction === 'in');
    const sum = (f: (p: (typeof inWeek)[number]) => boolean) => inWeek.filter(f).reduce((n, p) => n + p.grossTetri, 0);
    const depositPart = depositsIn?._sum.amountTetri ?? 0;
    const weekMoney = owner
      ? {
          // Deposits stand apart (`weekly.md`), so the rent line is what the
          // week brought less the part of it that went onto deposits — the
          // lines add up to what came in (QA-W4-03).
          rentTetri: Math.max(0, sum((p) => p.kind === 'rent' || p.kind === 'on_account') - depositPart),
          saleTetri: sum((p) => p.kind === 'sale' || p.kind === 'buyback'),
          serviceTetri: sum((p) => p.kind === 'service'),
          depositTetri: depositPart,
          feeTetri: inWeek.reduce((n, p) => n + p.feeTetri, 0),
          from: weekStart(today),
        }
      : null;

    return {
      today,
      owner,
      queue: groups,
      count: queueCount(groups),
      numbers: {
        fleet,
        overdueTetri: owner ? overdueTetri : null,
        depositsHeldTetri,
        week: weekMoney,
        myTillTetri: owner ? null : myTill,
        batteries: await batteriesNow(),
      },
      undoReturnMs: UNDO_RETURN_MS,
    };
  });
}
